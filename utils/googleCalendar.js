import { google } from "googleapis";

/* ===================== CONFIGURAÇÕES ===================== */
const TIMEZONE = process.env.TIMEZONE || "America/Fortaleza";
// Em 2026, garantimos que o offset seja tratado dinamicamente ou mantido fixo como string
const OFFSET = "-03:00"; 

/* ===================== HELPERS ===================== */
function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com"]
  );
}

// Converte um objeto Date para o formato que o Google entende respeitando o fuso local
function formatToRFC3339(date) {
  const pad = (n) => (n < 10 ? "0" + n : n);
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  
  // Retorna YYYY-MM-DDTHH:mm:ss-03:00
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${OFFSET}`;
}

/* ===================== AVAILABLE SLOTS ===================== */
export async function getAvailableSlots({
  daysAhead = 21,
  durationMinutes = 60,
  period = "qualquer",
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  // Data atual no fuso configurado
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const currentDay = new Date(now);
    currentDay.setDate(now.getDate() + d);
    
    const blocks = getBusinessHours(currentDay);
    if (!blocks) continue;

    for (const block of blocks) {
      let startHour = block.start;
      let endHour = block.end;

      if (period === "manha") { endHour = Math.min(endHour, 12); }
      if (period === "tarde") { startHour = Math.max(startHour, 13); }

      let cursor = new Date(currentDay);
      cursor.setHours(startHour, 0, 0, 0);

      const blockEnd = new Date(currentDay);
      blockEnd.setHours(endHour, 0, 0, 0);

      while (cursor.getTime() + durationMinutes * 60000 <= blockEnd.getTime()) {
        // Ignora horários que já passaram hoje
        if (cursor <= now) {
          cursor.setMinutes(cursor.getMinutes() + durationMinutes);
          continue;
        }

        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

        // CORREÇÃO CRÍTICA: Enviar o tempo formatado com OFFSET, não toISOString()
        const res = await calendar.freebusy.query({
          requestBody: {
            timeMin: formatToRFC3339(slotStart),
            timeMax: formatToRFC3339(slotEnd),
            timeZone: TIMEZONE,
            items: [{ id: calendarId }],
          },
        });

        const busy = res.data.calendars?.[calendarId]?.busy || [];

        if (busy.length === 0) {
          slots.push({
            iso: formatToRFC3339(slotStart),
            label: slotStart.toLocaleString("pt-BR", {
              timeZone: TIMEZONE,
              dateStyle: "short",
              timeStyle: "short",
            }),
          });
        }
        cursor.setMinutes(cursor.getMinutes() + durationMinutes);
      }
    }
  }
  return slots;
}

/* ===================== CREATE EVENT ===================== */
export async function createEvent({ summary, description, startISO, durationMinutes = 60, attendees = [] }) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const startDate = new Date(startISO);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

  const event = {
    summary,
    description,
    start: { dateTime: formatToRFC3339(startDate), timeZone: TIMEZONE },
    end: { dateTime: formatToRFC3339(endDate), timeZone: TIMEZONE },
    attendees,
  };

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    resource: event,
  });

  return response.data;
}

/* ===================== REGRAS DE NEGÓCIO ===================== */
function getBusinessHours(date) {
  const day = date.getDay();
  // 0 = Domingo, 6 = Sábado
  if (day === 0 || isHoliday(date)) return null;
  if (day === 6) return [{ start: 8, end: 12 }];
  return [{ start: 9, end: 12 }, { start: 13, end: 18 }];
}

function isHoliday(date) {
  const holidays = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];
  const mmdd = String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  return holidays.includes(mmdd);
}
