import { isTimeslotFree, createEvent } from "../utils/googleCalendar.js";


(async () => {
  const start = new Date(Date.now() + 2 * 3600000).toISOString(); // 2h no futuro
  const end = new Date(Date.now() + 3 * 3600000).toISOString();

  console.log("🔎 Testando disponibilidade...");
  const free = await isTimeslotFree(start, end);
  console.log("Horário livre?", free);

  if (free) {
    console.log("📌 Criando evento...");
    const event = await createEvent({
      summary: "Teste automático",
      description: "Evento de teste",
      startISO: start,
      durationMinutes: 60,
    });

    console.log("📅 Evento criado:", event.htmlLink);
  }
})();
