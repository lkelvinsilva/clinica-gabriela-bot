import { google } from "googleapis";

function nowInTimezone(timezone) {
  const now = new Date();
  return new Date(
    now.toLocaleString("en-US", { timeZone: timezone })
  );
}

function toCalendarDateTime(date, timezone) {
  return {
    dateTime: date.toISOString().replace("Z", ""),
    timeZone: timezone
  };
}

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"]
  );
}

export async function isTimeSlotFree(startISO, durationMinutes = 60) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: start,
      timeMax: end,

      timeZone: process.env.TIMEZONE || "America/Fortaleza",
      items: [{ id: process.env.GOOGLE_CALENDAR_ID }]
    }
  });

  const busy =
    res.data.calendars?.[process.env.GOOGLE_CALENDAR_ID]?.busy || [];

  return busy.length === 0;
}


export async function createEvent({ summary, description, startISO, durationMinutes = 60, attendees = [] }) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const event = {
    summary,
    description,
    start: { dateTime: start.toISOString(), timeZone: process.env.TIMEZONE || "America/Fortaleza" },
    end: { dateTime: end.toISOString(), timeZone: process.env.TIMEZONE || "America/Fortaleza" },
    attendees
  };

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    resource: event
  });

  return response.data;
}

export async function listUpcomingEvents(timeMinISO, timeMaxISO) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: true,
    orderBy: "startTime"
  });
  return res.data.items || [];
}

export async function getAvailableSlots({
  daysAhead = 5,
  durationMinutes = 60,
  period = "qualquer",
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const timezone = process.env.TIMEZONE || "America/Fortaleza";
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const now = nowInTimezone(timezone);
  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    day.setHours(0, 0, 0, 0);

    const businessBlocks = getBusinessHours(day);
    if (!businessBlocks) continue; // domingo ou feriado

    for (const block of businessBlocks) {
      let startHour = block.start;
      let endHour = block.end;

      // 🔹 filtro de período
      if (period === "manha") {
        endHour = Math.min(endHour, 11);
      }

      if (period === "tarde") {
        startHour = Math.max(startHour, 13);
      }

      for (let h = startHour; h <= endHour - durationMinutes / 60; h++) {
        const start = new Date(day);
        start.setHours(h, 0, 0, 0);

        // ❌ não permitir horários passados
        if (start < now) continue;

        const end = new Date(start.getTime() + durationMinutes * 60000);

        const res = await calendar.freebusy.query({
          requestBody: {
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            timeZone: timezone,
            items: [{ id: calendarId }],
          },
        });

        const busy = res.data.calendars?.[calendarId]?.busy || [];

        if (busy.length === 0) {
          slots.push({
            iso: start.toISOString(),
            label: start.toLocaleString("pt-BR", {
              timeZone: timezone,
              dateStyle: "short",
              timeStyle: "short",
            }),
          });
        }
      }
    }
  }

  return slots;
}


function isHoliday(date) {
  const holidays = [
    "01-01", // Confraternização Universal
    "04-21", // Tiradentes
    "05-01", // Dia do Trabalhador
    "09-07", // Independência
    "10-12", // Nossa Senhora Aparecida
    "11-02", // Finados
    "11-15", // Proclamação da República
    "12-25", // Natal
  ];

  const mmdd = String(date.getMonth() + 1).padStart(2, "0") +
               "-" +
               String(date.getDate()).padStart(2, "0");

  return holidays.includes(mmdd);
}
function getBusinessHours(date) {
  const day = date.getDay(); // 0=Domingo, 6=Sábado

  // ❌ Domingo
  if (day === 0) return null;

  // ❌ Feriado
  if (isHoliday(date)) return null;

  // 🟢 Sábado: 08–12 (sem almoço)
  if (day === 6) {
    return [{ start: 8, end: 12 }];
  }

  // 🟢 Seg–Sex: 09–12 e 13–18
  return [
    { start: 9, end: 12 },
    { start: 13, end: 18 },
  ];
}
export function isWithinBusinessHours(date) {
  const day = date.getDay(); // 0 = domingo
  const hour = date.getHours();

  // ❌ Domingo
  if (day === 0) return false;

  // ❌ Feriado
  if (isHoliday(date)) return false;

  // 🟢 Sábado: 08–12
  if (day === 6) {
    return hour >= 8 && hour < 12;
  }

  // 🟢 Seg–Sex: 09–12 ou 13–18
  const morning = hour >= 9 && hour < 12;
  const afternoon = hour >= 13 && hour < 18;

  return morning || afternoon;
}

