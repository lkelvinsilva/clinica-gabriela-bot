import axios from "axios";

export async function sendConfirmationTemplate({ to, nome, data }) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "confirmacao_consulta_24h",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: nome },
              { type: "text", text: data },
            ],
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

export async function notifyAdminReminder({ paciente, telefone, data }) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: process.env.ADMIN_PHONE,
      text: {
        body:
          `⏰ *Lembrete enviado*\n\n` +
          `Paciente: ${paciente}\n` +
          `Telefone: ${telefone}\n` +
          `Consulta: ${data}`,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}
