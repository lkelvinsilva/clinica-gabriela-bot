import { google } from "googleapis";

/* ===================== CONFIGURAÇÕES ===================== */
const TIMEZONE = process.env.TIMEZONE || "America/Fortaleza";
const OFFSET = "-03:00"; 

/* ===================== HELPERS ===================== */

// Função crucial para Vercel: Garante que o "agora" seja sempre Fortaleza
function getNow() {
  const now = new Date();
  const parts = now.toLocaleString("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
  }).match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/);

  return new Date(
    parts[3],            // year
    parts[1] - 1,        // month
    parts[2],            // day
    parts[4],            // hour
    parts[5],            // minute
    parts[6]             // second
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
      "https://www.googleapis.com" 
    ]
  );
}

// Converte Date para RFC3339 local (Ex: 2026-01-22T14:00:00-03:00)
function formatToRFC3339(date) {
  const pad = (n) => (n < 10 ? "0" + n : n);
  const s = date.toLocaleString("en-US", { timeZone: TIMEZONE, hour12: false });
  const parts = s.match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/);
  
  const month = pad(parts[1]);
  const day = pad(parts[2]);
  const year = parts[3];
  const hour = pad(parts[4] === "24" ? "00" : parts[4]);
  const minute = pad(parts[5]);
  const second = pad(parts[6]);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${OFFSET}`;
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
    // Força a busca a começar do início do próximo dia útil
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + 1);

  const slots = [];

  for (let d = 0; d < daysAhead; d++) {
    const currentDay = new Date(now);
    currentDay.setDate(now.getDate() + d);
    currentDay.setHours(0, 0, 0, 0);
    
    let blocks = getBusinessHours(currentDay);
    if (!blocks) continue;

    // --- LOG 1 --- Verificar o período solicitado e os blocos iniciais
    console.log(`DEBUG: Processando dia ${currentDay.toDateString()} para o período: ${period}`);
    console.log(`DEBUG: Blocos de horários iniciais: ${JSON.stringify(blocks)}`);

    // FILTRO: Mantém apenas os blocos que correspondem ao período escolhido
    if (period === "manha") {
      blocks = blocks.filter(b => b.start < 12);
    } else if (period === "tarde") {
      // Filtra blocos que começam na parte da tarde (13h+)
      blocks = blocks.filter(b => b.start >= 13);
    }
    
    // --- LOG 2 --- Verificar o resultado do filtro
    console.log(`DEBUG: Blocos após o filtro de período: ${JSON.stringify(blocks)}`);

    for (const block of blocks) {
      let cursor = new Date(currentDay);
      cursor.setHours(block.start, 0, 0, 0);

      const blockEnd = new Date(currentDay);
      blockEnd.setHours(block.end, 0, 0, 0);

      while (cursor.getTime() + durationMinutes * 60000 <= blockEnd.getTime()) {


        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

        try {
           // --- LOG 3 --- Verificar o horário exato enviado para o Google
           console.log(`DEBUG: Verificando slot timeMin: ${formatToRFC3339(slotStart)}`);

           const res = await calendar.freebusy.query({
             requestBody: {
               timeMin: formatToRFC3339(slotStart),
               timeMax: formatToRFC3339(slotEnd),
               items: [{ id: calendarId }],
             },
           });

           const busy = res.data.calendars?.[calendarId]?.busy || [];

           if (busy.length === 0) {
             slots.push({
               iso: formatToRFC3339(slotStart),
               label: slotStart.toLocaleString("pt-BR", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" }),
             });
           }
         } catch (error) {
           console.error("Erro na consulta de FreeBusy:", error?.response?.data || error.message);
         }
        
        cursor.setMinutes(cursor.getMinutes() + durationMinutes);
      }
    }
  }

  // --- LOG 4 --- Verificar o total de slots encontrados no final
  console.log(`DEBUG: Total de slots encontrados: ${slots.length}`);
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

/* ===================== CHECK SINGLE SLOT ===================== */
// Função necessária para resolver o SyntaxError no webhook.js
export async function isTimeSlotFree(startISO, durationMinutes = 60) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: formatToRFC3339(start),
      timeMax: formatToRFC3339(end),
      items: [{ id: calendarId }],
    },
  });

  const busy = res.data.calendars?.[calendarId]?.busy || [];
  return busy.length === 0;
}


/* ===================== REGRAS DE NEGÓCIO ===================== */
function getBusinessHours(date) {
  const day = date.getDay(); 
  if (day === 0 || isHoliday(date)) return null; // Domingo
  if (day === 6) return [{ start: 8, end: 12 }]; // Sábado
  return [{ start: 9, end: 12 }, { start: 13, end: 18 }]; // Semana
}

function isHoliday(date) {
  const holidays = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];
  const mmdd = String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  return holidays.includes(mmdd);
}

export function isWithinBusinessHours(date) {
  const day = date.getDay();
  const hour = date.getHours();
  if (day === 0 || isHoliday(date)) return false;
  if (day === 6) return hour >= 8 && hour < 12;
  return (hour >= 9 && hour < 12) || (hour >= 13 && hour < 18);
}


