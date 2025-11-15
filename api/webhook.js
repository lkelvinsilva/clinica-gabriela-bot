import axios from "axios";
import { getUserState, setUserState, isDuplicateMessage } from "@/utils/state";
import { isTimeSlotFree, createEvent } from "@/utils/googleCalendar";
import { appendRow } from "@/utils/googleSheets";

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
        }
      }
    );
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err?.response?.data || err);
  }
}

// ---------------------- GET (verificação do webhook) ----------------------
export async function GET(request) {
  const url = new URL(request.url);

  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ---------------------- POST (mensagens do WhatsApp) ----------------------
export async function POST(request) {
  try {
    const body = await request.json();

    const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!entry) {
      return new Response("OK", { status: 200 });
    }

    const msgId = entry.id;
    const from = entry.from;
    const text = (entry.text?.body || "").trim();

    if (!msgId || !from) return new Response("OK", { status: 200 });

    if (await isDuplicateMessage(msgId)) {
      console.log("Mensagem duplicada ignorada:", msgId);
      return new Response("OK", { status: 200 });
    }

    const state = await getUserState(from);
    const lower = text.toLowerCase();

    // MENU
    if (state.step === "menu") {
      if (lower.includes("oi") || lower.includes("olá") || lower === "menu") {
        await sendMessage(
          from,
          `Olá! Sou a assistente da Dra. Gabriela 😊\n\n` +
            `1️⃣ Agendar consulta\n` +
            `4️⃣ Endereço\n\n` +
            `Digite o número da opção.`
        );
        return new Response("OK", { status: 200 });
      }

      if (lower === "1") {
        state.step = "ask_datetime";
        state.temp = {};
        await setUserState(from, state);

        await sendMessage(from, "Perfeito! Envie a data e horário desejados.\nExemplo: 15/12/2025 14:00");
        return new Response("OK", { status: 200 });
      }

      if (lower === "4") {
        await sendMessage(from, "📍 Av. Washington Soares, 3663 - Sala 910 - Fortaleza - CE.");
        return new Response("OK", { status: 200 });
      }

      await sendMessage(from, "Digite *menu*.");
      return new Response("OK", { status: 200 });
    }

    // DATA/HORA
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);
      if (!iso) {
        await sendMessage(from, "Formato inválido. Tente assim: 15/12/2025 14:00");
        return new Response("OK", { status: 200 });
      }

      const startISO = iso;
      const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();

      let free;
      try {
        free = await isTimeSlotFree(startISO, endISO);
      } catch (err) {
        console.error("Erro Google Calendar:", err);
        await sendMessage(from, "⚠ Não consegui verificar o horário.");
        return new Response("OK", { status: 200 });
      }

      if (!free) {
        await sendMessage(from, "❌ Esse horário está ocupado.");
        return new Response("OK", { status: 200 });
      }

      state.temp.startISO = startISO;
      state.step = "ask_name";
      await setUserState(from, state);

      await sendMessage(from, "Ótimo! Agora envie seu *nome completo*.");
      return new Response("OK", { status: 200 });
    }

    // CONFIRMAR AGENDAMENTO
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
        await sendMessage(from, "❌ Erro ao agendar.");
        state.step = "menu";
        await setUserState(from, state);
        return new Response("OK", { status: 200 });
      }

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

      await sendMessage(from, `✅ *Consulta confirmada!*`);

      await setUserState(from, { step: "menu", temp: {} });
      return new Response("OK", { status: 200 });
    }

    await sendMessage(from, "Digite *menu*.");
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Erro no webhook:", err);
    return new Response("Erro interno", { status: 500 });
  }
}
