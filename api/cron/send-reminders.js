import { listUpcomingEvents, updateEventDescription } from "../utils/googleCalendar.js";
import { sendConfirmationTemplate } from "../utils/whatsapp.js";
import { setUserState } from "../utils/state.js";

export default async function handler(req, res) {
  try {
    
    // janela exata de 24h
    const events = await listUpcomingEvents(); // busca próximos eventos

    console.log("Eventos encontrados para lembrete:", events.length);

    for (const event of events) {
      const eventStart = new Date(event.start.dateTime);
const now = new Date();

// diferença em horas
const diffMs = eventStart.getTime() - now.getTime();
const diffHours = diffMs / (1000 * 60 * 60);

// ✅ só envia se estiver ENTRE 23h e 24h
if (diffHours < 23 || diffHours > 24) {
  console.log("⏱️ Fora da janela de 24h:", event.summary, diffHours.toFixed(2));
  continue;
}

if (event.status === "cancelled") {
  console.log("Evento cancelado, ignorado:", event.summary);
  continue;
}


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
        step: "confirmando_presenca",
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
