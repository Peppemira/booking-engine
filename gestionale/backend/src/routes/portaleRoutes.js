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
      $(form).find("input, select, textarea, button").each((__, el) => {
        const type = $(el).attr("type") || el.tagName;
        const name = $(el).attr("name") || "";
        const id = $(el).attr("id") || "";
        if (type === "hidden" || !name) return;
        if (formFields.length < 30) {
          // Estrazione label umana: 1) <label for="id">, 2) placeholder/title, 3) testo cella precedente
          let humanLabel = "";
          if (id) {
            const lbl = $(`label[for="${id.replace(/(["\\])/g, "\\$1")}"]`).first();
            if (lbl.length) humanLabel = lbl.text().trim().replace(/\s+/g, " ").replace(/[*:]+\s*$/, "");
          }
          if (!humanLabel) {
            humanLabel = ($(el).attr("placeholder") || $(el).attr("title") || "").trim();
          }
          if (!humanLabel) {
            // Fallback: testo del <td> precedente (pattern Struts2 layout tabellare)
            const prevTd = $(el).closest("td").prev("td");
            if (prevTd.length) humanLabel = prevTd.text().trim().replace(/\s+/g, " ").replace(/[*:]+\s*$/, "");
          }
          // Per submit/button: il `value` è la label visibile sul portale
          const valueAttr = ($(el).attr("value") || "").trim();
          if ((type === "submit" || type === "button" || type === "image" || el.tagName === "button") && valueAttr) {
            humanLabel = valueAttr;
          }

          formFields.push({
            type: type.toLowerCase(),
            name: name.slice(0, 256),
            id: id.slice(0, 256),
            label: humanLabel.slice(0, 120),
            value: valueAttr.slice(0, 120),
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
// HELPER: extractPortalAnagrafica($)
// Estrae i campi anagrafica dalla pagina "Inserimento Richiesta Certificato Medico"
// (Solo CF response). Mappa i nomi Struts2 portale → colonne DB candidates.
// Ritorna null se la pagina non sembra contenere anagrafica.
// =============================================================================
function extractPortalAnagrafica($) {
  const FIELD_PREFIX = "richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.";

  const get = (suffix) => {
    let el = $(`input[name="${FIELD_PREFIX}${suffix}"]`).first();
    if (!el.length) el = $(`input[name$=".${suffix}"]`).first();
    return (el.attr("value") || "").trim();
  };

  // Per <select>: legge hidden ...selectRowId (codice ISTAT) + cerca testo
  // dell'option corrispondente nel <select>...selectRowIdRead (display).
  const getSelect = (suffix) => {
    let hidden = $(`input[type=hidden][name="${FIELD_PREFIX}${suffix}.selectRowId"]`).first();
    if (!hidden.length) hidden = $(`input[type=hidden][name$=".${suffix}.selectRowId"]`).first();
    const code = (hidden.attr("value") || "").trim();
    if (!code) return { code: "", text: "" };
    let select = $(`select[name="${FIELD_PREFIX}${suffix}.selectRowIdRead"]`).first();
    if (!select.length) select = $(`select[name$=".${suffix}.selectRowIdRead"]`).first();
    const opt = select.find(`option[value="${code.replace(/"/g, '\\"')}"]`).first();
    return { code, text: (opt.text() || "").trim() };
  };

  // Conversione data: DD/MM/YYYY → YYYY-MM-DD
  const toIsoDate = (ddmmyyyy) => {
    const m = String(ddmmyyyy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };

  const cognome = get("desCog");
  const nome = get("desNom");
  const datNas = get("datNas"); // DD/MM/YYYY
  const sesso = get("flgSex"); // M/F
  const codFis = get("codFis");
  const numeroPatente = get("thePatente.numeroPatenteCompleto");
  const via = get("desIndRes");
  const civico = get("codNumCvoIndRes");
  const cap = get("codCapRes");
  const email = get("desIndEma");
  const telefono = get("desRecTel");

  const comuneNascita = getSelect("theComuneNascita");
  const provinciaNascita = getSelect("theComuneNascita.theProvinciaNascita");
  const comuneResidenza = getSelect("theComuneResidenza");
  const provinciaResidenza = getSelect("theComuneResidenza.theProvinciaResidenza");
  const statoNascita = getSelect("theStatoEstero");

  // Considera valida l'estrazione solo se almeno cognome o CF sono popolati
  const hasData = !!(cognome || nome || codFis || numeroPatente);
  if (!hasData) return null;

  return {
    cognome: cognome ? cognome.toUpperCase() : null,
    nome: nome ? nome.toUpperCase() : null,
    data_nascita: toIsoDate(datNas),
    data_nascita_raw: datNas || null,
    sesso: sesso ? sesso.toUpperCase() : null,
    codice_fiscale: codFis ? codFis.toUpperCase() : null,
    patente_numero: numeroPatente ? numeroPatente.toUpperCase() : null,
    indirizzo: [via, civico].filter(Boolean).join(" ").trim() || null,
    indirizzo_via: via || null,
    civico: civico || null,
    cap: cap || null,
    email: email ? email.toLowerCase() : null,
    telefono: telefono || null,
    comune_nascita: comuneNascita.text || null,
    provincia_nascita: provinciaNascita.text || null,
    comune_residenza: comuneResidenza.text || null,
    provincia_residenza: provinciaResidenza.text || null,
    stato_nascita: statoNascita.text || null,
    _codes: {
      comune_nascita: comuneNascita.code || null,
      provincia_nascita: provinciaNascita.code || null,
      comune_residenza: comuneResidenza.code || null,
    },
  };
}

// =============================================================================
// PAGE FORM SUBMIT — compila e submette un form generico del portale
// Body: {
//   pageUrl: string,                  // URL relativa pagina portale
//   formData: { [name]: value },      // valori dei campi (input/select/textarea/checkbox/radio)
//   action: string,                   // name dell'input submit da cliccare (es. "action:Read..._pagingAcq...")
// }
// Ritorna stessa struttura di /page-view ma del risultato post-submit.
// =============================================================================
router.post("/page-form-submit", requireAuth, async (req, res) => {
  const trace = [];
  try {
    const { submitPortalFormViaBrowser } = require("../connector/portalSession");
    const { parseGenericTable } = require("../parser/genericTableParser");
    const { resolvePortalCredentials } = require("../server/portalHelpers");

    const pageUrl = String(req.body?.pageUrl || "").trim();
    const formData = req.body?.formData && typeof req.body.formData === "object" ? req.body.formData : {};
    const action = String(req.body?.action || "").trim();

    if (!pageUrl) {
      return res.status(400).json({ ok: false, error: "pageUrl obbligatoria" });
    }
    if (pageUrl.startsWith("http") && !pageUrl.includes("ilportaledellautomobilista.it")) {
      return res.status(400).json({ ok: false, error: "pageUrl non consentita (solo dominio portale)" });
    }

    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti" });
    }

    const { html, fillResult } = await submitPortalFormViaBrowser(pageUrl, formData, action, { ...creds, trace });
    const parsed = parseGenericTable(html);

    // Estrai eventuali campi form della pagina risultante (per submit ulteriori es. paging)
    const cheerio = require("cheerio");
    const $ = cheerio.load(html || "");
    const formFields = [];
    $("form").each((_, form) => {
      $(form).find("input, select, textarea, button").each((__, el) => {
        const type = $(el).attr("type") || el.tagName;
        const name = $(el).attr("name") || "";
        const id = $(el).attr("id") || "";
        if (type === "hidden" || !name) return;
        if (formFields.length < 30) {
          // Estrazione label umana: 1) <label for="id">, 2) placeholder/title, 3) testo cella precedente
          let humanLabel = "";
          if (id) {
            const lbl = $(`label[for="${id.replace(/(["\\])/g, "\\$1")}"]`).first();
            if (lbl.length) humanLabel = lbl.text().trim().replace(/\s+/g, " ").replace(/[*:]+\s*$/, "");
          }
          if (!humanLabel) {
            humanLabel = ($(el).attr("placeholder") || $(el).attr("title") || "").trim();
          }
          if (!humanLabel) {
            // Fallback: testo del <td> precedente (pattern Struts2 layout tabellare)
            const prevTd = $(el).closest("td").prev("td");
            if (prevTd.length) humanLabel = prevTd.text().trim().replace(/\s+/g, " ").replace(/[*:]+\s*$/, "");
          }
          // Per submit/button: il `value` è la label visibile sul portale
          const valueAttr = ($(el).attr("value") || "").trim();
          if ((type === "submit" || type === "button" || type === "image" || el.tagName === "button") && valueAttr) {
            humanLabel = valueAttr;
          }

          formFields.push({
            type: type.toLowerCase(),
            name: name.slice(0, 256),
            id: id.slice(0, 256),
            label: humanLabel.slice(0, 120),
            value: valueAttr.slice(0, 120),
          });
        }
      });
    });

    // Estrai eventuali messaggi di errore visibili
    const errorMessages = [];
    $(".errorMessage, .error, .alert-danger, .alert-error, #errorMessages, .messageError").each((_, el) => {
      const t = $(el).text().trim().replace(/\s+/g, " ");
      if (t) errorMessages.push(t.slice(0, 200));
    });

    // === DETECT "PATENTE SOSTITUITA" ===
    // Il portale risponde: "La patente digitata è stata sostituita dalla patente numero XXXXXX"
    // Estraiamo il nuovo numero + i dati per permettere update lato candidato.
    let detectedPatenteUpdate = null;
    const allMessages = errorMessages.join(" \n ") + " " + ($("body").text() || "").replace(/\s+/g, " ");
    const subMatch = allMessages.match(/sostituit[ao][^.]{0,80}patente\s+numero\s+([A-Z0-9]{6,20})/i);
    if (subMatch) {
      const newPatente = subMatch[1].trim().toUpperCase();
      // Estraggo old patente + CF dai formData inviati (oppure dai campi visibili nella response)
      const oldPatente = String(
        formData["richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.thePatente.numeroPatenteCompleto"] ||
        formData["thePatente.numeroPatenteCompleto"] ||
        $("input[name$='numeroPatenteCompleto']").first().attr("value") ||
        ""
      ).trim().toUpperCase();
      const codFis = String(
        formData["richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.codFis"] ||
        formData.codFis ||
        $("input[name$='codFis']").first().attr("value") ||
        ""
      ).trim().toUpperCase();
      const fullMessage = errorMessages.find(m => /sostituit/i.test(m)) || subMatch[0];
      if (newPatente && newPatente !== oldPatente) {
        detectedPatenteUpdate = {
          oldPatente: oldPatente || null,
          newPatente,
          codiceFiscale: codFis || null,
          message: fullMessage.slice(0, 200),
        };
      }
    }

    // Estrai anagrafica strutturata (per pagine "Inserimento Richiesta Certificato Medico")
    let portalAnagrafica = null;
    try { portalAnagrafica = extractPortalAnagrafica($); } catch { portalAnagrafica = null; }

    res.json({
      ok: true,
      pageUrl,
      action,
      pageTitle: parsed.pageTitle,
      intestazioni: parsed.intestazioni,
      righe: parsed.righe,
      count: parsed.count,
      message: parsed.message,
      formFields,
      errorMessages,
      detectedPatenteUpdate,
      portalAnagrafica,
      fillResult,
      trace: trace.slice(-15),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace: trace.slice(-15) });
  }
});

// =============================================================================
// UPDATE PATENTE CANDIDATO — quando il portale segnala "patente sostituita"
// Body: {
//   codiceFiscale: string,           // identifica il candidato dentro l'autoscuola
//   newPatente: string,              // nuovo numero patente (da detectedPatenteUpdate)
//   oldPatente?: string,             // (opzionale) per tracciamento + safety check
//   scadeIlPatente?: "YYYY-MM-DD"    // (opzionale) se conosciuta
// }
// Aggiorna candidates.patente_numero (+ scade_il_patente se fornita) filtrando
// per autoscuola_id corrente. Restituisce { ok, updated: { id, patente_numero, ... } }.
// =============================================================================
router.post("/update-candidate-patente", requireAuth, async (req, res) => {
  try {
    const supabase = require("../database/supabase");

    const codiceFiscale = String(req.body?.codiceFiscale || "").trim().toUpperCase();
    const newPatente    = String(req.body?.newPatente || "").trim().toUpperCase();
    const oldPatente    = String(req.body?.oldPatente || "").trim().toUpperCase();
    const scadeIlPatente = req.body?.scadeIlPatente ? String(req.body.scadeIlPatente).trim() : null;

    if (!codiceFiscale) return res.status(400).json({ ok: false, error: "codiceFiscale obbligatorio" });
    if (!newPatente)    return res.status(400).json({ ok: false, error: "newPatente obbligatorio" });
    if (newPatente === oldPatente) {
      return res.status(400).json({ ok: false, error: "newPatente uguale a oldPatente: nulla da fare" });
    }

    const autoscuolaId = req.autoscuolaId || null;

    // Trova candidato per CF (case-insensitive) dentro l'autoscuola
    let q = supabase
      .from("candidates")
      .select("id, cognome, nome, codice_fiscale, patente_numero, scade_il_patente, autoscuola_id")
      .ilike("codice_fiscale", codiceFiscale);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data: candidates, error: errFind } = await q.limit(5);
    if (errFind) return res.status(500).json({ ok: false, error: errFind.message });
    if (!candidates || candidates.length === 0) {
      return res.status(404).json({ ok: false, error: `Nessun candidato con CF ${codiceFiscale} in questa autoscuola` });
    }
    if (candidates.length > 1) {
      return res.status(409).json({
        ok: false,
        error: `Trovati ${candidates.length} candidati con stesso CF, ambiguo`,
        candidates: candidates.map(c => ({ id: c.id, cognome: c.cognome, nome: c.nome, patente_numero: c.patente_numero })),
      });
    }
    const cand = candidates[0];

    // Safety: se oldPatente è fornita e non corrisponde, segnaliamo (ma non blocchiamo)
    let mismatch = null;
    if (oldPatente && cand.patente_numero && cand.patente_numero.toUpperCase() !== oldPatente) {
      mismatch = `Vecchia patente in DB (${cand.patente_numero}) diversa da quella attesa (${oldPatente})`;
    }

    // Costruisco l'update
    const patch = { patente_numero: newPatente };
    if (scadeIlPatente && /^\d{4}-\d{2}-\d{2}$/.test(scadeIlPatente)) {
      patch.scade_il_patente = scadeIlPatente;
    }

    let upd = supabase.from("candidates").update(patch).eq("id", cand.id);
    if (autoscuolaId) upd = upd.eq("autoscuola_id", autoscuolaId);
    const { data: updated, error: errUpd } = await upd
      .select("id, cognome, nome, codice_fiscale, patente_numero, scade_il_patente")
      .maybeSingle();
    if (errUpd) return res.status(500).json({ ok: false, error: errUpd.message });

    return res.json({
      ok: true,
      previous: {
        id: cand.id,
        patente_numero: cand.patente_numero,
        scade_il_patente: cand.scade_il_patente,
      },
      updated,
      mismatch,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================================================================
// SYNC CANDIDATO DA PORTALE — confronta dati portale con DB e applica update
// Body: {
//   codiceFiscale: string,                         // identifica candidato (CF univoco)
//   anagraficaPortale: { cognome, nome, ... },     // dati estratti dal portale (extractPortalAnagrafica)
//   patenteNuova?: string,                         // se diversa da DB, aggiorna patente_numero
//   includePunti?: boolean,                        // se true, prova a chiamare Punti API per scadenza
//   dryRun?: boolean,                              // se true, ritorna solo diff senza applicare
// }
// Restituisce: {
//   ok, candidate: {id,cognome,nome,codice_fiscale},
//   diff: [{ field, current, portal, willChange }],
//   willUpdateCount, patch,
//   punti, puntiError,
//   updated (null se dryRun o nessun cambio)
// }
// =============================================================================
router.post("/sync-candidate-from-portal", requireAuth, async (req, res) => {
  try {
    const supabase = require("../database/supabase");
    const { resolvePortalCredentials } = require("../server/portalHelpers");

    const codiceFiscale = String(req.body?.codiceFiscale || "").trim().toUpperCase();
    const portal = req.body?.anagraficaPortale && typeof req.body.anagraficaPortale === "object"
      ? req.body.anagraficaPortale : {};
    const patenteNuova = req.body?.patenteNuova ? String(req.body.patenteNuova).trim().toUpperCase() : null;
    const includePunti = !!req.body?.includePunti;
    const dryRun = !!req.body?.dryRun;

    if (!codiceFiscale) return res.status(400).json({ ok: false, error: "codiceFiscale obbligatorio" });
    if (!Object.keys(portal).length && !patenteNuova) {
      return res.status(400).json({ ok: false, error: "anagraficaPortale o patenteNuova richiesti" });
    }

    const autoscuolaId = req.autoscuolaId || null;

    // Trova candidato
    let q = supabase
      .from("candidates")
      .select("id, autoscuola_id, cognome, nome, codice_fiscale, data_nascita, sesso, comune_nascita, provincia_nascita, indirizzo, cap, comune, provincia, telefono, email, patente_numero, scade_il_patente, categoria_patente")
      .ilike("codice_fiscale", codiceFiscale);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data: candidates, error: errFind } = await q.limit(5);
    if (errFind) return res.status(500).json({ ok: false, error: errFind.message });
    if (!candidates || !candidates.length) {
      return res.status(404).json({ ok: false, error: `Nessun candidato con CF ${codiceFiscale} in questa autoscuola` });
    }
    if (candidates.length > 1) {
      return res.status(409).json({
        ok: false,
        error: `Trovati ${candidates.length} candidati con stesso CF, ambiguo`,
        candidates: candidates.map(c => ({ id: c.id, cognome: c.cognome, nome: c.nome, patente_numero: c.patente_numero })),
      });
    }
    const cand = candidates[0];

    // Prova chiamata Punti API (opzionale, ignora errori — l'API può rispondere 404)
    let punti = null;
    let puntiError = null;
    if (includePunti) {
      const targetPatente = patenteNuova || portal.patente_numero || cand.patente_numero;
      if (targetPatente) {
        try {
          const { getPuntiPatente } = require("../connector/puntiPatente");
          const creds = await resolvePortalCredentials(req);
          punti = await getPuntiPatente({
            codiceFiscale,
            numeroPatente: targetPatente,
            username: creds.username,
            password: creds.password,
            pin: creds.pin,
          });
        } catch (e) {
          puntiError = e.message || String(e);
        }
      }
    }

    // Mappa: { field: colonna DB, portal: valore dal portale }
    const FIELD_MAP = [
      { field: "cognome",            portal: portal.cognome },
      { field: "nome",               portal: portal.nome },
      { field: "data_nascita",       portal: portal.data_nascita },
      { field: "sesso",              portal: portal.sesso },
      { field: "comune_nascita",     portal: portal.comune_nascita },
      { field: "provincia_nascita",  portal: portal.provincia_nascita },
      { field: "indirizzo",          portal: portal.indirizzo },
      { field: "cap",                portal: portal.cap },
      { field: "comune",             portal: portal.comune_residenza },
      { field: "provincia",          portal: portal.provincia_residenza },
      { field: "email",              portal: portal.email },
      { field: "telefono",           portal: portal.telefono },
      { field: "patente_numero",     portal: patenteNuova || portal.patente_numero },
    ];

    // Aggiungi scadenza patente se Punti restituisce scadenzaValidita
    if (punti && typeof punti === "object" && punti.scadenzaValidita) {
      let iso = String(punti.scadenzaValidita).trim();
      const m = iso.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        FIELD_MAP.push({ field: "scade_il_patente", portal: iso });
      }
    }

    // Costruisci diff + patch
    const diff = [];
    const patch = {};
    for (const { field, portal: portalVal } of FIELD_MAP) {
      const currentVal = cand[field] != null ? String(cand[field]) : "";
      const newVal = portalVal != null ? String(portalVal).trim() : "";
      if (!newVal) continue; // skip se portale non ha valore (no overwrite con vuoto)
      const willChange = currentVal.trim().toUpperCase() !== newVal.trim().toUpperCase();
      diff.push({
        field,
        current: currentVal || null,
        portal: newVal,
        willChange,
      });
      if (willChange) patch[field] = newVal;
    }

    const willUpdateCount = Object.keys(patch).length;
    const candidateInfo = { id: cand.id, cognome: cand.cognome, nome: cand.nome, codice_fiscale: cand.codice_fiscale };

    if (dryRun || willUpdateCount === 0) {
      return res.json({
        ok: true,
        dryRun: !!dryRun,
        candidate: candidateInfo,
        diff,
        willUpdateCount,
        patch,
        punti: punti || null,
        puntiError,
        updated: null,
      });
    }

    // Applica update
    let upd = supabase.from("candidates").update(patch).eq("id", cand.id);
    if (autoscuolaId) upd = upd.eq("autoscuola_id", autoscuolaId);
    const { data: updated, error: errUpd } = await upd
      .select("id, cognome, nome, codice_fiscale, data_nascita, sesso, comune_nascita, provincia_nascita, indirizzo, cap, comune, provincia, telefono, email, patente_numero, scade_il_patente")
      .maybeSingle();
    if (errUpd) return res.status(500).json({ ok: false, error: errUpd.message });

    return res.json({
      ok: true,
      dryRun: false,
      candidate: candidateInfo,
      diff,
      willUpdateCount,
      patch,
      punti: punti || null,
      puntiError,
      updated,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
