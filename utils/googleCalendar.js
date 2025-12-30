import { google } from "googleapis";

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
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
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

  const now = new Date();
  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);

    const startHour = period === "tarde" ? 13 : 9;
    const endHour = period === "manha" ? 12 : 18;

    for (let h = startHour; h <= endHour - 1; h++) {
      const start = new Date(day);
      start.setHours(h, 0, 0, 0);

      const end = new Date(start.getTime() + durationMinutes * 60000);

      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          timeZone: timezone,
          items: [{ id: calendarId }],
        },
      });

      const busy =
        res.data.calendars?.[calendarId]?.busy || [];

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

  return slots;
}
