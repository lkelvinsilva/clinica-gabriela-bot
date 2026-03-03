import { listUpcomingEvents } from "../utils/googleCalendar.js";
import { getUserState } from "../utils/state.js";
import axios from "axios";

async function sendMessage(to, text) {
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
        "Content-Type": "application/json"
      }
    }
  );
}

export default async function handler(req, res) {
  try {
    // janela de 2h a frente
    const now = new Date();
    const in2h = new Date(now.getTime() + 2 * 60 * 60000);

    const events = await listUpcomingEvents(
      now.toISOString(),
      in2h.toISOString()
    );

    let alerts = 0;

    for (const ev of events) {
      const phoneMatch = ev.description?.match(/\+?\d{10,13}/);
      if (!phoneMatch) continue;

      const phone = phoneMatch[0];
      const state = await getUserState(phone);

      // só alerta se ainda estiver aguardando confirmação
      if (state?.step === "aguardando_confirmacao") {
        const startLocal = new Date(ev.start.dateTime).toLocaleString("pt-BR", {
          timeZone: "America/Fortaleza"
        });

        await sendMessage(
          process.env.ADMIN_PHONE,
          `⚠️ *Paciente NÃO confirmou a consulta*\n\n📅 ${startLocal}\n📞 ${phone}`
        );

        alerts++;
      }
    }

    return res.status(200).json({ alerts });
  } catch (err) {
    console.error("Erro lembrete 2h:", err);
    return res.status(500).send("erro");
  }
}
