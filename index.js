import "dotenv/config";
console.log("TOKEN LIDO:", process.env.VERIFY_TOKEN);
import axios from "axios";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

const token = process.env.WHATSAPP_TOKEN;
const phoneId = process.env.PHONE_NUMBER_ID;
const verifyToken = process.env.VERIFY_TOKEN;

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const token = req.query["hub.verify_token"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receber mensagens
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (message && message.type === "text") {
        const from = message.from;  
        const text = message.text.body.toLowerCase();

        console.log("Mensagem recebida:", text);

        // Respostas automáticas
        let resposta = "Não entendi, poderia repetir?";

        if (text.includes("oi") || text.includes("olá")) {
          resposta = `Olá! Seja bem-vindo(a) 😊\n\nComo posso te ajudar?\n1️⃣ Agendar consulta\n2️⃣ Harmonização facial\n3️⃣ Orçamentos\n4️⃣ Odontologia\n5️⃣ Endereço\n6️⃣ Falar com a Dra. Gabriela`;
        }

        if (text.includes("1")) resposta = "Perfeito! Me diga o melhor dia e horário para agendar 🌼";
        if (text.includes("2")) resposta = "Envie 3 fotos (frente, perfil direito e esquerdo) para avaliação 💆‍♀️";
        if (text.includes("3")) resposta = "Qual procedimento você quer saber o valor? 💰";
        if (text.includes("4")) resposta = "Trabalhamos com: clareamento, facetas, limpeza, restaurações, radiologia, extração de siso";
        if (text.includes("5")) resposta = "Endereço: (Av. Washington Soares, 3663 - Edson Queiroz, Fortaleza - CE, Sala 910-Torre 01). Atendimento: segunda a sábado,";
        if (text.includes("6")) resposta = "Já estou avisando a Dra. Gabriela! Envie sua dúvida 🦷✨";

        // Enviar resposta
        await axios.post(
          `https://graph.facebook.com/v19.0/${phoneId}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: resposta }
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            }
          }
        );
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.sendStatus(500);
  }
});

// Iniciar servidor
app.listen(3000, () => {
  console.log("Bot rodando na porta 3000");
});
