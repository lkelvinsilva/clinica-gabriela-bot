import axios from "axios";
import { getUserState, setUserState, isDuplicateMessage } from "../utils/state.js";
import { isTimeSlotFree,createEvent, getAvailableSlots } from "../utils/googleCalendar.js";
import { isWithinBusinessHours } from "../utils/googleCalendar.js";
import { appendRow } from "../utils/googleSheets.js";
import { notifyAdminNewAppointment,sendConfirmationTemplate } from "../utils/whatsapp.js";

// ---------------------- PARSE DE DATA ----------------------
function parseDateTime(text) {
  // Regex para pegar DD/MM/YYYY HH:mm
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:às\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  
  const [, d, mo, y, hh, mm] = m;
  
  // Criamos a string no formato ISO local SEM o "Z" no final
  // O seu arquivo googleCalendar.js (que corrigimos antes) cuidará do OFFSET
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:00`;
}


// ---------------------- ENVIO DE MENSAGEM SIMPLES ----------------------
async function sendMessage(to, text) {
  
  try {
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
  } catch (err) {
    console.error("Erro ao enviar mensagem (sendMessage):", err?.response?.data || err);
  }
}

// ---------------------- ENVIO DE BOTÕES INTERATIVOS ----------------------
async function sendButtons(to, question, buttons) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: question },
          action: {
            buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Erro ao enviar botões (sendButtons):", err?.response?.data || err);
  }
}

async function perguntarAlgoMais(to) {
  await sendButtons(to, "Posso ajudar com mais alguma coisa?", [
    { id: "help_sim", title: "Sim" },
    { id: "help_nao", title: "Não" },
  ]);
}

// ---------------------- HANDLER ----------------------
export default async function handler(req, res) {
  // ... dentro do export default async function handler(req, res)

  // webhook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("method_not_allowed");
  }

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.status(200).send("no_message");

   const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
if (!message) return res.status(200).send("no_message");

const msgId = message.id;
const from = message.from;

let incomingText = "";

// ✅ TEXTO DIGITADO
if (message.type === "text" && message.text?.body) {
  incomingText = message.text.body;
}

// ✅ BOTÃO DE TEMPLATE (Cloud API)
else if (message.type === "button" && message.button?.payload) {
  incomingText = message.button.payload;
}

// ✅ BOTÃO INTERATIVO (listas / botões não-template)
else if (message.interactive?.button_reply) {
  incomingText =
    message.interactive.button_reply.id ||
    message.interactive.button_reply.title;
}

// normalização FINAL
const text = String(incomingText || "").trim().toLowerCase();
const lower = text;
const numeric = lower.replace(/[^0-9]/g, "");

    if (await isDuplicateMessage(msgId)) {
      console.log("Mensagem duplicada ignorada:", msgId);
      return res.status(200).send("duplicate");
    }

    let state = (await getUserState(from)) || { step: "menu", temp: {} };
    if (!state.step) state.step = "menu";
    if (!state.temp) state.temp = {};

    // comando de saída
    if (["sair", "encerrar", "finalizar", "cancelar", "0"].includes(lower)) {
      await sendMessage(from, "😊 Atendimento encerrado.\n\nSe precisar de algo, é só digitar *menu*.");
      await setUserState(from, { step: "menu", temp: {} });
      return res.status(200).send("session_ended");
    }

        // ---------- CONFIRMAÇÃO / CANCELAMENTO DE CONSULTA ----------

// ---------- CONFIRMAÇÃO / CANCELAMENTO DE CONSULTA ----------
if (state.step === "aguardando_confirmacao") {


  if (text === "confirmar") {
    await sendMessage(from, "✅ Consulta confirmada! Te aguardamos 💚");
    await setUserState(from, { step: "menu", temp: {} });
    return res.status(200).send("confirmed");
  }

  if (text === "cancelar") {
    await sendMessage(from, "❌ Consulta desmarcada. Obrigada por avisar.");
    await setUserState(from, { step: "menu", temp: {} });
    return res.status(200).send("cancelled");
  }

  await sendMessage(from, "Por favor, use os botões *Confirmar* ou *Cancelar*.");
  return res.status(200).send("invalid_confirmation");
}
console.log("DEBUG TEMPLATE BUTTON:", entry.interactive?.button_reply);



    // ---------- MENU PRINCIPAL ----------
    if (
      lower === "menu" ||
      lower === "oi" ||
      lower === "ola" ||
      lower === "olá" ||
      lower === "bom dia" ||
      lower === "boa tarde" ||
      lower === "boa noite"
    ) {
      state.step = "menu";
      state.temp = {};
      await setUserState(from, state);

      await sendMessage(
        from,
        `Olá! Seja bem vinda (o) 😊\n\nSou a assistente da Dra. Gabriela Campos e vou te ajudar com informações e agendamento de consultas.\n\nPara agendar, escolha uma das opções abaixo 👇\n\n` +
          `1️⃣ Serviços odontológicos\n` +
          `2️⃣ Harmonização facial\n` +
          `3️⃣ Endereço\n` +
          `4️⃣ Falar com a Dra. Gabriela\n\n` +
          `✍️ Digite apenas o número da opção desejada ou digite *sair* para encerrar o atendimento.`
      );

      return res.status(200).send("menu_sent");
    }

    // Se estamos no estado inicial "menu" e o usuário enviou uma opção:
    if (state.step === "menu") {
      // opção 1 — odontologia (sub-menu)
      if (lower === "1" || numeric === "1") {
        state.step = "odontologia_menu";
        await setUserState(from, state);

        await sendMessage(
          from,

          `🦷 *Serviços Odontológicos*\n\nSelecione o serviço que deseja agendar:\n\n` +
            `1️⃣ Facetas ou Estratificação\n` +
            `2️⃣ Limpeza Dental/Manutenção\n` +
            `3️⃣ Extração de Siso\n` +
            `4️⃣ Clareamento Dental\n` +
            `5️⃣ Outro serviço\n\n` +
            `Digite o número da opção ou *menu* para voltar.`
        );
        return res.status(200).send("odontologia_menu");
      }

      // opção 2 — harmonização
      if (lower === "2" || numeric === "2" || lower.includes("harmonizacao") || lower.includes("harmonização")) {
        state.step = "harmonizacao_procedimento";
        state.temp = {};
        await setUserState(from, state);

        await sendMessage(
          from,
          `✨ *Harmonização Facial*\n\n` +
          `Escolha o procedimento desejado:\n\n` +
          `1️⃣ *Preenchimento Labial*\n` +
          `💋 Melhora o contorno, volume e hidratação dos lábios.\n\n` +
          `2️⃣ *Toxina Botulínica (Botox)*\n` +
          `✨ Suaviza rugas de expressão (testa, glabela e pés de galinha).\n\n` +
          `3️⃣ *Preenchimento Mentual*\n` +
          `🧬 Realça e projeta o queixo para mais harmonia facial.\n\n` +
          `4️⃣ *Rinomodelação*\n` +
          `👃 Ajustes sutis no nariz sem cirurgia.\n\n` +
          `5️⃣ *Preenchimento do Bigode Chinês*\n` +
          `😊 Suaviza sulcos nasogenianos.\n\n` +
          `6️⃣ *Preenchimento Mandibular*\n` +
          `🦴 Define e contorna a mandíbula.\n\n` +
          `7️⃣ *Bioestimulador de Colágeno*\n` +
          `🧪 Melhora firmeza, textura e estimula colágeno.\n\n` +
          `8️⃣ *Outros procedimentos*\n` +
          `💬 Basta enviar o nome ou o número do procedimento que deseja saber mais.`
        );

        return res.status(200).send("harmonizacao_menu");
      }

      // opção 3 — endereço
      if (lower === "3" || numeric === "3") {
        await sendMessage(from, "📍 Nosso endereço é: Av. Washington Soares, 3663 - Sala 910 - Torre 01 - Fortaleza - CE.");
        await perguntarAlgoMais(from);
        state.step = "perguntar_algo_mais";
        await setUserState(from, state);
        return res.status(200).send("ask_more");
      }

      // opção 4 — falar com a Dra.
      if (lower === "4" || numeric === "4") {
        const numero = "5585992883317";
        const mensagem = encodeURIComponent("Olá! Gostaria de falar com você.");
        const link = `https://wa.me/${numero}?text=${mensagem}`;

        await sendMessage(
          from,
          `📞 Claro! Vou te encaminhar para a Dra. Gabriela. Aguarde contato!\n\n` +
            `👉 Clique no link abaixo para falar diretamente com ela no WhatsApp:\n${link}`
        );
        await perguntarAlgoMais(from);
        state.step = "perguntar_algo_mais";
        await setUserState(from, state);
        return res.status(200).send("ask_more");
      }

      // inválido no menu
      await sendMessage(from, "Opção inválida. Digite *menu* para ver as opções.");
      return res.status(200).send("menu_invalid");
    }

    // ---------- SUBMENU ODONTOLOGIA ----------
    if (state.step === "odontologia_menu") {
      if (lower === "menu") {
        state.step = "menu";
        state.temp = {};
        await setUserState(from, state);
        await sendMessage(from, "Voltando ao menu principal. Digite *menu* para exibir as opções.");
        return res.status(200).send("back_to_menu");
      }

      const procedimentosOdonto = {

        "1": "Facetas ou Estratificação",
        "2": "Limpeza Dental/Manutenção",
        "3": "Extração de Siso",
        "4": "Clareamento Dental",
        "5": "Outro serviço",
      };

      const escolhido = procedimentosOdonto[numeric] || procedimentosOdonto[text];
      if (!escolhido) {
        await sendMessage(from, "❌ Opção inválida. Digite o número do procedimento ou *menu* para voltar.");
        return res.status(200).send("invalid_odontologia_option");
      }

      if (numeric === "5") {
        state.step = "odontologia_outro_servico";
        await setUserState(from, state);

        await sendMessage(
          from,
          "🦷 *Outro serviço*\n\nPor favor, escreva qual procedimento odontológico você deseja realizar 😊"
        );

        return res.status(200).send("ask_custom_procedure");
      }

      state.temp.procedimento = escolhido;
      state.step = "odontologia_confirmar_agendamento";
      await setUserState(from, state);

      

      await sendButtons(from, `Você escolheu *${escolhido}*.\nDeseja fazer um agendamento?`, [
        { id: "sim_agendar", title: "Sim" },
        { id: "nao_agendar", title: "Não" },
      ]);

      return res.status(200).send("odontologia_choice_sent");
    }
   
  if (state.step === "odontologia_confirmar_agendamento") {
  if (lower === "sim_agendar" || lower === "sim") {
    state.step = "wait_period";
    await setUserState(from, state);

    await sendButtons(from, "Qual período você prefere?", [
      { id: "manha", title: "Manhã" },
      { id: "tarde", title: "Tarde" },
      { id: "qualquer", title: "Qualquer horário" },
    ]);

    return res.status(200).send("ask_period");
  }
}
// ---------- OUTRO SERVIÇO ODONTOLOGIA ----------
if (state.step === "odontologia_outro_servico") {
  if (!text || text.length < 3) {
    await sendMessage(
      from,
      "❌ Não consegui identificar o procedimento. Pode escrever com um pouco mais de detalhe?"
    );
    return res.status(200).send("invalid_custom_procedure");
  }

  state.temp.procedimento = text;
  state.step = "odontologia_confirmar_agendamento";
  await setUserState(from, state);

  await sendButtons(
    from,
    `Você informou o procedimento:*${text}*\n\nDeseja fazer um agendamento?`,
    [
      { id: "sim_agendar", title: "Sim" },
      { id: "nao_agendar", title: "Não" },
    ]
  );

  return res.status(200).send("custom_procedure_confirm");
}

  if (state.step === "wait_period") {
  const period = ["manha", "tarde", "qualquer"].includes(lower)
  ? lower
  : "qualquer";


  const slots = await getAvailableSlots({
    period,
    durationMinutes: 60,
  });


   if (!slots || !slots.length) {
    await sendButtons(from, "😕 Não encontrei horários nesse período. Deseja tentar outro?", [
      { id: "manha", title: "Manhã" },
      { id: "tarde", title: "Tarde" },
      { id: "qualquer", title: "Qualquer horário" },
    ]);
    return res.status(200).send("no_slots_retry");
  }

  state.temp.slots = slots;

  let msg = "Tenho esses horários disponíveis 😊\n\n";
  slots.slice(0, 4).forEach((slot, i) => {
    msg += `${i + 1}️⃣ ${slot.label}\n`;
  });

  msg += "\nDigite o número da opção.";
  await sendMessage(from, msg);

  state.step = "choose_slot";
  await setUserState(from, state);
  return res.status(200).send("show_slots");
}

if (state.step === "choose_slot") {
  const index = Number(numeric) - 1;
  const slot = state.temp.slots?.[index];

  if (!slot) {
    await sendMessage(from, "❌ Opção inválida. Escolha um número da lista.");
    return res.status(200).send("invalid_slot");
  }

  state.temp.selectedSlot = slot;

  await sendButtons(
    from,
    `Confirma este horário?\n\n📅 ${slot.label}`,
    [
      { id: "confirmar", title: "Confirmar" },
      { id: "escolher_outro", title: "Escolher outro" },
    ]
  );

  state.step = "confirm_slot";
  await setUserState(from, state);
  return res.status(200).send("confirm_slot");
}

if (state.step === "confirm_slot") {

  if (lower === "confirmar") {
    state.step = "ask_name";
    await setUserState(from, state);
    await sendMessage(from, "Perfeito! Agora me diga seu *Nome Completo* 😊");
    return res.status(200).send("ask_name");
  }

  if (lower === "escolher_outro") {
    state.step = "wait_period";
    delete state.temp.selectedSlot;
    await setUserState(from, state);

    await sendButtons(from, "Qual período você prefere?", [
      { id: "manha", title: "Manhã" },
      { id: "tarde", title: "Tarde" },
      { id: "qualquer", title: "Qualquer horário" },
    ]);

    return res.status(200).send("back_to_period");
  }
}
 
    if (state.step === "ask_name") {
  const nome = text;

  if (!nome || nome.length < 2) {
    await sendMessage(from, "Por favor envie seu nome completo.");
    return res.status(200).send("invalid_name");
  }

  state.temp.name = nome;

  let event;
  try {
    event = await createEvent({
      summary: `Consulta - ${nome}`,
      description: `Agendamento via WhatsApp — ${nome} (${from}) - Procedimento: ${state.temp.procedimento}`,
      startISO: state.temp.selectedSlot.iso,
      durationMinutes: 60,
    });
  } catch (err) {
    console.error("❌ Erro ao criar evento:", err);
    await sendMessage(from, "❌ Erro ao agendar. Tente novamente mais tarde.");
    await setUserState(from, { step: "menu", temp: {} });
    return res.status(200).send("event_error");
  }

  const startLocal = new Date(state.temp.selectedSlot.iso).toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
  });

  // ✅ NOTIFICA ADMIN
  try {
    await notifyAdminNewAppointment({
      paciente: nome,
      telefone: from,
      data: startLocal,
    });
  } catch (err) {
    console.error("⚠️ Erro ao notificar admin:", err);
  }

  // ✅ SALVA NA PLANILHA
  try {
    await appendRow([
      new Date().toLocaleString(),
      from,
      nome,
      state.temp.procedimento,
      state.temp.selectedSlot.iso,
      event.htmlLink || "",
    ]);
  } catch (err) {
    console.error("Erro ao salvar na planilha:", err);
  }

  // ✅ CONFIRMA PARA O USUÁRIO
  await sendMessage(
    from,
    `✅ *Agendamento confirmado!*\n\n👤 ${nome}\n📅 ${startLocal}\nProcedimento: ${state.temp.procedimento}\n⏱️ Duração: 1h`
  );

  state.step = "perguntar_algo_mais";
  await setUserState(from, state);

  await sendButtons(from, "Quer minha ajuda com mais alguma coisa?", [
    { id: "help_sim", title: "Sim" },
    { id: "help_nao", title: "Não" },
  ]);

  return res.status(200).send("agendamento_confirmado");
}

    // ---------- PERGUNTAR SE QUER MAIS ALGO ----------
      if (state.step === "perguntar_algo_mais") {
      if (lower === "help_sim" || lower === "sim") {
        state.step = "menu";
        state.temp = {};
        await setUserState(from, state);
        await sendMessage(from, "Perfeito! Digite *menu* para ver as opções novamente.");
        return res.status(200).send("back_to_menu");
      }

      if (lower === "help_nao" || lower === "não" || lower === "nao") {
        await sendMessage(from, "Foi um prazer ajudar! 😊 Até logo.");
        state.step = "menu";
        state.temp = {};
        await setUserState(from, state);
        return res.status(200).send("end_convo");
      }

      await sendMessage(from, "Use os botões *Sim* ou *Não* ou escreva 'sim' / 'não'.");
      return res.status(200).send("invalid_help_choice");
    }

    // ----------------- FLUXO HARMONIZAÇÃO -----------------
    else if (state.step === "harmonizacao_procedimento") {
      const procedimentos = {
        "1": "Preenchimento Labial",
        "2": "Toxina Botulínica (Botox)",
        "3": "Preenchimento Mentual",
        "4": "Rinomodelação",
        "5": "Preenchimento Bigode Chinês",
        "6": "Preenchimento Mandibular",
        "7": "Bioestimulador de Colágeno",
        "8": "Outros procedimentos",
      };

      let escolhido = procedimentos[numeric];

      if (!escolhido) {
        const input = lower;
        for (const key in procedimentos) {
          if (procedimentos[key].toLowerCase().includes(input)) {
            escolhido = procedimentos[key];
            break;
          }
        }
      }

      if (!escolhido) {
        await sendMessage(from, "Não consegui identificar o procedimento. Digite o número (1-8) ou escreva o nome.");
        return res.status(200).send("invalid_proc");
      }

      const numeroPessoal = "5585992883317";
      const mensagem = encodeURIComponent(`Olá! Tenho interesse em: ${escolhido}`);
      const link = `https://wa.me/${numeroPessoal}?text=${mensagem}`;

      await sendMessage(
        from,
        `✨ *Perfeito!* Procedimento selecionado:\n\n*${escolhido}*\n\n` +
          `👉 Clique no link para atendimento direto:\n${link}`
      );

      state.step = "perguntar_algo_mais";
      await setUserState(from, state);

      await sendButtons(from, "Posso te ajudar com mais alguma coisa?", [
        { id: "help_sim", title: "Sim" },
        { id: "help_nao", title: "Não" },
      ]);

      return res.status(200).send("harmonizacao_direcionado");
    }
  } catch (err) {
    console.error("🔥 ERRO GERAL NO HANDLER:", err);
    return res.status(200).send("internal_error");
  }
}
