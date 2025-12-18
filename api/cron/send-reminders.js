import { listUpcomingEvents } from "../utils/googleCalendar.js";
import { setUserState } from "../utils/state.js";
import { sendConfirmationTemplate, notifyAdmin } from "../utils/whatsapp.js";

export default async function handler(req, res) {
  try {
    const now = new Date();
    const start = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const end   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const events = await listUpcomingEvents(
      start.toISOString(),
      end.toISOString()
    );

    for (const event of events) {
      const telefone = event.description?.match(/\((\d+)\)/)?.[1];
      const nome = event.summary?.replace("Consulta - ", "");

      if (!telefone) continue;

      const dataLocal = new Date(event.start.dateTime).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza"
      });

      // 🔔 Envia template ao paciente
      await sendConfirmationTemplate({
        to: telefone,
        nome,
        data: dataLocal
      });

      // 🧠 Coloca o paciente no estado correto
      await setUserState(telefone, {
        step: "aguardando_confirmacao",
        temp: {
          eventId: event.id,
          data: dataLocal
        }
      });

      // 📣 Avisa você
      await notifyAdmin(
        `📌 Lembrete enviado\n👤 ${nome}\n📅 ${dataLocal}\n📱 ${telefone}`
      );
    }

    return res.status(200).json({ ok: true, enviados: events.length });
  } catch (err) {
    console.error("Erro no cron:", err);
    return res.status(500).json({ error: "cron_failed" });
  }
}
