import { sendConfirmationTemplate } from "../utils/whatsapp.js";

export default async function handler(req, res) {
  try {
    const result = await sendConfirmationTemplate({
      to: "5585994000246", // Substitua pelo SEU NÚMERO DE WHATSAPP para testar
      paciente: "Luã",
      data: "21/12/2025 às 15:00"
    });

    res.status(200).json({
      ok: true,
      message: "Requisição enviada com sucesso para a API da Meta. Verifique os logs para confirmação do status.",
      result
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "failed", details: err.message });
  }
}
