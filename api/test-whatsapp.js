// /api/test-whatsapp.js
import { sendConfirmationTemplate } from "../utils/whatsapp.js";

export default async function handler(req, res) {
  await sendConfirmationTemplate({
    to: "55SEUNUMEROAQUI",
    paciente: "Teste Bot",
    data: "05/02 às 15h"
  });

  res.status(200).json({ ok: true });
}
