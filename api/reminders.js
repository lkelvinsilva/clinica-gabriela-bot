import { listUpcomingEvents } from "../utils/googleCalendar.js";
import axios from "axios";
import { setUserState } from "../utils/state.js";


async function sendConfirmButtons(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: [
            { type: "reply", reply: { id: "confirmar_consulta", title: "✅ Confirmar" } },
            { type: "reply", reply: { id: "desmarcar_consulta", title: "❌ Desmarcar" } }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

export default async function handler(req, res) {
  try {
    const lookAhead = 1440; // 24h
    const now = new Date().toISOString();
    const then = new Date(Date.now() + lookAhead * 60000).toISOString();

    const events = await listUpcomingEvents(now, then);

    let sent = 0;

    for (const ev of events) {
      const start = ev.start?.dateTime;
      const phoneMatch = ev.description?.match(/\+?\d{10,13}/);
      if (!phoneMatch) continue;

      const phone = phoneMatch[0];
      const startLocal = new Date(start).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza"
      });
      await setUserState(phone, {
        step: "aguardando_confirmacao",
        temp: {
          eventStart: start,
          eventId: ev.id
        }
      });
      await sendConfirmButtons(
        phone,
        `⏰ *Lembrete de consulta*\n\n📅 ${startLocal}\n\nConfirma sua presença?`
      );
      
      sent++;
    }

    return res.status(200).json({ sent });
  } catch (err) {
    console.error(err);
    return res.status(500).send("erro");
  }
}
