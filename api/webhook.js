import axios from "axios";
import { getUserState, setUserState, isDuplicateMessage } from "../utils/state.js";
import { isTimeSlotFree, createEvent } from "../utils/googleCalendar.js";
import { appendRow } from "../utils/googleSheets.js";
import { notifyAdminNewAppointment } from "../utils/whatsapp.js";


const ADMIN_PHONE = "5585992883317"; // seu WhatsApp pessoal


// ---------------------- PARSE DE DATA ----------------------
function parseDateTime(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:às\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  const [, d, mo, y, hh, mm] = m;
  return new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:00-03:00`).toISOString();
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

    const msgId = entry.id;
    const from = entry.from;
    const incomingText =
      (entry.text && entry.text.body) ||
      (entry.button && entry.button.payload) ||
      entry.interactive?.button_reply?.id ||
      "";
    const text = String(incomingText || "").trim();
    const lower = text.toLowerCase();
    const numeric = lower.replace(/[^0-9]/g, "");

    if (!msgId || !from) return res.status(200).send("no_id");

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

    if (state.step === "aguardando_confirmacao") {

      if (lower === "confirmar_consulta") {
        await sendMessage(from, "✅ Consulta confirmada! Te aguardamos 💚");

        await setUserState(from, { step: "menu", temp: {} });
        return res.status(200).send("confirmed");
      }

      if (lower === "desmarcar_consulta") {
        await sendMessage(from, "❌ Consulta desmarcada. Obrigada por avisar.");

        // AVISA VOCÊ
        await sendMessage(
          process.env.ADMIN_PHONE,
          `⚠️ *Consulta desmarcada*\nPaciente: ${from}`
        );

        await setUserState(from, { step: "menu", temp: {} });
        return res.status(200).send("cancelled");
      }
    }


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
        `Olá! Seja bem vinda (o) 😊\n\nSou a assistente da Dra. Gabriela e estou aqui para te ajudar nesse início! Por favor, escolha uma das opções abaixo:\n\n` +
          `1️⃣ Serviços odontológicos\n` +
          `2️⃣ Harmonização facial\n` +
          `3️⃣ Endereço\n` +
          `4️⃣ Falar com a Dra. Gabriela\n\n` +
          `Digite apenas o número da opção ou digite sair para encerrar o atendimento.`
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
          `💬 Basta enviar o nome do procedimento que deseja saber mais.`
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
        const numero = "5585994160815";
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
        "1": "Restauração em Resina",
        "2": "Limpeza Dental",
        "3": "Extração de Siso",
        "4": "Clareamento Dental",
        "5": "Outro serviço",
      };

      const escolhido = procedimentosOdonto[numeric] || procedimentosOdonto[text];
      if (!escolhido) {
        await sendMessage(from, "❌ Opção inválida. Digite o número do procedimento ou *menu* para voltar.");
        return res.status(200).send("invalid_odontologia_option");
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

    // confirmação agendamento (odontologia)
    if (state.step === "odontologia_confirmar_agendamento") {
      if (lower === "sim_agendar" || lower === "sim") {
        state.step = "ask_datetime";
        await setUserState(from, state);
        await sendMessage(from, `Perfeito! Vamos agendar *${state.temp.procedimento}*.\n HORÁRIO DE AGENDAMENTO: seg a sex: 09h as 18h. Sáb: 08h as 12h.\nEnvie a data e horário desejados.\nExemplo: 15/12/2025 14:00`);
        return res.status(200).send("start_ask_datetime");
      }

      if (lower === "nao_agendar" || lower === "não" || lower === "nao") {
        state.step = "odontologia_menu";
        await setUserState(from, state);
        await sendMessage(from, `Tudo bem! Digite o número do procedimento novamente ou *menu* para voltar.`);
        return res.status(200).send("back_to_odontologia_menu");
      }

      await sendMessage(from, "Por favor use os botões *Sim* ou *Não* ou escreva 'sim' / 'não'.");
      return res.status(200).send("invalid_confirm_input");
    }

    // ---------- PEDIR DATA/HORA ----------
    if (state.step === "ask_datetime") {
      const iso = parseDateTime(text);
      if (!iso) {
        await sendMessage(from, "Formato inválido. Envie no formato: DD/MM/AAAA HH:MM (ex: 15/12/2025 14:00)");
        return res.status(200).send("invalid_date_format");
      }

      const dataLocal = new Date(iso);
      // ---------------------- LIMITE DE HORÁRIO ----------------------

      // extrai hora/minuto usando timezone de Fortaleza
      const hora = dataLocal.toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      const [h, m] = hora.split(":").map(Number);

      // bloqueia antes das 08:00 e após 18:00
      if (h < 9 || h > 18 || (h === 18 && m > 0)) {
        await sendMessage(
          from,
          "⚠️ *Horário indisponível.*\n\nAtendemos somente entre *09:00 às 18:00*.\nEnvie outro horário."
        );
        return res.status(200).send("invalid_time");
      }

      const diaSemana = dataLocal.getDay(); // 0=Dom,1=Seg,...

      if (diaSemana === 2 || diaSemana === 5) {
        await sendMessage(from, "❌ Não realizo atendimentos às *terças* e *sextas-feiras*.\nPor favor, envie outra data. 😊");
        return res.status(200).send("day_blocked");
      }

      const startISO = iso;
      const endISO = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();
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

      let event;
      try {
        event = await createEvent({
          summary: `Consulta - ${nome}`,
          description: `Agendamento via WhatsApp — ${nome} (${from}) - Procedimento: ${state.temp.procedimento}`,
          startISO: state.temp.startISO,
          durationMinutes: 60,
        });
        const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", {
          timeZone: "America/Fortaleza"
        });

        await notifyAdminNewAppointment({
          paciente: nome,
          telefone: from,
          data: startLocal
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

      const startLocal = new Date(state.temp.startISO).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
      await sendMessage(from, `✅ *Agendamento confirmado!*\n\n👤 ${nome}\n📅 ${startLocal}\nProcedimento: ${state.temp.procedimento}\n⏱️ Duração: 1h\n\nSe precisar remarcar, entre em contato.`);

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

    // fallback padrão
    await sendMessage(from, "Não entendi. Digite *menu* para ver as opções.");
    return res.status(200).send("default");
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.status(500).send("internal_error");
  }
}


