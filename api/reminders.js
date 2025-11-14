import { listUpcomingEvents } from "../utils/googleCalendar.js";
import axios from "axios";

function minutesFromNowToISO(minAhead) {
  const now = new Date();
  const then = new Date(now.getTime() + minAhead * 60000);
  return { nowISO: now.toISOString(), thenISO: then.toISOString() };
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    { messaging_product: "whatsapp", to, text: { body: text } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
  );
}

export default async function handler(req, res) {
  // Proteja este endpoint com algum token se quiser (vercel team secret) -> left as future
  try {
    const lookAhead = parseInt(process.env.REMINDER_LOOKAHEAD_MIN || "60", 10);
    const { nowISO, thenISO } = {
      nowISO: new Date().toISOString(),
      thenISO: new Date(new Date().getTime() + lookAhead * 60000).toISOString()
    };

    const events = await listUpcomingEvents(nowISO, thenISO);

    for (const ev of events) {
      const start = ev.start?.dateTime || ev.start?.date;
      // buscar telefone no título ou descrição (neste código usamos (phone) no summary)
      const phoneMatch = (ev.description || "").match(/(\+?\d{10,13})/) || (ev.attendees?.[0]?.email ? null : null);
      // fallback: tentamos parsear do summary (ex: "Consulta - 558599400246")
      const phoneFromSummary = (ev.summary || "").match(/\+?\d{8,14}/);
      const phone = phoneMatch ? phoneMatch[0] : (phoneFromSummary ? phoneFromSummary[0] : null);

      if (!phone) continue; // se não temos telefone, pular

      const startLocal = new Date(start).toLocaleString("pt-BR", { timeZone: process.env.TIMEZONE || "America/Fortaleza" });

      await sendMessage(phone, `⏰ Lembrete: Você tem uma consulta agendada em ${startLocal}.\nSe precisar cancelar, responda aqui.`);
    }

    return res.status(200).send({ sent: events.length });
  } catch (err) {
    console.error("Erro reminders:", err);
    return res.status(500).send("erro");
  }
}
