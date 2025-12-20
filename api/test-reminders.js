import { sendConfirmationTemplate } from "../utils/whatsapp.js";

export default async function handler(req, res) {
  try {
    const result = await sendConfirmationTemplate({
      to: "5585994000246", // SEU NÚMERO
      paciente: "Luã",
      data: "20/12/2025 às 15:00"
    });

    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: "failed" });
  }
}
