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

// ---------------------- ENVIO DE LIST MESSAGE ----------------------
async function sendListMenu(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: {
            text: "Olá! Seja bem-vinda(o) 😊\nEscolha uma das opções:"
          },
          footer: {
            text: "Assistente da Dra. Gabriela"
          },
          action: {
            button: "Ver opções",
            sections: [
              {
                title: "Menu principal",
                rows: [
                  { id: "menu_agendar", title: "Agendar consulta" },
                  { id: "menu_harmonizacao", title: "Harmonização facial" },
                  { id: "menu_endereco", title: "Endereço" },
                  { id: "menu_falar_dra", title: "Falar com a Dra. Gabriela" }
                ]
              }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Erro ao enviar menu interativo:", err.response?.data || err);
  }
}

// ---------------------- ENVIO DE MENSAGEM SIMPLES ----------------------
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        }
      }
    );
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err);
  }
}

// ---------------------- HANDLER ----------------------
export default async function handler(req, res) {
  if (req.method === "GET" && req.query.ping) {
    if (req.query.ping === process.env.PING_TOKEN) return res.status(200).send("pong");
    return res.status(403).send("invalid");
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN)
      return res.status(200).send(challenge);
    return res.status(403).send("forbidden");
  }

  if (req.method !== "POST") return res.status(405).send("method_not_allowed");

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.status(200).send("no_message");

    const msgId = entry.id;
    const from = entry.from;

    if (!msgId || !from) return res.status(200).send("no_id");

    // evita repetir mensagens
    if (await isDuplicateMessage(msgId)) return res.status(200).send("duplicate");

    let text = entry.text?.body?.trim()?.toLowerCase() || null;
    const state = await getUserState(from);

    // ------------------------------------------------------------------
    // 1️⃣ → DETECTA RESPOSTAS DE LIST MESSAGE
    // ------------------------------------------------------------------
    const listReply = entry.interactive?.list_reply?.id;

    if (listReply) {
      console.log("Usuário escolheu:", listReply);

      switch (listReply) {
        case "menu_agendar":
          await setUserState(from, { step: "ask_datetime", temp: {} });
          await sendMessage(from, "Perfeito! Envie a data e horário desejados.\nEx: 15/12/2025 14:00");
          return res.status(200).send("ok");

        case "menu_harmonizacao":
          await sendMessage(
            from,
            `✨ *Harmonização Facial*\n\n1️⃣ Lábios\n2️⃣ Botox\n3️⃣ Mentual\n4️⃣ Rinomodelação\n5️⃣ Bigode Chinês\n6️⃣ Mandíbula\n7️⃣ Bioestimulador\n8️⃣ Outro procedimento`
          );
          return res.status(200).send("ok");

        case "menu_endereco":
          await sendMessage(from, "📍 Av. Washington Soares, 3663 - Sala 910 - Torre 01 - Fortaleza - CE.");
          return res.status(200).send("ok");

        case "menu_falar_dra":
          await sendMessage(from, "Encaminhando para a Dra. Gabriela...");
          return res.status(200).send("ok");
      }
    }

    // ------------------------------------------------------------------
    // 2️⃣ → PRIMEIRO ACESSO OU "menu"
    // ------------------------------------------------------------------
    if (!state || !state.step || text === "menu" || text?.includes("oi") || text?.includes("olá")) {
      await setUserState(from, { step: "menu", temp: {} });
      await sendListMenu(from);
      return res.status(200).send("ok");
    }

    // ------------------------------------------------------------------
    // 3️⃣ → FLUXO DE AGENDAMENTO
    // ------------------------------------------------------------------
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);
      if (!iso) {
        await sendMessage(from, "Formato inválido. Ex: 15/12/2025 14:00");
        return res.status(200).send("invalid_date");
      }

      const startISO = iso;
      const endISO = new Date(new Date(iso).getTime() + 60 * 60 * 1000).toISOString();

      const free = await isTimeSlotFree(startISO, endISO);
      if (!free) {
        await sendMessage(from, "❌ Esse horário está ocupado. Envie outro horário.");
        return res.status(200).send("busy");
      }

      state.temp.startISO = startISO;
      state.step = "ask_name";
      await setUserState(from, state);

      await sendMessage(from, "Ótimo! Agora envie seu *nome completo* para confirmar o agendamento.");
      return res.status(200).send("ok");
    }

    if (state.step === "ask_name") {
      const nome = entry.text?.body || "Paciente";

      let event = await createEvent({
        summary: `Consulta - ${nome}`,
        description: `Agendamento via WhatsApp — ${nome} (${from})`,
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
        `✅ *Consulta confirmada!*\n\n👤 ${nome}\n📅 ${startLocal}\n⏰ 1h\n\nSe precisar remarcar, estou por aqui.`
      );

      await setUserState(from, { step: "menu", temp: {} });
      return res.status(200).send("ok");
    }

    // ------------------------------------------------------------------
    await sendMessage(from, "Não entendi. Digite *menu*.");
    return res.status(200).send("default");

  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).send("internal_error");
  }
}
