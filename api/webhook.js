import axios from "axios";
import { google } from "googleapis";

let userState = {}; // armazenar progresso das conversas

export default async function handler(req, res) {

  // ▓▓▓ VERIFICAÇÃO DO WEBHOOK (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  // ▓▓▓ RECEBIMENTO DE MENSAGENS (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;

      const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!msg) return res.sendStatus(200);

      const from = msg.from;
      const text = msg.text?.body?.toLowerCase() || "";

      console.log("Mensagem recebida:", text);

      // Criar estado se não existir
      if (!userState[from]) {
        userState[from] = { etapa: null };
      }

      // ▓▓▓ 1. Fluxo inicial
      if (text.includes("oi") || text.includes("olá")) {
        return sendMessage(
          from,
          "Olá! Seja bem-vindo(a) 😊\n\nComo posso te ajudar?\n" +
          "1️⃣ Agendar consulta\n" +
          "2️⃣ Harmonização facial\n" +
          "3️⃣ Orçamentos\n" +
          "4️⃣ Odontologia\n" +
          "5️⃣ Endereço\n" +
          "6️⃣ Falar com a Dra. Gabriela"
        );
      }

      // ▓▓▓ 2. Iniciar agendamento
      if (text.includes("1")) {
        userState[from].etapa = "aguardando_data";
        return sendMessage(from, "Ótimo! Informe a *data e hora* desejada.\nExemplo:\n15/12/2025 14:00");
      }

      // ▓▓▓ 3. Etapa de captura da data/hora
      if (userState[from].etapa === "aguardando_data") {
        const dataISO = converterDataParaISO(text);

        if (!dataISO) {
          return sendMessage(from, "Formato inválido 😕\nEnvie a data assim:\n*15/12/2025 14:00*");
        }

        // Criar evento no Google Agenda
        const event = await criarEventoGoogle(from, dataISO);

        if (event) {
          await sendMessage(from, "✅ Consulta agendada com sucesso!");
        } else {
          await sendMessage(from, "⚠️ Erro ao criar agendamento. Tente novamente.");
        }

        userState[from] = {}; // limpa estado
        return res.sendStatus(200);
      }

      // ▓▓▓ Outras opções
      if (text.includes("2"))
        return sendMessage(from, "Envie 3 fotos (frente, perfil direito e esquerdo) para avaliação 💆‍♀️");

      if (text.includes("3"))
        return sendMessage(from, "Qual procedimento você quer saber o valor? 💰");

      if (text.includes("4"))
        return sendMessage(
          from,
          "Trabalhamos com: clareamento, facetas, limpeza, restaurações, radiologia e extração de siso 💎"
        );

      if (text.includes("5"))
        return sendMessage(
          from,
          "📍 Endereço: Av. Washington Soares, 3663 - Edson Queiroz, Fortaleza - CE, Sala 910 - Torre 01."
        );

      if (text.includes("6"))
        return sendMessage(from, "Claro! Já estou avisando a Dra. Gabriela 👩‍⚕️✨\nEnvie sua dúvida.");

      // Resposta padrão
      return sendMessage(from, "Desculpe, não entendi. Pode repetir?");
    }

    catch (err) {
      console.error("Erro no webhook:", err);
      return res.sendStatus(500);
    }
  }

  return res.sendStatus(404);
}

//
// ▓▓▓ FUNÇÃO GOOGLE CALENDAR
//
async function criarEventoGoogle(phone, dataISO) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    const start = new Date(dataISO);
    const end = new Date(start.getTime() + 60 * 60 * 1000).toISOString();

    const event = {
      summary: `Consulta agendada (${phone})`,
      description: "Agendamento automático via WhatsApp",
      start: { dateTime: dataISO, timeZone: "America/Fortaleza" },
      end: { dateTime: end, timeZone: "America/Fortaleza" }
    };

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: event
    });

    return response.data;

  } catch (err) {
    console.error("Erro ao criar evento:", err);
    return null;
  }
}

//
// ▓▓▓ TRANSFORMAR TEXTO EM DATA ISO
//
function converterDataParaISO(texto) {
  const partes = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);

  if (!partes) return null;

  const [_, dia, mes, ano, hora, minuto] = partes;

  const iso = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:00-03:00`).toISOString();

  return iso;
}

//
// ▓▓▓ FUNÇÃO PARA ENVIAR MENSAGEM WHATSAPP
//
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}
