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

// ---------------------- ENVIO DE MENSAGEM ----------------------
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

    return res.status(403).send("forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("method_not_allowed");
  }

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!entry) {
      return res.status(200).send("no_message");
    }

    const msgId = entry.id;
    const from = entry.from;
    const text = (entry.text?.body || "").trim();

    if (!msgId || !from) return res.status(200).send("no_id");

    // PREVENÇÃO DE DUPLICATAS
    if (await isDuplicateMessage(msgId)) {
      console.log("Mensagem duplicada ignorada:", msgId);
      return res.status(200).send("duplicate");
    }

    const state = await getUserState(from);
    const lower = text.toLowerCase();

    // ---------------------- MENU ----------------------
    if (state.step === "menu") {
      if (lower.includes("oi") || lower.includes("olá") || lower === "menu") {
        await sendMessage(
          from,
          `Olá! Seja bem vinda (o) 😊\n\nSou a assistente da Dra. Gabriela e estou aqui para te ajudar nesse inicio!\nPor favor, escolha uma das opções abaixo pra te direcionarmos melhor:\n` +          
            `1️⃣ Agendar consulta\n` +
            `2️⃣ Harmonização facial\n` +
            `3️⃣ Endereço\n` +
            `4️⃣ Em caso de dúvida falar com a Dra. Gabriela\n\n` +
            `Digite o número da opção.` 
        );
        return res.status(200).send("ok");
      }

      if (lower === "1" || lower.includes("agendar")) {
        state.step = "ask_datetime";
        state.temp = {};
        await setUserState(from, state);

        await sendMessage(from, "Perfeito! Envie a data e horário desejados.\nExemplo: 15/12/2025 14:00");
        return res.status(200).send("ok");
      }
      if (
          lower === "2" ||
          lower.includes("harmonizacao") || // sem acento
          lower.includes("harmonização")    // com acento
        )
        {
              await sendMessage(
        from,
        `✨ *Harmonização Facial*\n\n` +
          `Escolha o procedimento desejado:\n\n` +
          `1️⃣ *Preenchimento Labial*\n` +
          `💋 Melhora o contorno, volume e hidratação dos lábios.\n\n` +
          `2️⃣ *Toxina Botulínica (Botox)*\n` +
          `✨ Suaviza rugas de expressão (testa, glabela e pés de galinha).\n\n` +
          `3️⃣ *Preenchimento Mentual*\n` +
          `🧬 Realça e projeta o queixo para mais harmonia facial.\n\n` +
          `4️⃣ *Rinomodelação*\n` +
          `👃 Ajustes sutis no nariz sem cirurgia.\n\n` +
          `5️⃣ *Preenchimento do Bigode Chinês*\n` +
          `😊 Suaviza sulcos nasogenianos.\n\n` +
          `6️⃣ *Preenchimento Mandibular*\n` +
          `🦴 Define e contorna a mandíbula.\n\n` +
          `7️⃣ *Bioestimulador de Colágeno*\n` +
          `🧪 Melhora firmeza, textura e estimula colágeno.\n\n` +
          `8️⃣ *Outros procedimentos*\n` +
          `💬 Basta enviar o nome do procedimento que deseja saber mais.`
      );
      return res.sendStatus(200);
    }


      if (lower === "3" || lower.includes("endereço")) {
        await sendMessage(
          from,
          "📍 Endereço: Av. Washington Soares, 3663 - Sala 910 - Torre 01 - Fortaleza - CE."
        );
        return res.status(200).send("ok");
      }

      await sendMessage(from, "Digite *menu* ou *1* para agendar.");
      return res.status(200).send("ok");
    }

    // ---------------------- DATA/HORA ----------------------
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);

      if (!iso) {
        await sendMessage(from, "Formato inválido. Tente assim: 15/12/2025 14:00");
        return res.status(200).send("invalid_date");
      }

      const startISO = iso;
      const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();

      let free;
      try {
        free = await isTimeSlotFree(startISO, endISO);
      } catch (err) {
        console.error("Erro do Google Calendar:", err);
        await sendMessage(from, "⚠ Não consegui verificar o horário. Tente novamente.");
        return res.status(200).send("calendar_error");
      }

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

    // ---------------------- NOME → AGENDAR ----------------------
    if (state.step === "ask_name") {
      const nome = text;
      state.temp.name = nome;

      let event;

      try {
        event = await createEvent({
          summary: `Consulta - ${nome}`,
          description: `Agendamento via WhatsApp — ${nome} (${from})`,
          startISO: state.temp.startISO,
          durationMinutes: 60,
        });
      } catch (err) {
        console.error("Erro ao criar evento:", err);
        event = null;
      }

      if (!event) {
        await sendMessage(from, "❌ Erro ao agendar. Tente novamente.");
        state.step = "menu";
        await setUserState(from, state);
        return res.status(200).send("event_error");
      }

      // Salva na planilha
      try {
        await appendRow([
          new Date().toLocaleString(),
          from,
          nome,
          state.temp.startISO,
          event.htmlLink || "",
        ]);
      } catch (err) {
        console.error("Erro ao escrever na planilha:", err);
      }

      const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
      });

      await sendMessage(
        from,
        `✅ *Consulta confirmada!*\n\n👤 ${nome}\n📅 ${startLocal}\n⏰ 1h de duração\n\nSe precisar remarcar, basta enviar uma mensagem.`
      );

      await setUserState(from, { step: "menu", temp: {} });
      return res.status(200).send("ok");
    }

    // ---------------------- DEFAULT ----------------------
    await sendMessage(from, "Não entendi. Digite *menu*.");
    return res.status(200).send("default");
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).send("internal_error");
  }
}
