import axios from "axios";

export async function sendWhatsAppMessage(to, text) {
  if (!process.env.WHATSAPP_TOKEN) {
    throw new Error("WHATSAPP_TOKEN não definido no .env");
  }

  if (!process.env.PHONE_NUMBER_ID) {
    throw new Error("PHONE_NUMBER_ID não definido no .env");
  }

  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}
