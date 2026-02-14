import { listUpcomingEvents, updateEventDescription } from "../utils/googleCalendar.js";
import { sendConfirmationTemplate } from "../utils/whatsapp.js";
import { setUserState } from "../utils/state.js";

export default async function handler(req, res) {
  try {
    const now = new Date();

    // janela exata de 24h
    const startWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const endWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const events = await listUpcomingEvents(
      startWindow.toISOString(),
      endWindow.toISOString()
    );

    console.log("Eventos encontrados para lembrete:", events.length);

    for (const event of events) {

      // 🔥 1️⃣ Ignora se já enviou lembrete
      if (event.description?.includes("LEMBRETE_ENVIADO")) {
        console.log("Lembrete já enviado para:", event.summary);
        continue;
      }

      // 🔥 2️⃣ Ignora evento criado há menos de 1 hora
      const createdAt = new Date(event.created);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      if (createdAt > oneHourAgo) {
        console.log("Evento muito recente, ignorado:", event.summary);
        continue;
      }

      // 🔥 3️⃣ Extrai telefone da descrição
      const phoneMatch = event.description?.match(/\((\d+)\)/);
      if (!phoneMatch) continue;

      const phone = phoneMatch[1];
      const name = event.summary.replace("Consulta - ", "");

      const date = new Date(event.start.dateTime).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
      });

      console.log("Enviando lembrete para:", name);

      // 🔥 4️⃣ Envia template de lembrete
      await sendConfirmationTemplate({
        to: phone,
        paciente: name,
        data: date,
      });

      // 🔥 5️⃣ Atualiza estado do usuário
      await setUserState(phone, {
        step: "aguardando_confirmacao",
        temp: {
          appointmentDate: date,
          eventId: event.id,
        },
      });

      // 🔥 6️⃣ Marca evento como lembrete enviado
      await updateEventDescription(
        event.id,
        event.description + "\nLEMBRETE_ENVIADO"
      );

      console.log("Lembrete marcado como enviado:", event.summary);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Erro no cron de lembrete:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
