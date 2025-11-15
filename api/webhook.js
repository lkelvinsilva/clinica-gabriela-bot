import axios from "axios";
import { getUserState, setUserState, isDuplicateMessage } from "../../utils/state.js";
import { isTimeslotFree, createEvent } from "../../utils/googleCalendar.js";
import { appendRow } from "../../utils/googleSheets.js";

// ---------------------- PARSE DE DATA ----------------------
function parseDateTime(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;

  const [_, d, mo, y, hh, mm] = m;

  return new Date(
    `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:00-03:00`
  ).toISOString();
}

// ---------------------- ENVIO DE MENSAGEM ----------------------
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ---------------------- HANDLER ----------------------
export default async function handler(req, res) {
  // ---------- PING DO GITHUB ACTIONS ----------
  if (req.method === "GET" && req.query.ping) {
    if (req.query.ping === process.env.PING_TOKEN) {
      return res.status(200).send("pong");
    }
    return res.status(403).send("invalid");
  }

  // ---------- VERIFICAÇÃO DO WEBHOOK ----------
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

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!entry) return res.sendStatus(200);

    const msgId = entry.id;
    const from = entry.from;
    const text = (entry.text?.body || "").trim();

    // PREVENÇÃO DE DUPLICATAS (fundamental)
    if (await isDuplicateMessage(msgId)) {
      console.log("Mensagem duplicada ignorada:", msgId);
      return res.sendStatus(200);
    }

    // Carregar ESTADO REAL do usuário
    const state = await getUserState(from);
    const lower = text.toLowerCase();

    // ---------------------- MENU ----------------------
    if (state.step === "menu") {
      if (lower.includes("oi") || lower.includes("olá") || lower === "menu") {
        await sendMessage(
          from,
          `Olá! Sou a assistente da Dra. Gabriela 😊\n\n` +
            `1️⃣ Agendar consulta\n` +
            `2️⃣ Harmonização facial\n` +
            `3️⃣ Orçamentos\n` +
            `4️⃣ Endereço\n` +
            `5️⃣ Falar com a Dra. Gabriela\n\n` +
            `Digite o número da opção.`
        );
        return res.sendStatus(200);
      }

      if (lower === "1" || lower.includes("agendar")) {
        state.step = "ask_datetime";
        await setUserState(from, state);
        await sendMessage(from, "Perfeito! Envie a data e horário desejados, ex: 15/12/2025 14:00");
        return res.sendStatus(200);
      }

      if (lower === "4" || lower.includes("endereço")) {
        await sendMessage(
          from,
          "📍 Endereço: Av. Washington Soares, 3663 - Sala 910 - Fortaleza - CE."
        );
        return res.sendStatus(200);
      }

      await sendMessage(from, "Digite *menu* ou *1* para agendar.");
      return res.sendStatus(200);
    }

    // ---------------------- DATA/HORA ----------------------
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);

      if (!iso) {
        await sendMessage(from, "Formato inválido. Tente: 15/12/2025 14:00");
        return res.sendStatus(200);
      }

      const startISO = iso;
      const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();

      const free = await isTimeslotFree(startISO, endISO);

      if (!free) {
        await sendMessage(from, "❌ Esse horário está ocupado. Envie outro por favor.");
        return res.sendStatus(200);
      }

      state.temp.startISO = startISO;
      state.step = "ask_name";
      await setUserState(from, state);

      await sendMessage(from, "Ótimo! Agora envie seu *nome completo* para confirmar.");
      return res.sendStatus(200);
    }

    // ---------------------- NOME ----------------------
    if (state.step === "ask_name") {
      const nome = text;
      state.temp.name = nome;

      const event = await createEvent({
        summary: `Consulta - ${nome}`,
        description: `Agendamento via WhatsApp — ${nome} / ${from}`,
        startISO: state.temp.startISO,
        durationMinutes: 60,
      }).catch(() => null);

      if (!event) {
        await sendMessage(from, "❌ Erro ao agendar. Tente novamente.");
        state.step = "menu";
        await setUserState(from, state);
        return res.sendStatus(200);
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

      await setUserState(from, { step: "menu", temp: {} });
      return res.sendStatus(200);
    }

    await sendMessage(from, "Não entendi. Digite *menu*.");
    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.sendStatus(500);
  }
}
