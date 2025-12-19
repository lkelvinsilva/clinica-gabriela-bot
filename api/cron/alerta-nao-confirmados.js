import { getAllStates } from "../utils/state.js";
import axios from "axios";

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    { messaging_product: "whatsapp", to, text: { body: text } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

export default async function handler(req, res) {
  const states = await getAllStates();

  for (const [phone, state] of Object.entries(states)) {
    if (state.step === "aguardando_confirmacao") {
      await sendMessage(
        process.env.ADMIN_PHONE,
        `⚠️ *Paciente NÃO confirmou consulta*\nTelefone: ${phone}`
      );
    }
  }

  res.status(200).send("ok");
}
