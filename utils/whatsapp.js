import axios from "axios";

export async function notifyAdminNewAppointment({
  paciente,
  telefone,
  data
}) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: process.env.ADMIN_PHONE, // seu WhatsApp pessoal
      type: "template",
      template: {
        name: "nova_consulta_admin_utilidade", // nome EXATO do modelo
        language: { code: "pt_BR" },
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
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}
