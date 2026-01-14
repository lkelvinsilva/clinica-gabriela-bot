import { google } from "googleapis";

const TIMEZONE = process.env.TIMEZONE || "America/Fortaleza";

/* ===================== AUTH ===================== */
function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar"]
  );
}

/* ===================== UTIL ===================== */
function nowInTimezone() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function toLocalISO(date) {
  return date
    .toLocaleString("sv-SE", { timeZone: TIMEZONE })
    .replace(" ", "T");
}

/* ===================== EVENT ===================== */
export async function createEvent({
  summary,
  description,
  startISO,
  durationMinutes = 60,
  attendees = [],
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  // startISO = "2026-01-15T09:00"
  const [datePart, timePart] = startISO.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  const startLocal = new Date(year, month - 1, day, hour, minute);
  const endLocal = new Date(
    startLocal.getTime() + durationMinutes * 60000
  );

  const event = {
    summary,
    description,
    start: {
      dateTime: toLocalISO(startLocal),
      timeZone: TIMEZONE,
    },
    end: {
      dateTime: toLocalISO(endLocal),
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

/* ===================== AVAILABLE SLOTS ===================== */
export async function getAvailableSlots({
  daysAhead = 21,
  durationMinutes = 60,
  period = "qualquer",
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const now = nowInTimezone();
  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    day.setHours(0, 0, 0, 0);

    const blocks = getBusinessHours(day);
    if (!blocks) continue;

    for (const block of blocks) {
      let startHour = block.start;
      let endHour = block.end;

      // 🎯 filtro manhã
      if (period === "manha") {
        startHour = Math.max(startHour, 9);
        endHour = Math.min(endHour, 12);
      }

      // 🎯 filtro tarde
      if (period === "tarde") {
        startHour = Math.max(startHour, 13);
      }

      let cursor = new Date(
        new Date(day).toLocaleString("en-US", { timeZone: TIMEZONE })
      );
      cursor.setHours(startHour, 0, 0, 0);

      const blockEnd = new Date(
        new Date(day).toLocaleString("en-US", { timeZone: TIMEZONE })
      );
      blockEnd.setHours(endHour, 0, 0, 0);

      while (
        cursor.getTime() + durationMinutes * 60000 <= blockEnd.getTime()
      ) {
        if (cursor < now) {
          cursor.setMinutes(cursor.getMinutes() + durationMinutes);
          continue;
        }

        const start = new Date(cursor);
        const end = new Date(start.getTime() + durationMinutes * 60000);

        const res = await calendar.freebusy.query({
          requestBody: {
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            timeZone: TIMEZONE,
            items: [{ id: process.env.GOOGLE_CALENDAR_ID }],
          },
        });

        const busy =
          res.data.calendars?.[process.env.GOOGLE_CALENDAR_ID]?.busy || [];

        if (busy.length === 0) {
          slots.push({
            iso: toLocalISO(start),
            label: start.toLocaleString("pt-BR", {
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

  return slots.slice(0, 6);
}

/* ===================== BUSINESS RULES ===================== */
function getBusinessHours(date) {
  const day = date.getDay(); // 0 = domingo

  if (day === 0) return null; // domingo
  if (isHoliday(date)) return null;

  // sábado
  if (day === 6) {
    return [{ start: 9, end: 12 }];
  }

  // segunda a sexta
  return [
    { start: 9, end: 12 },  // manhã
    { start: 13, end: 18 }, // tarde
  ];
}

function isHoliday(date) {
  const holidays = [
    "01-01",
    "04-21",
    "05-01",
    "09-07",
    "10-12",
    "11-02",
    "11-15",
    "12-25",
  ];

  const mmdd =
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0");

  return holidays.includes(mmdd);
}
