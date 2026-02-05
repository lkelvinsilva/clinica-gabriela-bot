import { google } from "googleapis";

/* ===================== CONFIGURAÇÕES ===================== */
const TIMEZONE = process.env.TIMEZONE || "America/Fortaleza";

/* ===================== HELPERS ===================== */

// Cria data em UTC a partir de horário local de Fortaleza
function createDateUTC(date, hour, minute = 0) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour + 3, // Fortaleza (UTC-3) → UTC
    minute,
    0
  ));
}

function getNow() {
  return new Date(); // UTC puro (Vercel-safe)
}

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ]
  );
}

/* ===================== AVAILABLE SLOTS ===================== */
export async function getAvailableSlots({
  daysAhead = 45,
  durationMinutes = 60,
  period = "qualquer", // 'manha', 'tarde', 'qualquer'
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const now = getNow();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() + 1); // começa no próximo dia

  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const currentDay = new Date(now);
    currentDay.setUTCDate(now.getUTCDate() + d);

    let blocks = getBusinessHours(currentDay);
    if (!blocks) continue;

    if (period === "manha") {
      blocks = blocks.filter(b => b.start < 12);
    } else if (period === "tarde") {
      blocks = blocks.filter(b => b.start >= 13);
    }

    for (const block of blocks) {
      let cursor = createDateUTC(currentDay, block.start);
      const blockEnd = createDateUTC(currentDay, block.end);

      while (cursor.getTime() + durationMinutes * 60000 <= blockEnd.getTime()) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

        const res = await calendar.freebusy.query({
          requestBody: {
            timeMin: slotStart.toISOString(),
            timeMax: slotEnd.toISOString(),
            items: [{ id: calendarId }],
          },
        });

        const busy = res.data.calendars?.[calendarId]?.busy || [];

        if (busy.length === 0) {
          slots.push({
            iso: slotStart.toISOString(),
            label: slotStart.toLocaleString("pt-BR", {
              timeZone: TIMEZONE,
              dateStyle: "short",
              timeStyle: "short",
            }),
          });
        }

        cursor = new Date(cursor.getTime() + durationMinutes * 60000);
      }
    }
  }

  console.log(`DEBUG: Total de slots encontrados: ${slots.length}`);
  return slots;
}

/* ===================== CREATE EVENT ===================== */
export async function createEvent({
  summary,
  description,
  startISO,
  durationMinutes = 60,
  attendees = [],
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const startDate = new Date(startISO);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

  const event = {
    summary,
    description,
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
    attendees,
  };
  

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    resource: event,
  });

  return response.data;
}

/* ===================== CHECK SINGLE SLOT ===================== */
export async function isTimeSlotFree(startISO, durationMinutes = 60) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  const busy = res.data.calendars?.[calendarId]?.busy || [];
  return busy.length === 0;
}

/* ===================== REGRAS DE NEGÓCIO ===================== */
function getBusinessHours(date) {
  const day = date.getUTCDay();
  if (day === 0 || isHoliday(date)) return null;
  if (day === 6) return [{ start: 8, end: 12 }];
  return [
    { start: 9, end: 12 },
    { start: 13, end: 18 },
  ];
}

function isHoliday(date) {
  const holidays = [
    "01-01", "04-21", "05-01",
    "09-07", "10-12", "11-02",
    "11-15", "12-25",
  ];
  const mmdd =
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getUTCDate()).padStart(2, "0");
  return holidays.includes(mmdd);
}

export function isWithinBusinessHours(date) {
  const day = date.getUTCDay();
  const hour = date.getUTCHours() - 3; // converte p/ Fortaleza
  if (day === 0 || isHoliday(date)) return false;
  if (day === 6) return hour >= 8 && hour < 12;
  return (hour >= 9 && hour < 12) || (hour >= 13 && hour < 18);
}
/* ===================== LIST UPCOMING EVENTS ===================== */
export async function listUpcomingEvents(timeMinISO, timeMaxISO) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items || [];
}
