import axios from "axios";

export async function notifyAdminNewAppointment({
  paciente,
  telefone,
  data
}) {
  const payload = {
    messaging_product: "whatsapp",
    to: process.env.ADMIN_PHONE, // WhatsApp do admin
    type: "template",
    template: {
      name: "nova_consulta_admin_utilidade", // TEMPLATE DE UTILIDADE
      language: {
        code: "pt_BR"
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: paciente },
            { type: "text", text: telefone },
            { type: "text", text: data }
          ]
        }
      ]
    }
  };

  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}
