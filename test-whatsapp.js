import "dotenv/config";
import { sendWhatsAppMessage } from "./utils/whatsapp.js";

await sendWhatsAppMessage(
  "5585992883317", // seu número com DDI
  "✅ Teste de mensagem do bot"
);

console.log("Mensagem enviada");
