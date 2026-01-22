import { google } from "googleapis";

/* ===================== TIMEZONE ===================== */
const TIMEZONE = process.env.TIMEZONE || "America/Fortaleza";
const OFFSET = "-03:00";

/* ===================== HELPERS ===================== */
function nowInTimezone(timezone) {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone })
  );
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

/* ===================== FREE SLOT ===================== */
export async function isTimeSlotFree(startISO, durationMinutes = 60) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(startISO);
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

  return busy.length === 0;
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

  const startLocalISO =
    startDate
      .toLocaleString("sv-SE", { timeZone: TIMEZONE })
      .replace(" ", "T") + OFFSET;

  const endLocalISO =
    endDate
      .toLocaleString("sv-SE", { timeZone: TIMEZONE })
      .replace(" ", "T") + OFFSET;

  const event = {
    summary,
    description,
    start: { dateTime: startLocalISO, timeZone: TIMEZONE },
    end: { dateTime: endLocalISO, timeZone: TIMEZONE },
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
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const now = nowInTimezone(TIMEZONE);
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

      if (period === "manha") {
        startHour = 9;
        endHour = 12;
      }

      if (period === "tarde") {
        startHour = Math.max(startHour, 13);
      }

      let cursor = new Date(
        day.toLocaleString("en-US", { timeZone: TIMEZONE })
      );
      cursor.setHours(startHour, 0, 0, 0);

      const blockEnd = new Date(
        day.toLocaleString("en-US", { timeZone: TIMEZONE })
      );
      blockEnd.setHours(endHour, 0, 0, 0);

      while (cursor.getTime() + durationMinutes * 60000 <= blockEnd.getTime()) {
        if (cursor < now) {
          cursor.setMinutes(cursor.getMinutes() + 60);
          continue;
        }

        const start = new Date(cursor);
        const end = new Date(start.getTime() + durationMinutes * 60000);

        const res = await calendar.freebusy.query({
          requestBody: {
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            timeZone: TIMEZONE,
            items: [{ id: calendarId }],
          },
        });

        const busy =
          res.data.calendars?.[calendarId]?.busy || [];

        if (busy.length === 0) {
          const localISO =
            start
              .toLocaleString("sv-SE", { timeZone: TIMEZONE })
              .replace(" ", "T") + OFFSET;

          slots.push({
            iso: localISO,
            label: start.toLocaleString("pt-BR", {
              timeZone: TIMEZONE,
              dateStyle: "short",
              timeStyle: "short",
            }),
          });
        }

        cursor.setMinutes(cursor.getMinutes() + 60);
      }
    }
  }

  return slots;
}

/* ===================== BUSINESS RULES ===================== */
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

function getBusinessHours(date) {
  const day = date.getDay();

  if (day === 0 || isHoliday(date)) return null;

  if (day === 6) return [{ start: 8, end: 12 }];

  return [
    { start: 9, end: 12 },
    { start: 13, end: 18 },
  ];
}

export function isWithinBusinessHours(date) {
  const day = date.getDay();
  const hour = date.getHours();

  if (day === 0 || isHoliday(date)) return false;
  if (day === 6) return hour >= 8 && hour < 12;

  return (hour >= 9 && hour < 12) || (hour >= 13 && hour < 18);
}
