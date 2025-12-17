import axios from "axios";

try {
  await notifyAdminNewAppointment({
    paciente: nome,
    telefone: from,
    data: startLocal
  });
} catch (err) {
  console.error("Erro ao notificar admin no WhatsApp:", err?.response?.data || err);
}
 {
  const payload = {
    messaging_product: "whatsapp",
    to: process.env.ADMIN_PHONE, // ⚠️ obrigatório
    type: "template",
    template: {
      name: "nova_consulta_admin_utilidade",
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
    `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}
