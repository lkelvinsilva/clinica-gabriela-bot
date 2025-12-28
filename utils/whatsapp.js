import axios from "axios";

/* 🔔 ADMIN – nova consulta */
export async function notifyAdminNewAppointment({
  paciente,
  telefone,
  data
}) {
  const payload = {
    messaging_product: "whatsapp",
    to: process.env.ADMIN_PHONE,
    type: "template",
    template: {
      name: "nova_consulta_admin_utilidade_",
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

/* 📩 PACIENTE – confirmação */
export async function sendConfirmationTemplate({
  to,
  paciente,
  data
}) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "confirmacao_consulta_paciente", // seu template aprovado
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: paciente },
            { type: "text", text: data }
          ]
        }
      ]
    }
  };
console.log("DEBUG_WHATSAPP_ID_USED:", process.env.PHONE_NUMBER_ID);
<<<<<<< HEAD

=======
>>>>>>> e38d3f71c301b33481c9012519a0d4e0c85c8375
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
