/**
 * Route REST per portale (punti patente, login, PIN, import, RichiestaPatenti).
 */

const router = require("express").Router();
const { portaleController } = require("../controllers");
const { requireAuth } = require("../server/auth");

// --- Originali ---
router.post("/punti-patente",               requireAuth, portaleController.puntiPatente);
router.post("/login",                                    portaleController.login);
router.post("/validate-pin",                             portaleController.validatePin);

// --- Sedute portale ---
router.post("/sessioni-preview",            requireAuth, portaleController.sessioniPreview);
router.post("/sessione-dettaglio",          requireAuth, portaleController.sessioneDettaglio);
router.get("/sessione-dettaglio-cache",     requireAuth, portaleController.sessioneDettaglioCache);
router.post("/prenotazione-candidato",      requireAuth, portaleController.prenotazioneCandidato);
// Prenotazione diretta via URL (bypass captcha con visualizzaCaptcha=false)
router.post("/prenotazione-diretta",        requireAuth, portaleController.prenotazioneDiretta);

// --- Import pagina /import (GeCA: creaarchivio / sistArchivi) ---
router.post("/search-results",              requireAuth, portaleController.searchResults);
router.post("/import-massivo",              requireAuth, portaleController.importMassivo);
router.post("/import-archivio",             requireAuth, portaleController.importArchivio);
router.post("/import-candidates",           requireAuth, portaleController.importCandidates);
router.post("/import-by-patente",           requireAuth, portaleController.importByPatente);
router.post("/import",                      requireAuth, portaleController.import);

// --- RichiestaPatenti (replica GeCA) ---
router.post("/cerca-candidato-patente",     requireAuth, portaleController.cercaCandidatoPatente);
router.post("/cerca-candidato-medico",      requireAuth, portaleController.cercaCandidatoMedico);
router.post("/cerca-per-marca",             requireAuth, portaleController.cercaPerMarca);
router.post("/cerca-richieste-esame",       requireAuth, portaleController.cercaRichiesteEsame);
router.post("/nuova-iscrizione-esame",      requireAuth, portaleController.nuovaIscrizioneEsame);
router.post("/foglio-rosa",                 requireAuth, portaleController.foglioRosa);
router.post("/rinnovo-patente",             requireAuth, portaleController.rinnovoPatente);
router.post("/cerca-cqc",                   requireAuth, portaleController.cercaCQC);
router.post("/cambio-codice-autoscuola",    requireAuth, portaleController.cambioCodiceAutoscuola);

// --- Verbali (aperti / svolti / CQC / revisione) ---
router.post("/verbali",                     requireAuth, portaleController.verbali);

// --- Verifica Pratica ---
router.post("/verifica-pratica",            requireAuth, portaleController.verificaPratica);

// --- Sessioni Approvate (Patente SQA + CQC SCQCA) ---
router.post("/sessioni-approvate",          requireAuth, portaleController.sessioniApprovate);

// --- Sessioni CQC ---
router.post("/sessioni-cqc",               requireAuth, portaleController.sessioniCqc);

// --- Stampa ufficiale portale (documenti PDF/HTML dal portale) ---
router.post("/stampa-portale",              requireAuth, portaleController.stampaPortale);

// --- Diagnostica (debug flusso portale) ---
router.post("/diagnostica",                             portaleController.diagnostica);

// =============================================================================
// RICERCA GENERICA — wrapper autenticato su readPortalSearchViaBrowser
// Supporta tutti i tab types configurati in PORTAL_TAB_CONFIG:
//   SQI, SGOS, SQA, SCQC, SCQCA, VAC, VSC, VAQ, VSQ, VSR, VAR, VSRCQC, VARCQC
// Body: { tabType, dataFrom?, dataTo?, stato?, tipoEsame? }
// =============================================================================
router.post("/ricerca-generica", requireAuth, async (req, res) => {
  const trace = [];
  try {
    const { readPortalSearchViaBrowser, PORTAL_TAB_CONFIG } = require("../connector/portalSession");
    const { parseGenericTable } = require("../parser/genericTableParser");
    const { resolvePortalCredentials } = require("../server/portalHelpers");

    const tabType = String(req.body?.tabType || "").trim().toUpperCase();
    if (!tabType) {
      return res.status(400).json({ ok: false, error: "tabType obbligatorio", validTabTypes: Object.keys(PORTAL_TAB_CONFIG) });
    }
    if (!PORTAL_TAB_CONFIG[tabType]) {
      return res.status(400).json({ ok: false, error: `tabType sconosciuto: ${tabType}`, validTabTypes: Object.keys(PORTAL_TAB_CONFIG) });
    }

    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti. Configura PORTAL_USERNAME e PORTAL_PASSWORD." });
    }

    const options = {
      ...creds,
      trace,
      dateFrom: req.body?.dataFrom || req.body?.dateFrom || "",
      dateTo: req.body?.dataTo || req.body?.dateTo || "",
      stato: req.body?.stato || "",
      tipoEsame: req.body?.tipoEsame || "",
    };

    const html = await readPortalSearchViaBrowser(tabType, options);
    const parsed = parseGenericTable(html);

    res.json({
      ok: true,
      tabType,
      intestazioni: parsed.intestazioni,
      righe: parsed.righe,
      count: parsed.count,
      message: parsed.message,
      pageTitle: parsed.pageTitle,
      trace: trace.slice(-10),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace: trace.slice(-10) });
  }
});

// =============================================================================
// PAGE VIEW GENERICO — carica QUALSIASI pagina del portale e ritorna:
//   - HTML parsato come tabella generica
//   - Form fields rilevati
//   - Titolo pagina
// Body: { pageUrl }  (URL relativa, es. "/sistema-pagamenti/carrello")
// =============================================================================
router.post("/page-view", requireAuth, async (req, res) => {
  const trace = [];
  try {
    const { readPortalPageViaBrowser } = require("../connector/portalSession");
    const { parseGenericTable } = require("../parser/genericTableParser");
    const { resolvePortalCredentials } = require("../server/portalHelpers");

    const pageUrl = String(req.body?.pageUrl || "").trim();
    if (!pageUrl) {
      return res.status(400).json({ ok: false, error: "pageUrl obbligatoria" });
    }
    // Sicurezza: deve essere URL relativa o del dominio portale
    if (pageUrl.startsWith("http") && !pageUrl.includes("ilportaledellautomobilista.it")) {
      return res.status(400).json({ ok: false, error: "pageUrl non consentita (solo dominio portale)" });
    }

    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti" });
    }

    const html = await readPortalPageViaBrowser(pageUrl, { ...creds, trace });
    const parsed = parseGenericTable(html);

    // Estrai anche eventuali campi form visibili + link/bottoni principali
    const cheerio = require("cheerio");
    const $ = cheerio.load(html || "");
    const formFields = [];
    $("form").each((_, form) => {
      $(form).find("input, select, textarea").each((__, el) => {
        const type = $(el).attr("type") || el.tagName;
        const name = $(el).attr("name") || "";
        const id = $(el).attr("id") || "";
        if (type === "hidden" || !name) return;
        if (formFields.length < 30) {
          formFields.push({
            type: type.toLowerCase(),
            name: name.slice(0, 80),
            id: id.slice(0, 80),
            label: ($(el).attr("placeholder") || $(el).attr("title") || "").slice(0, 60),
          });
        }
      });
    });

    res.json({
      ok: true,
      pageUrl,
      pageTitle: parsed.pageTitle,
      intestazioni: parsed.intestazioni,
      righe: parsed.righe,
      count: parsed.count,
      message: parsed.message,
      formFields,
      trace: trace.slice(-10),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace: trace.slice(-10) });
  }
});

// =============================================================================
// CREDITO RESIDUO — PagoPA
// Legge la pagina credito residuo PagoPA del portale autoscuola.
// =============================================================================
router.post("/credito-residuo", requireAuth, async (req, res) => {
  const trace = [];
  try {
    const { readPortalPageViaBrowser } = require("../connector/portalSession");
    const { parseGenericTable } = require("../parser/genericTableParser");
    const { resolvePortalCredentials } = require("../server/portalHelpers");

    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti" });
    }

    const pageUrl = "/sistema-pagamenti/creditoResiduo/Read_initAction.action";
    const html = await readPortalPageViaBrowser(pageUrl, { ...creds, trace });
    const parsed = parseGenericTable(html);

    // Estrai anche eventuale saldo in evidenza (span/div con "€", "saldo", "credito")
    const cheerio = require("cheerio");
    const $ = cheerio.load(html || "");
    let saldo = "";
    $("span, div, td, b, strong").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (!saldo && /€|euro/i.test(t) && /\d/.test(t) && t.length < 60) {
        saldo = t;
      }
    });

    res.json({
      ok: true,
      intestazioni: parsed.intestazioni,
      righe: parsed.righe,
      count: parsed.count,
      message: parsed.message,
      saldo,
      trace: trace.slice(-10),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace: trace.slice(-10) });
  }
});

// =============================================================================
// RECORDER — sessione interattiva con cattura movimenti
// Apre un browser Chrome visibile gia' loggato sul portale. L'utente naviga
// liberamente e ogni click / submit / navigazione / POST viene registrato.
// =============================================================================
router.post("/recorder/start", requireAuth, async (req, res) => {
  try {
    const recorder = require("../connector/portalRecorder");
    const { resolvePortalCredentials } = require("../server/portalHelpers");
    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti (PORTAL_USER/PORTAL_PASS/PORTAL_PIN)" });
    }
    const note = String(req.body?.note || "").slice(0, 200);
    const out = await recorder.startRecording({ ...creds, note });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/recorder/stop", requireAuth, async (req, res) => {
  try {
    const recorder = require("../connector/portalRecorder");
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId obbligatorio" });
    const out = await recorder.stopRecording(sessionId);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/recorder/status/:sessionId", requireAuth, async (req, res) => {
  try {
    const recorder = require("../connector/portalRecorder");
    const out = recorder.getStatus(req.params.sessionId);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

router.get("/recorder/list", requireAuth, async (_req, res) => {
  try {
    const recorder = require("../connector/portalRecorder");
    res.json({ ok: true, sessions: recorder.listSessions() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/recorder/clear", requireAuth, async (req, res) => {
  try {
    const recorder = require("../connector/portalRecorder");
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId obbligatorio" });
    const out = await recorder.clearSession(sessionId);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Test browser submit (senza auth, per debug) ---
router.post("/test-browser-submit", async (req, res) => {
  try {
    const { readPortalSearchViaBrowser } = require("../connector/portalSession");
    const { parseSessioniReadOnly } = require("../parser/sessionParser");
    const { getSessionPageDiagnostics } = require("../connector/portalHttp");
    const trace = [];
    const creds = {
      username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin: process.env.PORTAL_PIN,
    };
    const tabType = req.body?.tabType || "SQI";
    const stato = req.body?.stato || "";
    const html = await readPortalSearchViaBrowser(tabType, { ...creds, trace, stato });
    const parsed = parseSessioniReadOnly(html);
    const diag = getSessionPageDiagnostics(html);
    // Salva HTML per analisi
    try {
      const fs = require("fs");
      const path = require("path");
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, `browser-${tabType.toLowerCase()}.html`), html || "", "utf8");
    } catch (_) {}
    // Check per listTable e elementi
    const cheerio = require("cheerio");
    const $h = cheerio.load(html || "");
    const hasListTable = $h("#listTable").length > 0;
    const elementiText = ($h("*:contains('elementi trovati')").last().text() || "").trim().slice(0, 100);
    const tableCount = $h("table").length;
    const errorMessages = [];
    $h(".errorMessage, .error, .alert-danger, .alert-error, #errorMessages").each((_, el) => {
      const t = $h(el).text().trim();
      if (t) errorMessages.push(t.slice(0, 200));
    });
    res.json({
      ok: true,
      tabType,
      sessioniCount: parsed.length,
      sessioni: parsed.slice(0, 5),
      diagnostics: diag,
      htmlLength: (html || "").length,
      hasListTable,
      elementiText,
      tableCount,
      errorMessages,
      trace: trace.slice(-15),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack?.split("\n").slice(0, 5) });
  }
});

module.exports = router;
