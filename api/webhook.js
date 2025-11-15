import axios from "axios";
import { isTimeslotFree, createEvent } from "../utils/googleCalendar.js";
import { appendRow } from "../utils/googleSheets.js";

let userState = {}; // { phone: { step, temp } }

// ---------------------- PARSE DE DATA ----------------------
function parseDateTime(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:às\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;

  const [_, d, mo, y, hh, mm] = m;

  return new Date(
    `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(
      2,
      "0"
    )}:${mm}:00-03:00`
  ).toISOString();
}

// ---------------------- ENVIO DE MENSAGEM ----------------------
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err);
  }
}

// ---------------------- PROCESSAMENTO ASSÍNCRONO ----------------------
async function processMessage(msg) {
  const from = msg.from;
  const text = (msg.text?.body || "").trim();
  const lower = text.toLowerCase();

  if (!userState[from]) userState[from] = { step: "menu", temp: {} };
  const state = userState[from];

  // ---------------------- MENU PRINCIPAL ----------------------
  if (state.step === "menu") {
    if (lower.includes("oi") || lower.includes("olá") || lower === "menu") {
      return sendMessage(
        from,
        `Olá! Sou a assistente da Dra. Gabriela 😊\n\n` +
          `1️⃣ Agendar consulta\n` +
          `2️⃣ Harmonização facial\n` +
          `3️⃣ Orçamentos\n` +
          `4️⃣ Endereço\n` +
          `5️⃣ Falar com a Dra. Gabriela\n\n` +
          `Digite o número da opção.`
      );
    }

    if (lower === "1" || lower.includes("agendar")) {
      state.step = "ask_datetime";
      return sendMessage(
        from,
        "Perfeito! Envie a data e horário desejados, ex: 15/12/2025 14:00"
      );
    }

    if (lower === "4" || lower.includes("endereço")) {
      return sendMessage(
        from,
        "📍 Endereço: Av. Washington Soares, 3663 - Sala 910 - Fortaleza - CE."
      );
    }

    return sendMessage(from, "Digite *menu* ou *1* para agendar.");
  }

  // ---------------------- PEGAR DATA/HORA ----------------------
  if (state.step === "ask_datetime") {
    const iso = parseDateTime(text);
    if (!iso) {
      return sendMessage(from, "Formato inválido. Tente: 15/12/2025 14:00");
    }

    const startISO = iso;
    const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();
    const free = await isTimeslotFree(startISO, endISO);

    if (!free) {
      return sendMessage(from, "❌ Esse horário está ocupado. Envie outro por favor.");
    }

    state.temp.startISO = startISO;
    state.step = "ask_name";

    return sendMessage(from, "Ótimo! Agora, envie seu *nome completo* para confirmar.");
  }

  // ---------------------- NOME DO PACIENTE ----------------------
  if (state.step === "ask_name") {
    const nome = text;
    state.temp.name = nome;

    const event = await createEvent({
      summary: `Consulta - ${nome}`,
      description: `Agendamento pelo WhatsApp — ${nome} / ${from}`,
      startISO: state.temp.startISO,
      durationMinutes: 60,
    }).catch(() => null);

    if (!event) {
      state.step = "menu";
      return sendMessage(from, "❌ Erro ao agendar. Tente novamente.");
    }

    await appendRow([
      new Date().toLocaleString(),
      from,
      nome,
      state.temp.startISO,
      event.htmlLink,
    ]);

    const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", {
      timeZone: "America/Fortaleza",
    });

    await sendMessage(
      from,
      `✅ *Consulta confirmada!*\n\n👤 ${nome}\n📅 ${startLocal}\n⏰ 1h de duração\n\nSe precisar cancelar, escreva aqui.`
    );

    userState[from] = { step: "menu", temp: {} };
    return;
  }

  // fallback
  return sendMessage(from, "Não entendi. Digite *menu*.");
}

// ---------------------- HANDLER PRINCIPAL ----------------------
export default async function handler(req, res) {
  // ---------- VERIFICAÇÃO DO WEBHOOK WhatsApp ----------
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  if (req.method !== "POST") return res.sendStatus(405);

  // -------------- RESP
