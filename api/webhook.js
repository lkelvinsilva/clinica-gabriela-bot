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

// ---------------------- BOTÕES ----------------------
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
              "Olá! 😊\nEscolha uma opção abaixo:",
          },
          action: {
            buttons: [
              {
                type: "reply",
                reply: { id: "1", title: "Agendar Consulta" }
              },
              {
                type: "reply",
                reply: { id: "2", title: "Harmonização Facial" }
              },
              {
                type: "reply",
                reply: { id: "3", title: "Endereço" }
              }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        }
      }
    );
  } catch (err) {
    console.error("Erro ao enviar botões:", err?.response?.data || err);
  }
}

// ---------------------- ENVIO DE TEXTO ----------------------
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
        }
      }
    );
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err?.response?.data || err);
  }
}

// ---------------------- HANDLER ----------------------
export default async function handler(req, res) {
  // ---------- VERIFICAÇÃO DO WEBHOOK ----------
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  }

  if (req.method !== "POST") return res.status(405).send("method_not_allowed");

  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.status(200).send("no_message");

    const msgId = message.id;
    const from = message.from;
    const text = (
      message.text?.body ||
      message.button?.text ||
      message.button?.payload ||
      ""
    ).trim().toLowerCase();

    if (!msgId || !from) return res.status(200).send("no_id");

    if (await isDuplicateMessage(msgId)) {
      return res.status(200).send("duplicate");
    }

    let state = await getUserState(from);

    // Quando o usuário digita "menu"
    if (text === "menu" || text === "oi" || text === "olá") {
      await setUserState(from, { step: "menu", temp: {} });
      await sendMenuButtons(from);
      return res.status(200).send("ok");
    }

    // Se o usuário está no MENU
    if (!state || state.step === "menu") {
      if (text === "1") {
        state = { step: "ask_datetime", temp: {} };
        await setUserState(from, state);
        await sendMessage(from, "Perfeito! Envie a data e horário. Ex: 15/12/2025 14:00");
        return res.status(200).send("ok");
      }

      if (text === "2") {
        await sendMessage(
          from,
          "✨ *Harmonização Facial*\n\nEscolha o procedimento:\n1️⃣ Preenchimento Labial\n2️⃣ Botox\n3️⃣ Preenchimento Mentual\n4️⃣ Rinomodelação\n5️⃣ Bigode Chinês\n6️⃣ Mandíbula\n7️⃣ Bioestimulador\n8️⃣ Outros"
        );
        return res.status(200).send("ok");
      }

      if (text === "3") {
        await sendMessage(from, "📍 Av. Washington Soares, 3663 - Sala 910 - Torre 01 - Fortaleza - CE.");
        return res.status(200).send("ok");
      }

      await sendMenuButtons(from);
      return res.status(200).send("ok");
    }

    // ---------------------- PEDIR DATA ----------------------
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);
      if (!iso) {
        await sendMessage(from, "Formato inválido. Tente enviar assim: 15/12/2025 14:00");
        return;
      }

      const end = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();

      if (!(await isTimeSlotFree(iso, end))) {
        await sendMessage(from, "❌ Horário ocupado. Envie outro horário.");
        return;
      }

      state.temp.startISO = iso;
      state.step = "ask_name";
      await setUserState(from, state);
      await sendMessage(from, "Ótimo! Agora envie seu nome completo.");
      return;
    }

    // ---------------------- FINALIZAR AGENDAMENTO ----------------------
    if (state.step === "ask_name") {
      const nome = text;
      state.temp.name = nome;

      const event = await createEvent({
        summary: `Consulta - ${nome}`,
        description: `Agendado via WhatsApp — ${nome}`,
        startISO: state.temp.startISO,
        durationMinutes: 60
      });

      const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza"
      });

      await appendRow([
        new Date().toLocaleString(),
        from,
        nome,
        state.temp.startISO,
        event.htmlLink || ""
      ]);

      await sendMessage(
        from,
        `✅ *Consulta confirmada!*\n👤 ${nome}\n📅 ${startLocal}`
      );

      await setUserState(from, { step: "menu", temp: {} });
      await sendMenuButtons(from);
      return;
    }

    await sendMenuButtons(from);
    return res.status(200).send("ok");

  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).send("internal_error");
  }
}
