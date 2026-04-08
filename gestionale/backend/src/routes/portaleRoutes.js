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
