import { google } from "googleapis";

/* ===================== CONFIGURAÇÕES ===================== */
const TIMEZONE = process.env.TIMEZONE || "America/Fortaleza";

/* ===================== HELPERS ===================== */

// Garante que o "agora" seja sempre baseado no fuso correto
function getNow() {
  const now = new Date();
  const local = new Date(
    now.toLocaleString("en-US", { timeZone: TIMEZONE })
  );
  return local;
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
  daysAhead = 21,
  durationMinutes = 60,
  period = "qualquer", // 'manha', 'tarde', 'qualquer'
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const now = getNow();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + 1); // começa no próximo dia

  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const currentDay = new Date(now);
    currentDay.setDate(now.getDate() + d);
    currentDay.setHours(0, 0, 0, 0);

    let blocks = getBusinessHours(currentDay);
    if (!blocks) continue;

    // filtro manhã / tarde
    if (period === "manha") {
      blocks = blocks.filter(b => b.start < 12);
    } else if (period === "tarde") {
      blocks = blocks.filter(b => b.start >= 13);
    }

    for (const block of blocks) {
      let cursor = new Date(currentDay);
      cursor.setHours(block.start, 0, 0, 0);

      const blockEnd = new Date(currentDay);
      blockEnd.setHours(block.end, 0, 0, 0);

      while (cursor.getTime() + durationMinutes * 60000 <= blockEnd.getTime()) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

        try {
          console.log("DEBUG freebusy:", {
            timeMin: slotStart.toISOString(),
            timeMax: slotEnd.toISOString(),
          });

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
        } catch (error) {
          console.error(
            "Erro FreeBusy:",
            error?.response?.data || error.message
          );
        }

        cursor.setMinutes(cursor.getMinutes() + durationMinutes);
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
    start: {
      dateTime: startDate.toISOString(),
      timeZone: TIMEZONE,
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: TIMEZONE,
    },
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
  const day = date.getDay();
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
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0");
  return holidays.includes(mmdd);
}

export function isWithinBusinessHours(date) {
  const day = date.getDay();
  const hour = date.getHours();
  if (day === 0 || isHoliday(date)) return false;
  if (day === 6) return hour >= 8 && hour < 12;
  return (hour >= 9 && hour < 12) || (hour >= 13 && hour < 18);
}
