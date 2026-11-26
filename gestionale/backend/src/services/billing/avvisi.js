/**
 * Avvisi all'autoscuola sullo stato dei pagamenti delle commissioni:
 * email (provider già configurato in notificheService) e WhatsApp opzionale.
 *
 * WhatsApp: se WHATSAPP_SEND_URL è impostato, viene fatta una POST JSON
 * { number, text } con header "apikey: WHATSAPP_API_KEY". È compatibile con un
 * piccolo endpoint davanti a Baileys / Evolution API / WAHA.
 */

const axios = require("axios");

function euro(n) {
  return Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function testoAvviso(tipo, { nome, totale, link, giorni }) {
  switch (tipo) {
    case "pagamento_fallito":
      return {
        oggetto: "Pagamento commissioni PagoPA non riuscito",
        testo: `Ciao ${nome}, l'addebito settimanale delle commissioni PagoPA (${euro(totale)}) non è andato a buon fine. ` +
          `Riproveremo nei prossimi giorni in automatico. Puoi anche pagare subito o cambiare carta qui: ${link}. ` +
          `Se il pagamento non arriva entro ${giorni} giorni, la creazione di nuovi PagoPA verrà sospesa.`,
      };
    case "bloccata":
      return {
        oggetto: "Nuovi PagoPA sospesi per pagamento non ricevuto",
        testo: `Ciao ${nome}, non abbiamo ricevuto il pagamento delle commissioni PagoPA (${euro(totale)}). ` +
          `La creazione di nuovi PagoPA è sospesa, ma puoi consultare tutti i tuoi dati. ` +
          `Paga qui per riattivare subito: ${link}`,
      };
    case "riattivata":
      return {
        oggetto: "Pagamento ricevuto, servizio riattivato",
        testo: `Ciao ${nome}, abbiamo ricevuto il pagamento di ${euro(totale)}. Grazie, il servizio PagoPA è di nuovo attivo.`,
      };
    default:
      return { oggetto: "Avviso commissioni PagoPA", testo: `Ciao ${nome}, controlla la sezione Fatturazione.` };
  }
}

function normalizzaNumero(tel) {
  let n = String(tel || "").replace(/[^\d+]/g, "");
  if (!n) return "";
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("3") && n.length >= 9 && n.length <= 10) n = `39${n}`;
  return n;
}

async function inviaAvviso(tipo, autoscuola, dati = {}, { env = process.env, http = axios, sendEmail } = {}) {
  const { oggetto, testo } = testoAvviso(tipo, { nome: autoscuola?.nome || "", ...dati });
  const esiti = { email: false, whatsapp: false };

  try {
    const send = sendEmail || require("../notificheService").sendEmail;
    if (typeof send === "function" && autoscuola?.email) {
      await send({ to: autoscuola.email, subject: oggetto, text: testo, html: `<p>${testo}</p>` });
      esiti.email = true;
    }
  } catch (e) {
    console.warn("[Billing] Email avviso non inviata:", e.message);
  }

  const url = String(env.WHATSAPP_SEND_URL || "").trim();
  const numero = normalizzaNumero(autoscuola?.telefono);
  if (url && numero) {
    try {
      await http.post(url, { number: numero, text: testo }, {
        headers: { "Content-Type": "application/json", apikey: String(env.WHATSAPP_API_KEY || "") },
        timeout: 15000,
      });
      esiti.whatsapp = true;
    } catch (e) {
      console.warn("[Billing] WhatsApp avviso non inviato:", e.message);
    }
  }
  return esiti;
}

module.exports = { inviaAvviso, testoAvviso, normalizzaNumero };
