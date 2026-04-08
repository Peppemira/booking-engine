/**
 * NotificheService — Punto 21
 * Notifiche automatiche candidati: email via API REST (Brevo/SendGrid/generic)
 * con fallback a log console se non configurato.
 * Storico notifiche su tabella Supabase `notifiche_candidati`.
 */

const axios = require("axios");
const supabase = require("../database/supabase");

const TABLE = "notifiche_candidati";

// ---------------------------------------------------------------------------
// Provider email: rilevato da env vars
// ---------------------------------------------------------------------------
function getEmailProvider() {
  if (process.env.BREVO_API_KEY)   return "brevo";
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) return "mailgun";
  return "console";
}

async function sendEmail({ to, subject, html, text, from }) {
  const provider = getEmailProvider();
  const fromAddr = from || process.env.EMAIL_FROM || "noreply@autoscuola.it";

  if (provider === "brevo") {
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { email: fromAddr, name: process.env.EMAIL_FROM_NAME || "Autoscuola" },
        to: [{ email: to }],
        subject,
        htmlContent: html || text,
        textContent: text || "",
      },
      { headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" } }
    );
    return { sent: true, provider: "brevo" };
  }

  if (provider === "sendgrid") {
    await axios.post(
      "https://api.sendgrid.com/v3/mail/send",
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromAddr },
        subject,
        content: [
          { type: "text/html", value: html || text },
          { type: "text/plain", value: text || "" },
        ],
      },
      { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" } }
    );
    return { sent: true, provider: "sendgrid" };
  }

  if (provider === "mailgun") {
    const FormData = require("form-data");
    const fd = new FormData();
    fd.append("from", fromAddr);
    fd.append("to", to);
    fd.append("subject", subject);
    fd.append("html", html || text);
    await axios.post(
      `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
      fd,
      {
        auth: { username: "api", password: process.env.MAILGUN_API_KEY },
        headers: fd.getHeaders(),
      }
    );
    return { sent: true, provider: "mailgun" };
  }

  // Fallback: log a console (utile in sviluppo/staging)
  console.log(`[NOTIFICHE stub] To:${to} | Subject: ${subject}\n${text || html || ""}`);
  return { sent: true, provider: "console", stub: true };
}

// ---------------------------------------------------------------------------
// Template predefiniti
// ---------------------------------------------------------------------------
const TEMPLATES = {
  esame_prenotato: {
    label: "Esame prenotato",
    subject: "Prenotazione esame confermata",
    html: (v) => `<p>Gentile <strong>${v.nome} ${v.cognome}</strong>,<br>
      la tua prenotazione per l'esame di <strong>${v.tipo_esame || "patente"}</strong>
      è confermata per il giorno <strong>${v.data_esame || "—"}</strong>
      presso <strong>${v.sede || "sede da confermare"}</strong>.<br><br>
      Per info: ${v.telefono_scuola || ""}</p>`,
    text: (v) =>
      `Gentile ${v.nome} ${v.cognome}, la tua prenotazione è confermata per il ${v.data_esame || "—"}.`,
  },
  esito_esame: {
    label: "Esito esame",
    subject: "Risultato esame patente",
    html: (v) => `<p>Gentile <strong>${v.nome} ${v.cognome}</strong>,<br>
      l'esito del tuo esame del ${v.data_esame || "—"} è: <strong>${v.esito || "—"}</strong>.<br>
      ${v.esito === "idoneo" ? "🎉 Congratulazioni!" : "Potrai ripresentarti presso la nostra sede."}<br><br>
      Per info: ${v.telefono_scuola || ""}</p>`,
    text: (v) =>
      `Gentile ${v.nome} ${v.cognome}, esito esame ${v.data_esame || ""}: ${v.esito || "—"}.`,
  },
  scadenza_documento: {
    label: "Scadenza documento",
    subject: "Promemoria scadenza documento",
    html: (v) => `<p>Gentile <strong>${v.nome} ${v.cognome}</strong>,<br>
      il tuo <strong>${v.tipo_documento || "documento"}</strong> scade il <strong>${v.data_scadenza || "—"}</strong>.<br>
      Ti invitiamo a rinnovarlo per tempo.<br><br>
      Per info: ${v.telefono_scuola || ""}</p>`,
    text: (v) =>
      `Gentile ${v.nome} ${v.cognome}, il tuo ${v.tipo_documento || "documento"} scade il ${v.data_scadenza || "—"}.`,
  },
  pagamento_ricevuto: {
    label: "Pagamento ricevuto",
    subject: "Conferma pagamento",
    html: (v) => `<p>Gentile <strong>${v.nome} ${v.cognome}</strong>,<br>
      abbiamo ricevuto il pagamento di <strong>€ ${v.importo || "—"}</strong>
      del ${v.data_pagamento || "—"} (${v.causale || "—"}).<br>
      Grazie per la fiducia.<br><br>
      Per info: ${v.telefono_scuola || ""}</p>`,
    text: (v) =>
      `Gentile ${v.nome} ${v.cognome}, pagamento di €${v.importo || "—"} ricevuto.`,
  },
  messaggio_libero: {
    label: "Messaggio libero",
    subject: "Comunicazione dalla tua autoscuola",
    html: (v) => `<p>Gentile <strong>${v.nome} ${v.cognome}</strong>,<br><br>
      ${(v.testo || "").replace(/\n/g, "<br>")}<br><br>
      Per info: ${v.telefono_scuola || ""}</p>`,
    text: (v) => `Gentile ${v.nome} ${v.cognome},\n\n${v.testo || ""}`,
  },
};

// ---------------------------------------------------------------------------
// NotificheService
// ---------------------------------------------------------------------------
class NotificheService {
  /**
   * Invia notifica a un candidato e salva storico.
   * @param {object} opts
   * @param {string} opts.candidato_id
   * @param {string} opts.email_destinatario
   * @param {string} opts.template_key — chiave di TEMPLATES
   * @param {object} opts.vars — variabili per il template
   * @param {string} [opts.autoscuola_id]
   * @param {string} [opts.note]
   */
  async invia({ candidato_id, email_destinatario, template_key, vars = {}, autoscuola_id, note }) {
    const tmpl = TEMPLATES[template_key];
    if (!tmpl) throw new Error(`Template sconosciuto: ${template_key}`);
    if (!email_destinatario) throw new Error("Email destinatario mancante");

    const subject = tmpl.subject;
    const html    = tmpl.html(vars);
    const text    = tmpl.text(vars);

    let esito = "inviata";
    let errMsg = null;

    try {
      await sendEmail({ to: email_destinatario, subject, html, text });
    } catch (e) {
      esito = "errore";
      errMsg = e.message;
    }

    // Salva storico (non blocca se tabella non esiste)
    await supabase.from(TABLE).insert([{
      candidato_id: String(candidato_id),
      autoscuola_id: autoscuola_id || null,
      tipo: template_key,
      destinatario: email_destinatario,
      oggetto: subject,
      corpo_html: html,
      corpo_testo: text,
      esito,
      errore: errMsg,
      note: note || null,
    }]).catch(() => {}); // ignora se tabella non esiste

    if (esito === "errore") throw new Error(errMsg);
    return { success: true, esito, provider: getEmailProvider() };
  }

  /**
   * Invia notifica a più candidati.
   */
  async inviaBulk({ candidati, template_key, vars_base = {}, autoscuola_id }) {
    const results = [];
    for (const c of candidati) {
      try {
        const vars = { ...vars_base, nome: c.nome, cognome: c.cognome, ...c };
        const r = await this.invia({
          candidato_id: c.id,
          email_destinatario: c.email_contatto || c.email,
          template_key,
          vars,
          autoscuola_id,
        });
        results.push({ id: c.id, ...r });
      } catch (e) {
        results.push({ id: c.id, success: false, errore: e.message });
      }
    }
    return results;
  }

  /**
   * Storico notifiche per candidato.
   */
  async storicoPerCandidato(candidato_id, autoscuola_id) {
    let q = supabase
      .from(TABLE)
      .select("id,tipo,destinatario,oggetto,esito,errore,note,created_at")
      .eq("candidato_id", String(candidato_id))
      .order("created_at", { ascending: false })
      .limit(50);
    if (autoscuola_id) q = q.eq("autoscuola_id", autoscuola_id);
    const { data, error } = await q;
    return { data: data || [], error };
  }

  /**
   * Storico notifiche globale con paginazione.
   */
  async storicoGlobale(req) {
    const limit  = req?.query?.limit  ? Math.min(parseInt(req.query.limit,  10) || 50, 500) : 50;
    const offset = req?.query?.offset ? Math.max(parseInt(req.query.offset, 10) || 0,  0)   : 0;
    const autoscuola_id = req?.autoscuolaId || null;

    let q = supabase
      .from(TABLE)
      .select("id,candidato_id,tipo,destinatario,oggetto,esito,errore,note,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (autoscuola_id) q = q.eq("autoscuola_id", autoscuola_id);

    const { data, error, count } = await q;
    return { data: data || [], error, total: count ?? 0 };
  }

  /**
   * Lista templates disponibili.
   */
  getTemplates() {
    return Object.entries(TEMPLATES).map(([key, t]) => ({
      key,
      label: t.label,
      subject: t.subject,
    }));
  }
}

const notificheService = new NotificheService();

module.exports = {
  NotificheService,
  notificheService,
  TEMPLATES,
  TABLE_NOTIFICHE: TABLE,
};
