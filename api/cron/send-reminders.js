import { listUpcomingEvents } from "../../utils/googleCalendar";
import { sendConfirmationTemplate } from "../../utils/whatsapp.js";
import { setUserState } from "../../utils/state.js";

export default async function handler(req, res) {

  try {
    const now = new Date();
    const tomorrowStart = new Date(now);
    tomorrowStart.setDate(now.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);

    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const events = await listUpcomingEvents(
      tomorrowStart.toISOString(),
      tomorrowEnd.toISOString()
    );

    for (const event of events) {
      const phoneMatch = event.description?.match(/\((\d+)\)/);
      if (!phoneMatch) continue;

      const phone = phoneMatch[1];
      const name = event.summary.replace("Consulta - ", "");
      const date = new Date(event.start.dateTime).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
      });

      // 🟢 ENVIA TEMPLATE DE CONFIRMAÇÃO
      await sendConfirmationTemplate({
        to: phone,
        paciente: name,
        data: date,
      });

      // 🔄 Atualiza estado do paciente
      await setUserState(phone, {
        step: "aguardando_confirmacao",
        temp: {
          appointmentDate: date,
          eventId: event.id,
        },
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erro no cron:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
