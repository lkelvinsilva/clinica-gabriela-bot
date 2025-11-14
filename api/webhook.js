// api/webhook.js
import axios from "axios";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

  // Verificação do webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verificado com sucesso!");
      res.status(200).send(challenge);
    } else {
      res.status(403).send("Erro de verificação do webhook");
    }
  }

  // Receber mensagens (POST)
  else if (req.method === "POST") {
    try {
      const body = req.body;

      if (body.object) {
        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message && message.type === "text") {
          const from = message.from;
          const text = message.text.body.toLowerCase();
          console.log("📩 Mensagem recebida:", text);

          let resposta = "Não entendi, poderia repetir?";

          if (text.includes("oi") || text.includes("olá")) {
            resposta = `Olá! Seja bem-vindo(a) 😊\n\nComo posso te ajudar?\n1️⃣ Agendar consulta\n2️⃣ Harmonização facial\n3️⃣ Orçamentos\n4️⃣ Odontologia\n5️⃣ Endereço\n6️⃣ Falar com a Dra. Gabriela`;
          }

          if (text.includes("1")) resposta = "Perfeito! Me diga o melhor dia e horário 🌼";
          if (text.includes("2")) resposta = "Envie 3 fotos (frente, perfil direito e esquerdo) 💆‍♀️";
          if (text.includes("3")) resposta = "Qual procedimento você quer saber o valor? 💰";
          if (text.includes("4")) resposta = "Trabalhamos com: clareamento, facetas, limpeza, restaurações e extração de siso 🦷";
          if (text.includes("5")) resposta = "Endereço: Av. Washington Soares, 3663 - Edson Queiroz, Fortaleza - CE, Sala 910-Torre 01 🏢";
          if (text.includes("6")) resposta = "Já estou avisando a Dra. Gabriela! Envie sua dúvida 🦷✨";

          // Enviar resposta via API do WhatsApp
          await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: "whatsapp",
              to: from,
              text: { body: resposta },
            },
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              },
            }
          );
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error("❌ Erro no webhook:", error.response?.data || error);
      res.status(500).send("Erro interno do servidor");
    }
  } else {
    res.status(404).send("Método não suportado");
  }
}
