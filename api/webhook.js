import axios from "axios";
import { isTimeslotFree, createEvent } from "../utils/googleCalendar.js";
import { appendRow } from "../utils/googleSheets.js";

let userState = {}; // { phone: { step, temp } }

function parseDateTime(text) {
  // procura formato como: 15/12/2025 14:00 ou 15/12/2025 às 14:00
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:às\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  const [_, d, mo, y, hh, mm] = m;
  const iso = new Date(`${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}T${hh.padStart(2,"0")}:${mm}:00-03:00`).toISOString();
  return iso;
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    { messaging_product: "whatsapp", to, text: { body: text } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
  );
}

// ▓▓▓ PING DO GITHUB ACTIONS (mantém o Vercel acordado)
if (req.method === "GET" && req.query.ping) {
  if (req.query.ping === process.env.PING_TOKEN) {
    return res.status(200).send("pong");
  } else {
    return res.status(403).send("invalid token");
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.sendStatus(403);
  }

  if (req.method !== "POST") return res.sendStatus(405);

  try {
    const body = req.body;
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = (msg.text?.body || "").trim();

    if (!userState[from]) userState[from] = { step: "menu", temp: {} };

    const state = userState[from];

    // menu starter
    if (state.step === "menu") {
      // detect "oi" or "agendar" or "1"
      const lower = text.toLowerCase();
      if (lower.includes("oi") || lower.includes("olá") || lower === "menu") {
        await sendMessage(from,
          `Olá! Sou a assistente da Dra. Gabriela 😊\n\n1️⃣ Agendar consulta\n2️⃣ Harmonização facial\n3️⃣ Orçamentos\n4️⃣ Endereço\n5️⃣ Falar com a Dra. Gabriela\n\nDigite o número da opção.`
        );
        return res.sendStatus(200);
      }
      if (lower === "1" || lower.includes("agendar")) {
        state.step = "ask_datetime";
        await sendMessage(from, "Perfeito! Informe a *data e horário* que você deseja (ex: 15/12/2025 14:00).");
        return res.sendStatus(200);
      }
      // outras opções simples
      if (lower === "4" || lower.includes("endereço")) {
        await sendMessage(from, "Endereço: Av. Washington Soares, 3663 - Edson Queiroz, Fortaleza - CE, Sala 910.");
        return res.sendStatus(200);
      }
      // fallback
      await sendMessage(from, "Digite '1' para agendar ou 'menu' para opções.");
      return res.sendStatus(200);
    }

    // ask_datetime
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);
      if (!iso) {
        await sendMessage(from, "Não reconheci a data/hora. Envie no formato: 15/12/2025 14:00");
        return res.sendStatus(200);
      }

      // definindo intervalo (1h)
      const startISO = iso;
      const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();

      const free = await isTimeslotFree(startISO, endISO);
      if (!free) {
        await sendMessage(from, "❌ Desculpe — esse horário já está ocupado. Envie outra data/hora, por favor.");
        return res.sendStatus(200);
      }

      // disponível
      state.temp.startISO = startISO;
      state.temp.endISO = endISO;
      state.step = "ask_name";
      await sendMessage(from, "Ótimo — esse horário está disponível. Por favor, envie seu *nome completo* para confirmar o agendamento.");
      return res.sendStatus(200);
    }

    // ask_name
    if (state.step === "ask_name") {
      const nome = text;
      state.temp.name = nome;

      // cria evento
      const event = await createEvent({
        summary: `Consulta - ${nome}`,
        description: `Agendamento via WhatsApp - ${nome} / ${from}`,
        startISO: state.temp.startISO,
        durationMinutes: 60,
        attendees: [{ email: "" }]
      }).catch(err => { console.error(err); return null; });

      if (!event) {
        await sendMessage(from, "❌ Ocorreu um erro ao criar o evento. Tente novamente mais tarde.");
        state.step = "menu";
        state.temp = {};
        return res.sendStatus(200);
      }

      // salva no Sheets
      try {
        await appendRow([ new Date().toLocaleString(), from, nome, state.temp.startISO, event.htmlLink ]);
      } catch (e) {
        console.error("Erro Sheets:", e);
      }

      // confirma ao usuário
      const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", { timeZone: process.env.TIMEZONE || "America/Fortaleza" });
      await sendMessage(from,
        `✅ *Agendamento confirmado!*\n\n👤 ${nome}\n📅 ${startLocal}\n⏰ Duração: 1 hora\n\nSe precisar cancelar ou reagendar, responda aqui.`
      );

      // limpa estado
      userState[from] = { step: "menu", temp: {} };
      return res.sendStatus(200);
    }

    // default
    await sendMessage(from, "Desculpe, não entendi — digite 'menu' para ver opções.");
    return res.sendStatus(200);

  } catch (err) {
    console.error("Erro webhook:", err);
    return res.sendStatus(500);
  }
}

