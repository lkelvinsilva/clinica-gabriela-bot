import axios from "axios";
import { getUserState, setUserState, isDuplicateMessage } from "../utils/state.js";
import { isTimeSlotFree, createEvent } from "../utils/googleCalendar.js";
import { appendRow } from "../utils/googleSheets.js";

// ---------------------- PARSE DE DATA ----------------------
function parseDateTime(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:às\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;

  const [_, d, mo, y, hh, mm] = m;

  return new Date(
    `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:00-03:00`
  ).toISOString();
}

// ---------------------- ENVIO DE MENSAGEM TEXTO ----------------------
async function sendMessage(to, text) {
  try {
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
        timeout: 10000,
      }
    );
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err?.response?.data || err);
  }
}

// ---------------------- ENVIO DE BOTÕES INTERATIVOS ----------------------
async function sendMenuButtons(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text:
              "Olá! Seja bem-vinda(o) 😊\n\nSou a assistente da Dra. Gabriela.\nEscolha uma das opções:",
          },
          action: {
            buttons: [
              {
                type: "reply",
                reply: { id: "1", title: "Agendar consulta" },
              },
              {
                type: "reply",
                reply: { id: "2", title: "Harmonização facial" },
              },
              {
                type: "reply",
                reply: { id: "3", title: "Endereço" },
              },
              {
                type: "reply",
                reply: { id: "4", title: "Falar com a Dra" },
              },
            ],
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    console.error("Erro ao enviar menu interativo:", err?.response?.data || err);
  }
}

// ---------------------- HANDLER ----------------------
export default async function handler(req, res) {
  // Verificação inicial do webhook
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("method_not_allowed");
  }

  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.status(200).send("no_message");

    const msgId = msg.id;
    const from = msg.from;

    if (await isDuplicateMessage(msgId)) {
      return res.status(200).send("duplicate");
    }

    const state = await getUserState(from);
    const text = msg.text?.body?.trim().toLowerCase();
    const buttonId = msg.interactive?.button_reply?.id;

    // ---------------------- MENU INICIAL ----------------------
    if (!state || !state.step || text === "menu" || text === "oi" || text === "olá") {
      await setUserState(from, { step: "menu", temp: {} });
      await sendMenuButtons(from);
      return res.status(200).send("menu_sent");
    }

    // ---------------------- BOTÕES DO MENU ----------------------
    if (buttonId === "1") {
      state.step = "ask_datetime";
      await setUserState(from, state);
      await sendMessage(from, "Perfeito! Envie a data e horário desejados.\nExemplo: 15/12/2025 14:00");
      return res.status(200).send("ok");
    }

    if (buttonId === "2") {
      await sendMessage(
        from,
        `✨ *Harmonização Facial*\n\n` +
          `1️⃣ Preenchimento Labial\n` +
          `2️⃣ Toxina Botulínica (Botox)\n` +
          `3️⃣ Preenchimento Mentual\n` +
          `4️⃣ Rinomodelação\n` +
          `5️⃣ Preenchimento Bigode Chinês\n` +
          `6️⃣ Preenchimento Mandibular\n` +
          `7️⃣ Bioestimulador de Colágeno\n` +
          `8️⃣ Outros\n`
      );
      return res.status(200).send("ok");
    }

    if (buttonId === "3") {
      await sendMessage(
        from,
        "📍 Endereço: Av. Washington Soares, 3663 - Sala 910 - Torre 01 - Fortaleza - CE."
      );
      return res.status(200).send("ok");
    }

    if (buttonId === "4") {
      await sendMessage(from, "Enviei seu contato para a Dra. Ela te responderá em breve. 💬");
      return res.status(200).send("ok");
    }

    // ---------------------- DATA/HORA ----------------------
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);

      if (!iso) {
        await sendMessage(from, "Formato inválido. Exemplo correto: 15/12/2025 14:00");
        return res.status(200).send("invalid_date");
      }

      const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();
      const free = await isTimeSlotFree(iso, endISO);

      if (!free) {
        await sendMessage(from, "❌ Esse horário está ocupado. Envie outro.");
        return res.status(200).send("busy");
      }

      state.temp.startISO = iso;
      state.step = "ask_name";
      await setUserState(from, state);

      await sendMessage(from, "Ótimo! Agora envie seu *nome completo*.");
      return res.status(200).send("ok");
    }

    // ---------------------- FINALIZA AGENDAMENTO ----------------------
    if (state.step === "ask_name") {
      const nome = text;

      const event = await createEvent({
        summary: `Consulta - ${nome}`,
        description: `Agendamento via WhatsApp — ${nome}`,
        startISO: state.temp.startISO,
        durationMinutes: 60,
      });

      await appendRow([
        new Date().toLocaleString(),
        from,
        nome,
        state.temp.startISO,
        event.htmlLink || "",
      ]);

      const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
      });

      await sendMessage(
        from,
        `✅ *Consulta confirmada!*\n\n👤 ${nome}\n📅 ${startLocal}\n⏰ 1h de duração`
      );

      await setUserState(from, { step: "menu", temp: {} });
      return res.status(200).send("ok");
    }

    await sendMenuButtons(from);
    return res.status(200).send("default");
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).send("internal_error");
  }
}
