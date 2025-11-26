import axios from "axios";
import { getUserState, setUserState, isDuplicateMessage } from "../utils/state.js";
import { isTimeSlotFree, createEvent } from "../utils/googleCalendar.js";
import { appendRow } from "../utils/googleSheets.js";

// ---------------------- PARSE DE DATA ----------------------
// Recebe "DD/MM/YYYY HH:MM" ou "DD/MM/YYYY HH:MM" com 'às' opcional.
// Retorna ISO string (UTC-03:00) compatível com seu calendário.
function parseDateTime(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:às\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  const [, d, mo, y, hh, mm] = m;
  // Cria Date no timezone local do servidor e converte para ISO (mantendo offset -03:00 no texto original)
  // Para consistência com seu createEvent, retornamos ISO UTC string.
  const iso = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:00-03:00`).toISOString();
  return iso;
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
  // buttons: [{ id: 'sim_agendar', title: 'Sim' }, ...]
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
  // Verificação webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Se usa outro env var, ajuste acima
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

    const msgId = entry.id;
    const from = entry.from;
    // Detecta texto normal, botão ou interactive reply id
    const incomingText =
      (entry.text && entry.text.body) ||
      (entry.button && entry.button.payload) ||
      entry.interactive?.button_reply?.id ||
      "";
    const text = String(incomingText).trim();
    const lower = text.toLowerCase();
    // Normaliza números (remove emojis, espaços e caracteres invisíveis)
    const numeric = lower.replace(/[^0-9]/g, "");

    if (!msgId || !from) return res.status(200).send("no_id");

    // Prevenção de duplicatas
    if (await isDuplicateMessage(msgId)) {
      console.log("Mensagem duplicada ignorada:", msgId);
      return res.status(200).send("duplicate");
    }

    // Carrega estado atual ou inicializa
    let state = (await getUserState(from)) || { step: "menu", temp: {} };
    if (!state.step) state.step = "menu";
    if (!state.temp) state.temp = {};

        // -------- COMANDO DE SAÍDA / ENCERRAR ATENDIMENTO ----------
    if (["sair", "encerrar", "finalizar", "cancelar", "0"].includes(lower)) {
      await sendMessage(
        from,
        "😊 Atendimento encerrado.\n\nSe precisar de algo, é só digitar *menu*."
      );
    
      await setUserState(from, { step: "menu", temp: {} });
      return res.status(200).send("session_ended");
    }


    // ---------- MENU PRINCIPAL ----------
    // Mostrar menu quando o estado é menu e usuário pede 'menu' ou cumprimentos
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
    `Olá! Seja bem vinda (o) 😊\n\nSou a assistente da Dra. Gabriela e estou aqui para te ajudar nesse inicio!Por favor, escolha uma das opções abaixo pra te direcionarmos melhor:\n` +                    
      `1️⃣ Serviços odontológicos\n` +
      `2️⃣ Harmonização facial\n` +
      `3️⃣ Endereço\n` +
      `4️⃣ Falar com a Dra. Gabriela\n\n` +
      `Digite apenas o número da opção ou digite "sair" para encerrar o atendimento`
  );

  return res.status(200).send("menu_sent");
}


// Usuário escolheu uma das opções do menu
if (state.step === "menu") {

  if (lower === "1") {
    state.step = "odontologia_menu";
    await setUserState(from, state);

    await sendMessage(
      from,
      `🦷 *Serviços Odontológicos*\n\n` +
        `1️⃣ Restauração em Resina\n` +
        `2️⃣ Limpeza Dental\n` +
        `3️⃣ Extração de Siso\n` +
        `4️⃣ Clareamento Dental\n` +
        `5️⃣ Outro serviço\n\n` +
        `Digite o número da opção ou *menu* para voltar.`
    );
    return res.status(200).send("odontologia_menu");
  }

if (lower === "2") {
  state.step = "harmonizacao_procedimento";
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
      `8️⃣ *Outros procedimentos*\n\n` +
      `Digite o número da opção.`
  );

  return res.status(200).send("harmonizacao_list");
}
// ----------------- HARMONIZAÇÃO — DIRECIONAR PARA WHATSAPP -----------------
if (state.step === "harmonizacao_procedimento") {

  // Se usuário digitou um número válido
  if (["1","2","3","4","5","6","7","8"].includes(numeric)) {

    const numero = "5585992883317"; // WhatsApp da Dra.
    const mensagem = encodeURIComponent("Olá! Gostaria de mais informações sobre o procedimento.");
    const link = `https://wa.me/${numero}?text=${mensagem}`;

    // Pergunta se deseja encerrar
    await sendButtons(from, "Deseja encerrar o atendimento?", [
      { id: "end_sim", title: "Encerrar" },
      { id: "end_nao", title: "Voltar ao Menu" },
    ]);

    state.step = "encerrar_fluxo";
    await setUserState(from, state);
    return res.status(200).send("sent_redirect_and_end_buttons");
  }

  await sendMessage(from, "Por favor, escolha um número de 1 a 8.");
  return res.status(200).send("invalid_option");
}
// ----------- TRATAR ENCERRAMENTO ------------
if (state.step === "encerrar_fluxo") {

  if (lower === "end_sim") {
    await sendMessage(from, "😊 Atendimento encerrado. Sempre que precisar é só chamar!");
    await setUserState(from, { step: "menu", temp: {} });
    return res.status(200).send("ended");
  }

  if (lower === "end_nao") {
    state.step = "menu";
    await setUserState(from, state);
    await sendMessage(from, "Retornando ao menu... digite *menu*.");
    return res.status(200).send("back_to_menu");
  }

  return res.status(200).send("invalid_end_choice");
}

  if (lower === "3") {
    await sendMessage(from, "📍 Nosso endereço é: Av. Washington Soares, 3663 - Sala 910 - Torre 01 - Fortaleza - CE.");
    await perguntarAlgoMais(from);
    state.step = "perguntar_algo_mais";
    await setUserState(from, state);
    return res.status(200).send("ask_more");

  }

  if (lower === "4") {
  const numero = "5585994160815"; // coloque aqui o número correto da Dra.
  const mensagem = encodeURIComponent("Olá! Gostaria de falar com você.");
  const link = `https://wa.me/${numero}?text=${mensagem}`;

  await sendMessage(
    from,
    `📞 Claro! Vou te encaminhar para a Dra. Gabriela. Aguarde Contato!\n\n` +
    `👉 Clique no link abaixo para falar diretamente com ela no WhatsApp:\n${link}`
  );

  await perguntarAlgoMais(from);
  state.step = "perguntar_algo_mais";
  await setUserState(from, state);
  return res.status(200).send("ask_more");

}

  // Se usuário digitou algo diferente de 1, 2, 3 ou 4
  await sendMessage(from, "Opção inválida. Digite *menu* para ver as opções.");
  return res.status(200).send("menu_invalid");
}


    // ---------- SUBMENU ODONTOLOGIA ----------
    if (state.step === "odontologia_menu") {
      // permitir 'menu' para voltar
      if (lower === "menu") {
        state.step = "menu";
        await setUserState(from, state);
        await sendMessage(from, "Voltando ao menu principal. Digite *menu* para exibir as opções.");
        return res.status(200).send("back_to_menu");
      }

      const procedimentos = {
        "1": "Restauração em Resina",
        "2": "Limpeza Dental",
        "3": "Extração de Siso",
        "4": "Clareamento Dental",
        "5": "Outro serviço",
      };

      const escolhido = procedimentos[lower];
      if (!escolhido) {
        await sendMessage(from, "❌ Opção inválida. Digite o número do procedimento ou *menu* para voltar.");
        return res.status(200).send("invalid_odontologia_option");
      }

      state.temp.procedimento = escolhido;
      state.step = "odontologia_confirmar_agendamento";
      await setUserState(from, state);

      // Envia botões Sim / Não
      await sendButtons(from, `Você escolheu *${escolhido}*.\nDeseja fazer um agendamento?`, [
        { id: "sim_agendar", title: "Sim" },
        { id: "nao_agendar", title: "Não" },
      ]);

      return res.status(200).send("odontologia_choice_sent");
    }

    // ---------- CONFIRMAÇÃO AGENDAMENTO (após escolher procedimento) ----------
    if (state.step === "odontologia_confirmar_agendamento") {
      // Aqui o incoming text poderá ser 'sim_agendar' ou 'nao_agendar' vindo do button_reply id,
      // ou o usuário pode escrever 'sim'/'não' em texto. Aceitamos ambos.
      if (lower === "sim_agendar" || lower === "sim") {
        state.step = "ask_datetime";
        await setUserState(from, state);
        await sendMessage(from, `Perfeito! Vamos agendar *${state.temp.procedimento}*.\nEnvie a data e horário desejados.\nExemplo: 15/12/2025 14:00`);
        return res.status(200).send("start_ask_datetime");
      }

      if (lower === "nao_agendar" || lower === "não" || lower === "nao_agendar") {
        // Volta somente ao submenu odontologia (não ao menu principal)
        state.step = "odontologia_menu";
        await setUserState(from, state);
        await sendMessage(from, 
        `Tudo bem! Aqui estão novamente as opções odontológicas:
        1️⃣ Restauração em Resina
        2️⃣ Limpeza Dental
        3️⃣ Extração de Siso
        4️⃣ Clareamento Dental
        5️⃣ Outro serviço
        Digite o número do procedimento ou *menu* para voltar ao principal.`);
        return res.status(200).send("back_to_odontologia_menu");
      }

      // não entendeu
      await sendMessage(from, "Por favor use os botões *Sim* ou *Não* ou escreva 'sim' / 'não'.");
      return res.status(200).send("invalid_confirm_input");
    }

    // ---------- PEDIR DATA/HORA ----------
    if (state.step === "ask_datetime") {
  // Exemplo do usuário: "15/12/2025 14:00"
    const iso = parseDateTime(text);
    if (!iso) {
      await sendMessage(from, "Formato inválido. Envie no formato: DD/MM/AAAA HH:MM (ex: 15/12/2025 14:00)");
      return res.status(200).send("invalid_date_format");
    }
  
    // ⚠️ BLOQUEIO DE TERÇAS (2) E SEXTAS (5)
    const dataLocal = new Date(iso);
    const diaSemana = dataLocal.getDay(); // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
  
    if (diaSemana === 2 || diaSemana === 5) {
      await sendMessage(
        from,
        "❌ Não realizo atendimentos às *terças* e *sextas-feiras*.\nPor favor, envie outra data. 😊"
      );
      return res.status(200).send("day_blocked");
    }
  
    const startISO = iso;
    const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString(); // 1 hora
    let free;
  
    try {
      free = await isTimeSlotFree(startISO, endISO);
    } catch (err) {
      console.error("Erro ao verificar disponibilidade:", err);
      await sendMessage(from, "⚠️ Não consegui verificar o horário. Tente novamente mais tarde.");
      return res.status(200).send("calendar_check_error");
    }
  
    if (!free) {
      await sendMessage(from, "❌ Esse horário está ocupado. Envie outro horário.");
      return res.status(200).send("busy");
    }
  
    state.temp.startISO = startISO;
    state.temp.endISO = endISO;
    state.step = "ask_name";
    await setUserState(from, state);
  
    await sendMessage(from, "Ótimo! Agora envie seu *nome completo* para confirmar o agendamento.");
    return res.status(200).send("ask_name_sent");
  }


    // ---------- RECEBER NOME E CRIAR EVENTO ----------
    if (state.step === "ask_name") {
      const nome = text;
      if (!nome || nome.length < 2) {
        await sendMessage(from, "Por favor envie seu nome completo.");
        return res.status(200).send("invalid_name");
      }

      state.temp.name = nome;

      // criar evento
      let event;
      try {
        event = await createEvent({
          summary: `Consulta - ${nome}`,
          description: `Agendamento via WhatsApp — ${nome} (${from}) - Procedimento: ${state.temp.procedimento}`,
          startISO: state.temp.startISO,
          durationMinutes: 60,
        });
      } catch (err) {
        console.error("Erro ao criar evento:", err);
        event = null;
      }

      if (!event) {
        await sendMessage(from, "❌ Erro ao agendar. Tente novamente mais tarde.");
        state.step = "menu";
        state.temp = {};
        await setUserState(from, state);
        return res.status(200).send("event_error");
      }

      // salva na planilha (evita travar por causa de erro)
      try {
        await appendRow([
          new Date().toLocaleString(),
          from,
          nome,
          state.temp.procedimento,
          state.temp.startISO,
          event.htmlLink || "",
        ]);
      } catch (err) {
        console.error("Erro ao salvar na planilha:", err);
      }

      // confirma ao usuário
      const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
      await sendMessage(from, `✅ *Agendamento confirmado!*\n\n👤 ${nome}\n📅 ${startLocal}\nProcedimento: ${state.temp.procedimento}\n⏱️ Duração: 1h\n\nSe precisar remarcar, entre em contato.`);

      // Pergunta se deseja mais alguma coisa com botões
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

    // ---------- HARMONIZAÇÃO (redirecionamento como antes) ----------
    if (state.step === "harmonizacao_procedimento") {
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

      let escolhido = procedimentos[text];
      if (!escolhido) {
        // detectar por nome (parcial)
        const texto = text.toLowerCase();
        for (const key in procedimentos) {
          if (procedimentos[key].toLowerCase().includes(texto)) {
            escolhido = procedimentos[key];
            break;
          }
        }
      }

      if (!escolhido) {
        await sendMessage(from, "Não consegui identificar o procedimento. Digite o número ou nome do procedimento.");
        return res.status(200).send("invalid_proc");
      }

      // encaminhar para número pessoal (mantive sua lógica)
      const numeroPessoal = "5585994160815"; // altere se necessário
      const link = `https://wa.me/${85994160815}?text=Olá!%20Tenho%20interesse%20em:%20${encodeURIComponent(escolhido)}`;

      await sendMessage(from, `✨ Perfeito! Vou te encaminhar para atendimento direto.\n\nClique no link abaixo para continuar:\n\n${link}`);
      // volta ao menu principal
      await setUserState(from, { step: "menu", temp: {} });
      return res.status(200).send("redirect_done");
    }

    // ---------- DEFAULT ----------
    await sendMessage(from, "Não entendi. Digite *menu* para ver as opções.");
    return res.status(200).send("default");
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).send("internal_error");
  }
}
