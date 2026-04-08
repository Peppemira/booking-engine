/**
 * TRASMISSIONE PRATICHE SUL PORTALE — Replica iPatente
 * =====================================================
 * Automatizza la trasmissione di pratiche sul Portale dell'Automobilista.
 * Replica il comportamento di iPatente (portale_do.js / portale.js):
 *
 *   trasmissione_pratica_conseguimento   → trasmettiConseguimentoPatente()
 *   trasmissione_pratica_conseguimento_cqc → trasmettiConseguimentoCQC()
 *   trasmissione_pratica_conseguimento_fase1 → trasmettiPrimaFase()
 *   trasmissione_pratica_rinnovo         → trasmettiRinnovoPatente()
 *   trasmissione_pratica_rinnovo_medico  → trasmettiRinnovoMedico()
 *   trasmissione_pratica_altro           → trasmettiPraticaAltro()
 *   verifica_rinnovabilita               → verificaRinnovabilita()
 *
 * Strategia: Puppeteer fullpage + jQuery injection (come iPatente).
 * Login: usa loginAndGetJar (Puppeteer) con sessione condivisa.
 */

"use strict";

const puppeteer = require("puppeteer");
const fs        = require("fs");
const os        = require("os");
const path      = require("path");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const LOGIN_URL   = `${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`;

// Timeout default (ms)
const NAV_TIMEOUT   = 45_000;
const AJAX_WAIT     = 3_000;   // attesa cascading select (come iPatente submitTimeout)
const SUBMIT_WAIT   = 5_000;

// =============================================================================
// UTILITÀ
// =============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Salva base64 in file temporaneo e restituisce il path.
 * Gestisce il prefisso data:image/...;base64,...
 */
function base64ToTempFile(b64, ext = "jpg") {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
  const buf     = Buffer.from(cleaned, "base64");
  const tmp     = path.join(os.tmpdir(), `ipatente_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/**
 * Rimuove file temporanei in sicurezza.
 */
function cleanupTempFiles(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}

/**
 * Apre browser Puppeteer e fa login al portale.
 * Restituisce { browser, page }.
 */
async function openBrowserAndLogin(credentials = {}) {
  const { username, password, pin } = credentials;
  if (!username || !password) {
    throw new Error("Credenziali portale mancanti (username/password)");
  }

  const headless = process.env.PORTAL_HEADLESS !== "false";

  const browser = await puppeteer.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  // Blocca risorse non necessarie
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    if (["image", "font", "stylesheet", "media"].includes(t)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // 1. Login
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Inserisci username
  const userSel = await resolveSelector(page, [
    'input[name="loginView.beanUtente.userName"]',
    'input[name="loginView.username"]',
    'input[name="username"]',
    'input[type="text"]',
  ]);
  if (!userSel) throw new Error("Campo username non trovato nel portale");
  await page.click(userSel, { clickCount: 3 });
  await page.type(userSel, username, { delay: 15 });

  // Inserisci password
  const passSel = await resolveSelector(page, [
    'input[name="loginView.beanUtente.password"]',
    'input[name="loginView.password"]',
    'input[name="password"]',
    'input[type="password"]',
  ]);
  if (!passSel) throw new Error("Campo password non trovato nel portale");
  await page.click(passSel, { clickCount: 3 });
  await page.type(passSel, password, { delay: 15 });

  // Click login
  const loginBtn = await resolveSelector(page, [
    'input[name="action:Login_executeLogin"]',
    'button[name="action:Login_executeLogin"]',
    'input[type="submit"]',
    'button[type="submit"]',
  ]);
  if (loginBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null),
      page.click(loginBtn),
    ]);
  }

  // 2. Gestione PIN (se presente)
  const pinPresent = await page.evaluate(() =>
    !!(document.querySelector('input[name="loginView.pin"]') ||
       document.querySelector('input[name*="pin"]'))
  );
  if (pinPresent && pin) {
    const pinSel = 'input[name="loginView.pin"]';
    await page.waitForSelector(pinSel, { timeout: 15_000 }).catch(() => null);
    await page.click(pinSel, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(pinSel, pin, { delay: 20 });
    const pinBtn = await resolveSelector(page, [
      'input[name="action:Pin_executePinValidation"]',
      'button[type="submit"]',
      'input[type="submit"]',
    ]);
    if (pinBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null),
        page.click(pinBtn),
      ]);
    }
    await sleep(2000);
  }

  return { browser, page };
}

/** Restituisce il primo selettore trovato sulla pagina */
async function resolveSelector(page, selectors, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return sel;
      } catch (_) {}
    }
    await sleep(200);
  }
  return null;
}

/**
 * Estrae messaggi di errore/successo dalla pagina del portale.
 * Replica portale.errorMessage()
 */
async function extractPageMessage(page) {
  return page.evaluate(() => {
    const selectors = [
      ".errorMessage li span",
      ".errori > p",
      ".errori > ul > li > span",
      ".messaggio > p",
      ".messaggio p",
      ".actionMessage li span",
      ".alert-danger p",
      ".alert p",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return "";
  });
}

/**
 * Estrae il valore di un campo hidden dal form.
 * Replica: content.find("[name*='marcaOperativa']").val()
 */
async function extractFormValue(page, namePart) {
  return page.evaluate((np) => {
    // cerca per name esatto o parziale
    let el = document.querySelector(`[name="${np}"]`);
    if (!el) {
      const all = Array.from(document.querySelectorAll(`[name*="${np}"]`));
      el = all.find(e => e.name && e.name.includes(np));
    }
    return el ? (el.value || "").trim() : "";
  }, namePart);
}

/**
 * Imposta un campo di testo (input/textarea).
 * Gestisce readonly: salta se readonly, imposta se non readonly.
 */
async function fillField(page, namePart, value) {
  if (value === null || value === undefined) return;
  const val = String(value).trim();
  await page.evaluate((np, v) => {
    const all = Array.from(document.querySelectorAll(`[name*="${np}"]`));
    for (const el of all) {
      if (el.readOnly || el.type === "hidden") continue;
      if (el.tagName === "SELECT") {
        el.value = v;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        el.value = v;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, namePart, val);
}

/**
 * Imposta una SELECT con attesa AJAX (cascading).
 * Replica il timeout di 3s di iPatente per cascading select.
 */
async function fillSelectCascading(page, namePart, value, waitMs = AJAX_WAIT) {
  await fillField(page, namePart, value);
  await sleep(waitMs);
}

/**
 * Compila tutti i campi del modulo.
 * Replica portale.compilaModulo(content).
 *
 * @param {Page} page - Puppeteer page
 * @param {object} modulo - dict { field_name: value }
 * @param {string} tipoPratica - per gestire le cascading select tipo-specifiche
 */
async function compilaModulo(page, modulo, tipoPratica) {
  if (!modulo || typeof modulo !== "object") return;

  const CASCADING_FIELDS = new Set([
    "theComuneNascita.selectRowId",
    "theComune.selectRowId",
    "theComuneResidenza.selectRowId",
    "theComuneRecapito.selectRowId",
    "codiceIdentificativoCia",
  ]);

  // Prima imposta i campi NON cascading
  for (const [field, value] of Object.entries(modulo)) {
    if (CASCADING_FIELDS.has(field)) continue;
    await fillField(page, field, value);
  }

  await sleep(500);

  // Poi imposta i cascading con attesa
  for (const [field, value] of Object.entries(modulo)) {
    if (!CASCADING_FIELDS.has(field)) continue;
    await fillSelectCascading(page, field, value, AJAX_WAIT);
  }
}

/**
 * Compila i bollettini postali.
 * Replica il loop bollettini in trasmettiPraticaConseguimento.
 */
async function compilaBollettini(page, bollettini) {
  if (!Array.isArray(bollettini)) return;
  for (let i = 0; i < bollettini.length; i++) {
    const b = bollettini[i];
    if (!b || (!b.numero1 && !b.numero2)) continue;
    const index = b.tipo === "4028" ? 1 : 0;
    const prefix = `bollettinoPosteView.bollettinoPosteList[${index}]`;
    await fillField(page, `${prefix}.codiceControllo`, b.numero1 || "");
    await fillField(page, `${prefix}.quartoCampo`,    b.numero2 || "");
    await fillField(page, `${prefix}.frazionarioA`,   b.timbro1 || "");
    await fillField(page, `${prefix}.frazionarioB`,   b.timbro2 || "");
    await fillField(page, `${prefix}.sezione`,        b.timbro3 || "");
    await fillField(page, `${prefix}.giornoData`,     b.timbro4 || "");
    await fillField(page, `${prefix}.meseData`,       b.timbro5 || "");
    await fillField(page, `${prefix}.annoData`,       b.timbro6 || "");
    await fillField(page, `${prefix}.progressivo`,    b.timbro7 || "");
  }
}

/**
 * Carica foto e firma tramite file input del portale.
 * Gli endpoint di upload sono:
 *   GestioneFile_upload.action      → foto
 *   GestioneFile_uploadFirma.action → firma
 *
 * @param {Page} page
 * @param {object} uploads - { baseUploadPath, fotoBase64, firmaBase64 }
 * @returns {{ fotoUploaded, firmaUploaded, errors }}
 */
async function uploadFotoFirma(page, { baseUploadPath, fotoBase64, firmaBase64 }) {
  const errors = [];
  let fotoUploaded  = false;
  let firmaUploaded = false;

  let tmpFoto  = null;
  let tmpFirma = null;

  try {
    // --- UPLOAD FOTO ---
    if (fotoBase64) {
      try {
        tmpFoto = base64ToTempFile(fotoBase64, "jpg");

        // Cerca il file input foto (nome varia per tipo pratica)
        const fotoInputSel = await resolveSelector(page, [
          'input[name="foto"]',
          'input[name="fotoFile"]',
          'input[name="file"]',
          'input[type="file"]:not([name*="firma"])',
          'input[type="file"]:first-of-type',
        ], 3000);

        if (fotoInputSel) {
          const fotoInput = await page.$(fotoInputSel);
          if (fotoInput) {
            await fotoInput.uploadFile(tmpFoto);
            // Aspetta navigazione verso GestioneFile_upload.action
            await sleep(2000);
            const afterUrl = page.url();
            fotoUploaded = afterUrl.includes("GestioneFile_upload") || afterUrl.includes("Read_initAction");
          }
        }
      } catch (e) {
        errors.push(`Upload foto: ${e.message}`);
      }
    }

    // --- UPLOAD FIRMA ---
    if (firmaBase64) {
      try {
        tmpFirma = base64ToTempFile(firmaBase64, "jpg");

        const firmaInputSel = await resolveSelector(page, [
          'input[name="firma"]',
          'input[name="firmaFile"]',
          'input[type="file"][name*="firma"]',
          'input[type="file"]:last-of-type',
        ], 3000);

        if (firmaInputSel) {
          const firmaInput = await page.$(firmaInputSel);
          if (firmaInput) {
            await firmaInput.uploadFile(tmpFirma);
            await sleep(2000);
            firmaUploaded = true;
          }
        }
      } catch (e) {
        errors.push(`Upload firma: ${e.message}`);
      }
    }
  } finally {
    cleanupTempFiles(tmpFoto, tmpFirma);
  }

  return { fotoUploaded, firmaUploaded, errors };
}

/**
 * Estrae i dati risultanti dal form (marcaOperativa, idRichiesta, ecc.)
 * dopo la compilazione/invio. Replica exeAggiornaMarcaOperativa.
 */
async function estraiDatiForm(page) {
  return page.evaluate(() => {
    const get = (namePart) => {
      const all = Array.from(document.querySelectorAll(`[name*="${namePart}"]`));
      for (const el of all) {
        if (el.value) return el.value.trim();
      }
      return "";
    };

    return {
      marcaOperativa:        get("marcaOperativa"),
      idRichiesta:           get("idRichiesta"),
      codiceEstremiPagamento: get("codiceEstremiPagamento"),
      codiceFoglioRosa:      get("codiceFoglioRosa"),
      // Estrai eventuali messaggi
      messaggioOk:  (document.querySelector(".messaggio p")?.textContent || "").trim(),
      messaggioErr: (document.querySelector(".errorMessage li span, .errori p")?.textContent || "").trim(),
    };
  });
}

// =============================================================================
// 1. TRASMISSIONE CONSEGUIMENTO PATENTE
// =============================================================================

/**
 * Trasmette una pratica di conseguimento patente al portale.
 * Replica: trasmissione_pratica_conseguimento (portale.js + portale_do.js)
 *
 * URL form: /RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=NEW
 * URL upload foto:  /RichiestaPatenti/richiestaEsame/GestioneFile_upload.action
 * URL upload firma: /RichiestaPatenti/richiestaEsame/GestioneFile_uploadFirma.action
 *
 * @param {object} opts
 * @param {object} opts.credentials      - { username, password, pin }
 * @param {object} opts.modulo           - dict campo→valore per il form
 * @param {Array}  opts.bollettini       - array bollettini postali
 * @param {string} opts.fotoBase64       - foto in base64 (opzionale)
 * @param {string} opts.firmaBase64      - firma in base64 (opzionale)
 * @param {string} [opts.cognome]        - cognome per ricerca candidato esistente
 * @param {string} [opts.patente]        - numero patente per ricerca (se esiste)
 * @param {string} [opts.medico_id_protocollo] - protocollo medico per ricerca
 * @param {Function} [opts.onProgress]   - callback(msg) per aggiornamenti live
 * @returns {Promise<{success, marcaOperativa, idRichiesta, codiceEstremiPagamento, error, log}>}
 */
async function trasmettiConseguimentoPatente(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    cognome = "",
    patente = "",
    medico_id_protocollo = "",
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const INIZIO_URL  = `${PORTAL_BASE}/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=NEW`;
  const MODULO_URL  = `${PORTAL_BASE}/RichiestaPatenti/richiestaEsame/Read_initAction.action`;

  let browser = null;

  try {
    logMsg("🔐 Login al portale...");
    const result = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = result.browser;
    const page = result.page;

    logMsg("📄 Navigazione al form conseguimento...");
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(1500);

    const curUrl = page.url();
    logMsg(`📍 URL corrente: ${curUrl}`);

    // --- STEP 1: Ricerca / Nuova richiesta ---
    if (medico_id_protocollo) {
      logMsg(`🔍 Ricerca per protocollo medico: ${medico_id_protocollo}`);
      // Inserisci cognome e protocollo
      await fillField(page, "richiestaPerEsameView.cognome", cognome);
      await fillField(page, "richiestaPerEsameView.richiestaFrom.protocolloCertificatoMedico", medico_id_protocollo);
      // Click "Ricerca"
      const ricercaBtn = await resolveSelector(page, [
        'input[id*="ricercaNewRichiestaEsame"]',
        '#Read_initAction_button_value_ricercaNewRichiestaEsame',
        'input[value*="Ricerca"]',
      ]);
      if (ricercaBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
          page.click(ricercaBtn),
        ]);
      }
    } else if (patente) {
      logMsg(`🔍 Ricerca per numero patente: ${patente}`);
      await fillField(page, "richiestaPerEsameView.cognome", cognome);
      await fillField(page, "richiestaPerEsameView.richiestaFrom.thePatentePosseduta.numeroPatenteCompleto", patente);
      const ricercaBtn = await resolveSelector(page, [
        '#Read_initAction_button_value_ricercaNewRichiestaEsame',
        'input[value*="Ricerca"]',
      ]);
      if (ricercaBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
          page.click(ricercaBtn),
        ]);
      }
    } else {
      logMsg("➕ Click su Nuova richiesta...");
      // Cerca il pulsante "Nuova richiesta" (diverso da "Ricerca")
      const nuovaBtn = await resolveSelector(page, [
        '#Read_initAction_button_value_newElementRichiesta',
        'input[name*="newElementRichiesta"]',
        'input[value*="Nuova"]',
        'button[value*="Nuova"]',
      ]);
      if (nuovaBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
          page.click(nuovaBtn),
        ]);
      } else {
        // Fallback: naviga direttamente con la query Struts2
        const ricercaUrl = `${PORTAL_BASE}/RichiestaPatenti/richiestaEsame/Read_initAction.action?struts.token.name=tokenrichiestaEsame&pageStatus=NEW` +
          `&richiestaPerEsameView.richiestaFrom.theTipoStatoRichiesta.codiceStatoRichiesta=` +
          `&richiestaPerEsameView.cognome=${encodeURIComponent(cognome || "")}` +
          `&richiestaPerEsameView.richiestaFrom.protocolloCertificatoMedico=` +
          `&richiestaPerEsameView.richiestaFrom.thePatentePosseduta.numeroPatenteCompleto=` +
          `&action%3AIns_checkNewRichiestaEsame=Nuova+richiesta`;
        await page.goto(ricercaUrl, { waitUntil: "domcontentloaded" });
      }
    }

    await sleep(2000);

    // --- STEP 2: Siamo sul form (Read_initAction.action) ---
    const formUrl = page.url();
    logMsg(`📝 Form aperto: ${formUrl}`);

    // Estrai il marcaOperativa PRIMA di compilare (il server lo assegna al caricamento)
    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    if (marcaPreCompile) {
      logMsg(`🏷️  marcaOperativa assegnata dal server: ${marcaPreCompile}`);
    }

    // --- STEP 3: Compila il modulo ---
    logMsg("✏️  Compilazione modulo...");
    await compilaModulo(page, modulo, "trasmissione_pratica_conseguimento");

    // --- STEP 4: Compila bollettini ---
    if (bollettini.length > 0) {
      logMsg(`💰 Compilazione bollettini (${bollettini.length})...`);
      await compilaBollettini(page, bollettini);
    }

    await sleep(1000);

    // --- STEP 5: Upload foto e firma ---
    if (fotoBase64 || firmaBase64) {
      logMsg("📷 Upload foto/firma...");
      const uploadResult = await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/richiestaEsame",
        fotoBase64,
        firmaBase64,
      });
      if (uploadResult.errors.length > 0) {
        logMsg(`⚠️  Upload parziale: ${uploadResult.errors.join("; ")}`);
      } else {
        logMsg("✅ Foto/firma caricate");
      }
    }

    // --- STEP 6: Estrai dati form PRIMA del submit ---
    const datiPreSubmit = await estraiDatiForm(page);
    logMsg(`🏷️  Dati estratti: marcaOperativa=${datiPreSubmit.marcaOperativa}, idRichiesta=${datiPreSubmit.idRichiesta}`);

    // --- STEP 7: Submit del form ---
    logMsg("🚀 Invio pratica al portale...");
    const submitBtn = await resolveSelector(page, [
      'input[name*="salvaRichiesta"]',
      'input[name*="submit"]',
      'button[name*="submit"]',
      'input[value*="Salva"]',
      'input[value*="Trasmetti"]',
      'input[value*="Conferma"]',
      'button[type="submit"]',
      'input[type="submit"]',
    ], 5000);

    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: SUBMIT_WAIT * 4 }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    } else {
      logMsg("⚠️  Pulsante submit non trovato — estraggo dati senza submit");
    }

    // --- STEP 8: Leggi risposta ---
    const datiPost = await estraiDatiForm(page);
    const errore   = await extractPageMessage(page);
    const finalUrl = page.url();

    logMsg(`📍 URL finale: ${finalUrl}`);
    if (datiPost.messaggioOk)  logMsg(`✅ Messaggio portale: ${datiPost.messaggioOk}`);
    if (datiPost.messaggioErr) logMsg(`❌ Errore portale: ${datiPost.messaggioErr}`);
    if (errore && !datiPost.messaggioErr) logMsg(`⚠️  Errore: ${errore}`);

    // Unisci i dati (pre-submit + post-submit)
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;
    const idRichFinal = datiPost.idRichiesta   || datiPreSubmit.idRichiesta;

    const success = !!(marcaFinal && !datiPost.messaggioErr && !errore);

    return {
      success,
      marcaOperativa:          marcaFinal,
      idRichiesta:             idRichFinal,
      codiceEstremiPagamento:  datiPost.codiceEstremiPagamento || datiPreSubmit.codiceEstremiPagamento,
      codiceFoglioRosa:        datiPost.codiceFoglioRosa,
      messaggioPortale:        datiPost.messaggioOk || datiPost.messaggioErr || errore || "",
      finalUrl,
      log,
      error: (datiPost.messaggioErr || errore) || null,
    };

  } catch (err) {
    logMsg(`💥 Errore trasmissione: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}

// =============================================================================
// 2. TRASMISSIONE CONSEGUIMENTO CQC
// =============================================================================

/**
 * Trasmette pratica di conseguimento CQC (Carta Qualificazione Conducente).
 * Replica: trasmissione_pratica_conseguimento_cqc
 *
 * URL form: /RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_initActionPatItaCqc.action?mod
 */
async function trasmettiConseguimentoCQC(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const INIZIO_URL = `${PORTAL_BASE}/RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_initActionPatItaCqc.action?mod`;

  let browser = null;
  try {
    logMsg("🔐 Login al portale...");
    const { browser: b, page } = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = b;

    logMsg("📄 Navigazione al form CQC...");
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    logMsg(`🏷️  marcaOperativa: ${marcaPreCompile}`);

    logMsg("✏️  Compilazione modulo CQC...");
    await compilaModulo(page, modulo, "trasmissione_pratica_conseguimento_cqc");

    if (bollettini.length > 0) await compilaBollettini(page, bollettini);

    if (fotoBase64 || firmaBase64) {
      await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/prenotazioneCqc",
        fotoBase64,
        firmaBase64,
      });
    }

    const datiPreSubmit = await estraiDatiForm(page);

    logMsg("🚀 Invio pratica CQC...");
    const submitBtn = await resolveSelector(page, [
      'input[type="submit"]', 'button[type="submit"]',
    ], 5000);
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    }

    const datiPost = await estraiDatiForm(page);
    const errore   = await extractPageMessage(page);
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;

    return {
      success:         !!marcaFinal && !datiPost.messaggioErr,
      marcaOperativa:  marcaFinal,
      idRichiesta:     datiPost.idRichiesta || datiPreSubmit.idRichiesta,
      messaggioPortale: datiPost.messaggioOk || datiPost.messaggioErr || errore || "",
      log,
      error: datiPost.messaggioErr || errore || null,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// =============================================================================
// 2b. RINNOVO CQC (Carta Qualificazione Conducente — rinnovo)
// =============================================================================

/**
 * Trasmette rinnovo CQC (tipoMotivo=R).
 * Replica: trasmissione_pratica_conseguimento_cqc con pageStatus=NEW_CQC + motivo Rinnovo.
 *
 * URL form: /RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_initActionPatItaCqc.action?mod
 * Differenza da conseguimento: imposta il campo tipoMotivoRichiesta a "R" (Rinnovo)
 * prima di compilare il resto del modulo.
 */
async function trasmettiRinnCQC(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    codiceFiscale = "",
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const INIZIO_URL = `${PORTAL_BASE}/RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_initActionPatItaCqc.action?mod`;

  let browser = null;
  try {
    logMsg("🔐 Login al portale...");
    const { browser: b, page } = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = b;

    logMsg("📄 Navigazione al form CQC rinnovo...");
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // Imposta tipo motivo = Rinnovo (R|)
    logMsg("🔄 Selezione tipo motivo: Rinnovo...");
    await fillSelectCascading(
      page,
      "prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.theTipoMotivoRichiestaEP.selectRowId",
      "R|",
      AJAX_WAIT
    ).catch(() => {
      // Fallback: try direct select fill
      return fillField(
        page,
        "prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.theTipoMotivoRichiestaEP.selectRowId",
        "R|"
      );
    });
    await sleep(1000);

    // Ricerca per CF se disponibile
    if (codiceFiscale) {
      logMsg(`🔍 Ricerca CQC per CF: ${codiceFiscale}...`);
      await fillField(
        page,
        "prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.codiceFiscaleRichiedente",
        codiceFiscale
      );
      const searchBtn = await resolveSelector(page, [
        'input[id*="Ricerca"]', 'input[value*="Ricerca"]',
        'button[id*="ricerca"]', 'input[type="submit"]',
      ], 4000);
      if (searchBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
          page.click(searchBtn),
        ]);
        await sleep(2000);
      }
    }

    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    logMsg(`🏷️  marcaOperativa: ${marcaPreCompile || "–"}`);

    logMsg("✏️  Compilazione modulo rinnovo CQC...");
    await compilaModulo(page, modulo, "trasmissione_pratica_conseguimento_cqc");

    if (bollettini.length > 0) await compilaBollettini(page, bollettini);

    if (fotoBase64 || firmaBase64) {
      await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/prenotazioneCqc",
        fotoBase64,
        firmaBase64,
      });
    }

    const datiPreSubmit = await estraiDatiForm(page);

    logMsg("🚀 Invio rinnovo CQC...");
    const submitBtn = await resolveSelector(page, [
      'input[type="submit"]', 'button[type="submit"]',
    ], 5000);
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    }

    const datiPost  = await estraiDatiForm(page);
    const errore    = await extractPageMessage(page);
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;

    logMsg(marcaFinal ? `✅ Rinnovo CQC trasmesso — marca: ${marcaFinal}` : "⚠️ Nessuna marca restituita");

    return {
      success:          !!marcaFinal && !datiPost.messaggioErr,
      marcaOperativa:   marcaFinal,
      idRichiesta:      datiPost.idRichiesta || datiPreSubmit.idRichiesta,
      messaggioPortale: datiPost.messaggioOk || datiPost.messaggioErr || errore || "",
      log,
      error: datiPost.messaggioErr || errore || null,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// =============================================================================
// 3. TRASMISSIONE PRIMA FASE (AM, A1, A2, A)
// =============================================================================

/**
 * Trasmette pratica "prima fase" per categorie a doppia fase (AM, A1, A2, A).
 * Replica: trasmissione_pratica_conseguimento_fase1
 *
 * URL: /RichiestaPatenti/richiestaCertificatoMedico/ReadAcqCertificatoPrimaFase_initAcqCertificatoPrimaFase.action?mod
 */
async function trasmettiPrimaFase(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const INIZIO_URL = `${PORTAL_BASE}/RichiestaPatenti/richiestaCertificatoMedico/ReadAcqCertificatoPrimaFase_initAcqCertificatoPrimaFase.action?mod`;

  let browser = null;
  try {
    logMsg("🔐 Login...");
    const { browser: b, page } = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = b;

    logMsg("📄 Form prima fase...");
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    await compilaModulo(page, modulo, "trasmissione_pratica_conseguimento_fase1");
    if (bollettini.length > 0) await compilaBollettini(page, bollettini);
    if (fotoBase64 || firmaBase64) {
      await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/richiestaCertificatoMedico",
        fotoBase64,
        firmaBase64,
      });
    }

    const datiPreSubmit = await estraiDatiForm(page);
    const submitBtn = await resolveSelector(page, ['input[type="submit"]', 'button[type="submit"]'], 5000);
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    }

    const datiPost = await estraiDatiForm(page);
    const errore   = await extractPageMessage(page);
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;

    return {
      success:         !!marcaFinal && !errore,
      marcaOperativa:  marcaFinal,
      idRichiesta:     datiPost.idRichiesta || datiPreSubmit.idRichiesta,
      messaggioPortale: datiPost.messaggioOk || errore || "",
      log,
      error: errore || null,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// =============================================================================
// 4. VERIFICA RINNOVABILITÀ + TRASMISSIONE RINNOVO
// =============================================================================

/**
 * Verifica se una patente è rinnovabile.
 * Replica: leggiDatiClienteRichiestaEsameNuovoRinnovabilita
 *
 * URL: /RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_initAcqRinnAgenzia.action
 *      ?richiestaView.richiestaRinnAgenziaFrom.codiceMotivo=R
 *      &richiestaView.richiestaRinnAgenziaFrom.patente={PATENTE}
 *      &richiestaView.cognome={COGNOME}
 *      &action:ReadAcqRinnAgenzia_pagingAcqRinnAgenzia=Ver.+Rinnovabilita'
 *
 * @param {object} opts - { credentials, cognome, patente, codiceFiscale }
 * @returns {{ rinnovabile, datiPatente, messaggio }}
 */
async function verificaRinnovabilita(opts = {}) {
  const {
    credentials = {},
    cognome = "",
    patente = "",
    codiceFiscale = "",
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const { makeHttpClient } = require("./portalHttp");
  const { loginDirectHttp } = require("./portalSession");

  try {
    logMsg("🔐 Login HTTP rapido...");
    const jar = await loginDirectHttp({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });

    const client = makeHttpClient(jar);

    // Prima carica il menu per ottenere token
    logMsg("📋 Carico menu RichiestaPatenti...");
    await client.get(`${PORTAL_BASE}/RichiestaPatenti/menu/LoadMenu_execute.action`);

    // Richiesta rinnovabilità
    const ricercaUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_initAcqRinnAgenzia.action` +
      `?struts.token.name=tokenListAcqRinnAgenzia` +
      `&pageStatus=` +
      `&richiestaView.richiestaRinnAgenziaFrom.codiceMotivo=R` +
      `&richiestaView.richiestaRinnAgenziaFrom.patente=${encodeURIComponent(patente)}` +
      `&richiestaView.cognome=${encodeURIComponent(cognome)}` +
      `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=${encodeURIComponent(codiceFiscale)}` +
      `&action:ReadAcqRinnAgenzia_pagingAcqRinnAgenzia=Ver.+Rinnovabilita%27`;

    logMsg(`🔍 Verifica rinnovabilità: ${patente}`);
    const resp = await client.get(ricercaUrl);
    const html = resp.data || "";

    const cheerio = require("cheerio");
    const $ = cheerio.load(html);

    // Analizza la risposta
    const errore    = $(".errorMessage li span, .errori p").first().text().trim();
    const messaggio = $(".messaggio p").first().text().trim();
    const rinnovabile = !errore && (
      messaggio.toLowerCase().includes("rinnovabile") ||
      messaggio.toLowerCase().includes("possibile") ||
      html.includes("codiceMotivo") // c'è un form di rinnovo
    );

    logMsg(`✅ Verifica completata: ${rinnovabile ? "rinnovabile" : "non rinnovabile"}`);

    return {
      rinnovabile,
      messaggio: messaggio || errore || "",
      errore: errore || null,
      log,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { rinnovabile: false, error: err.message, log };
  }
}

/**
 * Trasmette pratica di rinnovo patente.
 * Replica: trasmissione_pratica_rinnovo
 *
 * URL: /RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_initAcqRinnAgenzia.action
 */
async function trasmettiRinnovoPatente(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const INIZIO_URL = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_initAcqRinnAgenzia.action`;

  let browser = null;
  try {
    logMsg("🔐 Login...");
    const { browser: b, page } = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = b;

    logMsg("📄 Form rinnovo patente...");
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    await compilaModulo(page, modulo, "trasmissione_pratica_rinnovo");
    if (bollettini.length > 0) await compilaBollettini(page, bollettini);
    if (fotoBase64 || firmaBase64) {
      await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/richiesta",
        fotoBase64,
        firmaBase64,
      });
    }

    const datiPreSubmit = await estraiDatiForm(page);
    const submitBtn = await resolveSelector(page, ['input[type="submit"]', 'button[type="submit"]'], 5000);
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    }

    const datiPost = await estraiDatiForm(page);
    const errore   = await extractPageMessage(page);
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;

    return {
      success:         !!marcaFinal && !errore,
      marcaOperativa:  marcaFinal,
      idRichiesta:     datiPost.idRichiesta || datiPreSubmit.idRichiesta,
      codiceEstremiPagamento: datiPost.codiceEstremiPagamento || datiPreSubmit.codiceEstremiPagamento,
      messaggioPortale: datiPost.messaggioOk || errore || "",
      log,
      error: errore || null,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

/**
 * Trasmette rinnovo con visita medica (TT2112).
 * Replica: trasmissione_pratica_rinnovo_medico
 *
 * Se marca_operativa_numero != "":
 *   URL: /RichiestaPatenti/richiesta/ReadAcqPratAg_initAcqPratAg.action?f=1
 * Altrimenti:
 *   URL: /RichiestaPatenti/richiesta/ReadAcqRinnMed_initAcqRinnMed.action?f=1
 */
async function trasmettiRinnovoMedico(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    marcaOperativaNumero = "",
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  // Due URL diversi in base a se c'è già una marca operativa
  const INIZIO_URL = marcaOperativaNumero
    ? `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadAcqPratAg_initAcqPratAg.action?f=1`
    : `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadAcqRinnMed_initAcqRinnMed.action?f=1`;

  let browser = null;
  try {
    logMsg("🔐 Login...");
    const { browser: b, page } = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = b;

    logMsg(`📄 Form rinnovo medico (marcaNumero=${marcaOperativaNumero || "nuovo"})...`);
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    await compilaModulo(page, modulo, "trasmissione_pratica_rinnovo_medico");
    if (bollettini.length > 0) await compilaBollettini(page, bollettini);
    if (fotoBase64 || firmaBase64) {
      await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/richiesta",
        fotoBase64,
        firmaBase64,
      });
    }

    const datiPreSubmit = await estraiDatiForm(page);
    const submitBtn = await resolveSelector(page, ['input[type="submit"]', 'button[type="submit"]'], 5000);
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    }

    const datiPost = await estraiDatiForm(page);
    const errore   = await extractPageMessage(page);
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;

    return {
      success:         !!marcaFinal && !errore,
      marcaOperativa:  marcaFinal,
      idRichiesta:     datiPost.idRichiesta || datiPreSubmit.idRichiesta,
      messaggioPortale: datiPost.messaggioOk || errore || "",
      log,
      error: errore || null,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// =============================================================================
// 5. PRATICA "ALTRO" (duplicato, smarrimento, deterioramento)
// =============================================================================

/**
 * Trasmette pratica "Altro" (duplicato/smarrimento/deterioramento).
 * Replica: trasmissione_pratica_altro
 *
 * URL: /RichiestaPatenti/prenotazionePatente/Read_initAction.action?pageStatus=NEW
 */
async function trasmettiPraticaAltro(opts = {}) {
  const {
    credentials = {},
    modulo = {},
    bollettini = [],
    fotoBase64,
    firmaBase64,
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (msg) => { log.push(msg); onProgress(msg); };

  const INIZIO_URL = `${PORTAL_BASE}/RichiestaPatenti/prenotazionePatente/Read_initAction.action?pageStatus=NEW`;

  let browser = null;
  try {
    logMsg("🔐 Login...");
    const { browser: b, page } = await openBrowserAndLogin({
      username: credentials.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: credentials.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      credentials.pin      || process.env.PORTAL_PIN,
    });
    browser = b;

    logMsg("📄 Form pratica altro...");
    await page.goto(INIZIO_URL, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const marcaPreCompile = await extractFormValue(page, "marcaOperativa");
    await compilaModulo(page, modulo, "trasmissione_pratica_altro");
    if (bollettini.length > 0) await compilaBollettini(page, bollettini);
    if (fotoBase64 || firmaBase64) {
      await uploadFotoFirma(page, {
        baseUploadPath: "/RichiestaPatenti/prenotazionePatente",
        fotoBase64,
        firmaBase64,
      });
    }

    const datiPreSubmit = await estraiDatiForm(page);
    const submitBtn = await resolveSelector(page, ['input[type="submit"]', 'button[type="submit"]'], 5000);
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click(submitBtn),
      ]);
      await sleep(2000);
    }

    const datiPost = await estraiDatiForm(page);
    const errore   = await extractPageMessage(page);
    const marcaFinal = datiPost.marcaOperativa || datiPreSubmit.marcaOperativa || marcaPreCompile;

    return {
      success:         !!marcaFinal && !errore,
      marcaOperativa:  marcaFinal,
      idRichiesta:     datiPost.idRichiesta || datiPreSubmit.idRichiesta,
      messaggioPortale: datiPost.messaggioOk || errore || "",
      log,
      error: errore || null,
    };
  } catch (err) {
    logMsg(`💥 Errore: ${err.message}`);
    return { success: false, error: err.message, log };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// =============================================================================
// HELPER: costruisce modulo da dati candidato Supabase
// =============================================================================

/**
 * Mappa i dati di un candidato (dal nostro DB) nei campi del form portale.
 * Replica la struttura portale.data.modulo di iPatente.
 *
 * @param {object} candidato - record da Supabase candidati
 * @param {object} extra     - dati aggiuntivi (medico, bollettini, etc.)
 * @returns {object} modulo - dict campo_struts2 → valore
 */
function buildModuloFromCandidato(candidato, extra = {}) {
  const c = candidato || {};
  const e = extra || {};

  const modulo = {};

  // Anagrafica personale
  if (c.cognome)       modulo["richiestaPerEsameView.cognome"] = c.cognome;
  if (c.nome)          modulo["richiestaPerEsameView.nome"]    = c.nome;
  if (c.sesso)         modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.sesso"] = c.sesso;

  // Data nascita GG/MM/YYYY
  if (c.data_nascita) {
    const dn = c.data_nascita;
    // Supporta YYYY-MM-DD o GG/MM/YYYY
    const m = dn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    modulo["richiestaPerEsameView.dataNascita"] = m ? `${m[3]}/${m[2]}/${m[1]}` : dn;
  }

  // Codice fiscale
  if (c.codice_fiscale)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.codiceFiscale"] = c.codice_fiscale;

  // Nazione nascita (ITA| per Italia)
  modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.theStatoEstero.selectRowId"] =
    c.nazione_nascita_codice || (c.nazione_nascita === "ITA" ? "ITA|" : (e.nazioneNascitaCodice || "ITA|"));

  // Provincia e comune nascita (cascading: prima provincia poi comune)
  if (c.provincia_nascita_codice || c.provincia_nascita)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.selectRowId"] =
      c.provincia_nascita_codice || `${c.provincia_nascita}|`;

  if (c.comune_nascita_codice || e.comuneNascitaCodice)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.theComuneNascita.selectRowId"] =
      c.comune_nascita_codice || e.comuneNascitaCodice;

  if (c.nazione_nascita === "EXT" || c.comune_nascita_estero)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.localitaNascitaEstera"] = c.comune_nascita_estero || c.comune_nascita;

  // Residenza
  if (c.provincia_residenza_codice || c.provincia_residenza)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.theComune.theProvincia.selectRowId"] =
      c.provincia_residenza_codice || `${c.provincia_residenza}|`;

  if (c.comune_residenza_codice || e.comuneResidenzaCodice)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.theComune.selectRowId"] =
      c.comune_residenza_codice || e.comuneResidenzaCodice;

  if (c.cap)       modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.cap"] = c.cap;
  if (c.toponimo || c.toponimo_residenza)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.toponimo"] = c.toponimo || c.toponimo_residenza;
  if (c.indirizzo) modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.indirizzo"]    = c.indirizzo;
  if (c.civico || c.numero_civico)
    modulo["richiestaPerEsameView.richiestaFrom.theAnagrafica.numeroCivico"] = c.civico || c.numero_civico;

  // Dati medico
  if (e.medico_id_protocollo)
    modulo["richiestaPerEsameView.richiestaFrom.protocolloCertificatoMedico"] = e.medico_id_protocollo;
  if (e.medico_data_visita)
    modulo["richiestaPerEsameView.richiestaFrom.dataVisitaMedicaString"] = e.medico_data_visita;
  if (e.medico_iscrizione_albo)
    modulo["richiestaPerEsameView.richiestaFrom.codiceIscrizioneAlbo"] = e.medico_iscrizione_albo;
  if (e.medico_uff_sanitario)
    modulo["richiestaPerEsameView.richiestaFrom.codiceTipoUfficialeSanitario"] = e.medico_uff_sanitario;

  // Validità patente
  if (e.anni_validita)  modulo["richiestaPerEsameView.richiestaFrom.anniValiditaString"]  = e.anni_validita;
  if (e.mesi_validita)  modulo["richiestaPerEsameView.richiestaFrom.mesiValiditaString"]  = e.mesi_validita;

  // CIA
  if (e.codice_cia)         modulo["richiestaPerEsameView.richiestaFrom.codiceIdentificativoCia"]   = e.codice_cia;
  if (e.ufficio_cia)        modulo["richiestaPerEsameView.richiestaFrom.codUfficioProvincialeCia"] = e.ufficio_cia;

  // Prescrizioni tecniche
  for (let i = 1; i <= 7; i++) {
    const pres = e[`prescrizione${i}`] || (e.prescrizioni && e.prescrizioni[i-1]);
    if (pres)
      modulo[`richiestaPerEsameView.prescrizione${i}.selectRowIdRead`] = pres;
  }

  // Categorie abilitate (data abilitazione per categoria)
  if (e.abilitazioni && typeof e.abilitazioni === "object") {
    for (const [cat, dataAb] of Object.entries(e.abilitazioni)) {
      if (dataAb) modulo[`elencoAbilitazioni.abil${cat}.dataAbilitazione`] = dataAb;
    }
  }

  // Merge con modulo extra esplicito (sovrascrive le mappature automatiche)
  if (e.modulo_extra && typeof e.modulo_extra === "object") {
    Object.assign(modulo, e.modulo_extra);
  }

  return modulo;
}

// =============================================================================
// TRASMISSIONE ESERCITAZIONI DI GUIDA
// =============================================================================

/**
 * Mappa durata in minuti al valore selectRowJS del portale.
 * iPatente: ≤30→A|30, >30≤60→B|60, >60≤90→C|90, >90→D|120
 */
function durataToSelectValue(min) {
  const m = parseInt(min, 10) || 0;
  if (m <= 30)  return "A|30";
  if (m <= 60)  return "B|60";
  if (m <= 90)  return "C|90";
  return "D|120";
}

/**
 * trasmettiGuide
 * ==============
 * Trasmette esercitazioni di guida sul portale (sezione "Esercitazioni Guida").
 * Replica: trasmettiGuideRicerca + trasmettiGuide di portale_do.js.
 *
 * @param {object} opts
 *   credentials   - { username, password, pin }
 *   pratica        - pratica_patente record (con candidato join)
 *   candidato      - record candidates
 *   guide          - array di guide: [{ modulo:"A", targa, istruttore_nome, istruttore_cognome, data, ora, durata_minuti, n_iscrizione }]
 *   onProgress     - callback(msg)
 *
 * @returns { success, log, error, haStampaAttestato }
 */
async function trasmettiGuide(opts = {}) {
  const {
    credentials = {},
    pratica = {},
    candidato = {},
    guide = [],
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (m) => { log.push(m); onProgress(m); };

  const BASE_GUIDE = `${PORTAL_BASE}/RichiestaPatenti/richiestaEsame`;
  const URL_INIZIO  = `${BASE_GUIDE}/Read_initEsercitazioniGuida.action`;
  const URL_PAGING  = `${BASE_GUIDE}/SearchEsGuida_pagingEsercitazioniGuida.action`;

  if (!guide || guide.length === 0) {
    return { success: false, error: "Nessuna guida da trasmettere", log };
  }

  const marcaOperativa = pratica.marca_operativa || "";
  const cognome        = candidato.cognome || "";

  if (!marcaOperativa) {
    return { success: false, error: "marcaOperativa mancante nella pratica", log };
  }

  let browser, page;
  try {
    logMsg("🔓 Login al portale...");
    ({ browser, page } = await openBrowserAndLogin(credentials));

    // STEP 1 — Naviga alla pagina ricerca guide
    logMsg("📋 Apertura sezione Esercitazioni Guida...");
    await page.goto(URL_INIZIO, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // STEP 2 — Compila ricerca (cognome + marcaOperativa) e cerca
    logMsg(`🔍 Ricerca pratica: cognome="${cognome}" marcaOperativa="${marcaOperativa}"`);

    const cognomeSel = '#Read_initEsercitazioniGuida_richiestaPerEsameView_cognome';
    const marcaSel   = '#Read_initEsercitazioniGuida_richiestaPerEsameView_richiestaFrom_marcaOperativa';
    const searchBtn  = '#Read_initEsercitazioniGuida_button_value_searchElement';

    await page.waitForSelector(cognomeSel, { timeout: 15000 }).catch(() => null);
    await page.$eval(cognomeSel, (el, v) => { el.value = v; }, cognome);
    await page.$eval(marcaSel,   (el, v) => { el.value = v; }, marcaOperativa);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
      page.click(searchBtn),
    ]);
    await sleep(2000);

    // STEP 3 — Clicca "Nuovo" per aggiungere esercitazioni
    const nuovoBtns = [
      '#CreateEsGuida_saveNewEsercitazioneGuida_button_value_newEsame',
      '#SearchEsGuida_pagingEsercitazioniGuida_button_value_newEsame',
      'input[name*="newEsame"]',
    ];
    let nuovoClicked = false;
    for (const sel of nuovoBtns) {
      const btn = await page.$(sel);
      if (btn) {
        logMsg("➕ Click su Nuovo esercitazione...");
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
          page.click(sel),
        ]);
        nuovoClicked = true;
        break;
      }
    }

    if (!nuovoClicked) {
      // Verifica se è già presente il form di inserimento
      const formEl = await page.$("[name*='esercitazioneGuidaA1.codiceTargaVeicolo']");
      if (!formEl) {
        return { success: false, error: "Impossibile trovare il form di inserimento guide", log };
      }
      logMsg("📝 Form di inserimento già visibile");
    }

    await sleep(2000);
    logMsg(`✏️  Compilazione ${guide.length} esercitazione/i...`);

    // STEP 4 — Per ogni guida: seleziona modulo, trova slot libero, compila
    // Traccia quante guide sono state inserite per modulo (per trovare lo slot)
    const insertedByMod = { A: 0, B: 0, C: 0 };

    for (const [gi, guida] of guide.entries()) {
      const modchar = (guida.modulo || "A").toUpperCase().replace("MOD.", "").trim();
      logMsg(`  Guida ${gi + 1}: modulo=${modchar} targa=${guida.targa} data=${guida.data}`);

      // Toggle visibilità modulo via JS
      const toggleArgs = {
        A: "toggle_visibility('moduloA','moduloB','moduloC')",
        B: "toggle_visibility('moduloB','moduloA','moduloC')",
        C: "toggle_visibility('moduloC','moduloA','moduloB')",
      };
      if (toggleArgs[modchar]) {
        await page.evaluate((script) => eval(script), toggleArgs[modchar]).catch(() => null);
        await sleep(500);
      }

      // Trova slot libero (1-4): primo con targa vuota
      let slotIndex = 1;
      for (let s = 4; s >= 1; s--) {
        const tarSel = `[name='richiestaPerEsameView.esercitazioneGuida${modchar}${s}.codiceTargaVeicolo']`;
        const val = await page.$eval(tarSel, (el) => el.value || "").catch(() => null);
        if (val === "" || val === null) {
          slotIndex = s;
        }
      }
      // Applica offset per guide già inserite in questo batch
      slotIndex = Math.min(slotIndex + insertedByMod[modchar], 4);
      insertedByMod[modchar]++;

      // Helper campi guida
      const baseField = `richiestaPerEsameView.esercitazioneGuida${modchar}${slotIndex}`;

      const guideFields = [
        { name: `${baseField}.codiceTargaVeicolo`,                              value: guida.targa || "" },
        { name: `${baseField}.descrizioneNomeIstruttoreEsercitazioneGuida`,     value: guida.istruttore_nome || "" },
        { name: `${baseField}.descrizioneCognomeIstruttoreEsercitazioneGuida`,  value: guida.istruttore_cognome || "" },
        { name: `${baseField}.dataEsercitazioneGuida`,                          value: guida.data || "" },
        { name: `${baseField}.oraInizioEsercitazioneGuida`,                     value: guida.ora || "" },
      ];

      for (const { name, value } of guideFields) {
        await page.evaluate((n, v) => {
          const el = document.querySelector(`[name='${n}']`);
          if (el) { el.value = v; el.dispatchEvent(new Event("change")); }
        }, name, value).catch(() => null);
      }

      // Durata — select con change event
      const durataValue = durataToSelectValue(guida.durata_minuti);
      await page.evaluate((n, v) => {
        const el = document.querySelector(`[name='${n}']`);
        if (el) { el.value = v; el.dispatchEvent(new Event("change")); }
      }, `${baseField}.theTipoDurataEsercitazioneGuida.selectRowJS`, durataValue).catch(() => null);

      await sleep(300);
    }

    // Numero iscrizione registro (common per tutte le guide del form)
    if (guide[0]?.n_iscrizione) {
      await page.evaluate((v) => {
        const el = document.querySelector("[name='richiestaPerEsameView.richiestaFrom.numeroIscrizioneRegistoEsercitazioniGuida']");
        if (el) { el.value = v; el.dispatchEvent(new Event("change")); }
      }, guide[0].n_iscrizione).catch(() => null);
    }

    await sleep(1000);
    logMsg("💾 Guide compilate. Controllare e cliccare CONFERMA sul portale.");

    // STEP 5 — Verifica se "stampaAttestato" è già presente (guide già complete)
    const stampaBtn = await page.$(
      '#SearchEsGuida_pagingEsercitazioniGuida_button_value_stampaAttestato, ' +
      '#CreateEsGuida_saveNewEsercitazioneGuida_button_value_stampaAttestato'
    );
    const haStampaAttestato = !!stampaBtn;

    if (haStampaAttestato) {
      logMsg("🖨️  Tasto Stampa Attestato disponibile — guide trasmesse con successo!");
    }

    await browser.close().catch(() => null);

    return {
      success: true,
      haStampaAttestato,
      log,
    };
  } catch (err) {
    logMsg(`❌ Errore: ${err.message}`);
    if (browser) await browser.close().catch(() => null);
    return { success: false, error: err.message, log };
  }
}

/**
 * stampAttestatoGuide
 * ===================
 * Naviga alla pagina delle guide e clicca "Stampa Attestato".
 * Replica portale_do.js trasmettiGuideStampaAttestato.
 */
async function stampaAttestatoGuide(opts = {}) {
  const {
    credentials = {},
    pratica = {},
    candidato = {},
    onProgress = () => {},
  } = opts;

  const log = [];
  const logMsg = (m) => { log.push(m); onProgress(m); };

  const BASE_GUIDE = `${PORTAL_BASE}/RichiestaPatenti/richiestaEsame`;
  const URL_INIZIO  = `${BASE_GUIDE}/Read_initEsercitazioniGuida.action`;

  const marcaOperativa = pratica.marca_operativa || "";
  const cognome        = candidato.cognome || "";

  let browser, page;
  try {
    logMsg("🔓 Login al portale...");
    ({ browser, page } = await openBrowserAndLogin(credentials));

    logMsg("📋 Apertura sezione Esercitazioni Guida...");
    await page.goto(URL_INIZIO, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // Ricerca
    logMsg("🔍 Ricerca pratica...");
    await page.$eval(
      '#Read_initEsercitazioniGuida_richiestaPerEsameView_cognome',
      (el, v) => { el.value = v; }, cognome
    ).catch(() => null);
    await page.$eval(
      '#Read_initEsercitazioniGuida_richiestaPerEsameView_richiestaFrom_marcaOperativa',
      (el, v) => { el.value = v; }, marcaOperativa
    ).catch(() => null);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
      page.click('#Read_initEsercitazioniGuida_button_value_searchElement'),
    ]);
    await sleep(2000);

    // Clicca Stampa Attestato
    const stampaBtns = [
      '#SearchEsGuida_pagingEsercitazioniGuida_button_value_stampaAttestato',
      '#CreateEsGuida_saveNewEsercitazioneGuida_button_value_stampaAttestato',
      'input[name*="stampaAttestato"]',
    ];

    let printed = false;
    for (const sel of stampaBtns) {
      const btn = await page.$(sel);
      if (btn) {
        logMsg("🖨️  Click su Stampa Attestato...");
        await page.click(sel).catch(() => null);
        await sleep(3000);
        printed = true;
        break;
      }
    }

    if (!printed) {
      return { success: false, error: "Pulsante Stampa Attestato non trovato", log };
    }

    await browser.close().catch(() => null);
    return { success: true, log };
  } catch (err) {
    logMsg(`❌ Errore stampa attestato: ${err.message}`);
    if (browser) await browser.close().catch(() => null);
    return { success: false, error: err.message, log };
  }
}

// =============================================================================
// =============================================================================
// PUNTO 2 — SESSIONI ESAME PROGRAMMATO (SGOS/SQI)
// =============================================================================

const SGOS_BASE = `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP`;

/**
 * Cerca sessioni di esame disponibili sul portale.
 * Replica: portale.func == "prenotazione_esame_programmato"
 *
 * @param {object} credentials — { username, password, pin? }
 * @param {object} opts — { data_da, data_a, tipo_sessione? }
 *   data_da / data_a: YYYY-MM-DD  o DD/MM/YYYY
 *   tipo_sessione: "SQI" (quiz, default) | "SGOS" (guida)
 * @returns {{ success: boolean, sessioni: Array, error?: string }}
 */
async function cercaSessioniEsame(credentials, opts = {}) {
  const log = [];
  const logMsg = (m) => { log.push(m); opts.onProgress?.({ message: m }); };
  let browser;

  function isoToIt(s) {
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split("-");
      return `${d}/${m}/${y}`;
    }
    return s;
  }

  try {
    logMsg("🔑 Login portale per ricerca sessioni…");
    ({ browser } = await openBrowserAndLogin(credentials));
    const page = (await browser.pages())[0] || await browser.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);

    const searchUrl = `${SGOS_BASE}/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH`;
    logMsg(`📋 Navigazione: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await sleep(AJAX_WAIT);

    const data_da = isoToIt(opts.data_da || new Date().toISOString().slice(0, 10));
    const data_a  = isoToIt(opts.data_a  || data_da);

    logMsg(`📅 Impostazione date: ${data_da} – ${data_a}`);

    // Stato = A (aperte)
    await page.evaluate(() => {
      const sel = document.querySelector(
        "#RicercaDisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_disponibilitaSessioneEsameEPFrom_theStatoDisponibilitaSessioneEsameEP_selectRowId"
      );
      if (sel) { sel.value = "A|"; sel.dispatchEvent(new Event("change")); }
    });

    // Datepicker date
    await page.evaluate((d1, d2) => {
      const dp1 = document.getElementById("datepicker1");
      const dp2 = document.getElementById("datepicker2");
      if (dp1) dp1.value = d1;
      if (dp2) dp2.value = d2;
      // Set hidden fields if exist
      const hdFields = document.querySelectorAll('input[name*="dataDisponibilt"]');
      hdFields.forEach((hf, i) => { hf.value = i === 0 ? d1 : d2; });
    }, data_da, data_a);

    await sleep(500);

    // Click search button
    const searchBtn = await page.$(
      "#RicercaDisponibilitaSessioneEsameEP_button_value_searchElement"
    ).catch(() => null) ||
      await page.$('input[name*="searchElement"]').catch(() => null) ||
      await page.$('button[name*="searchElement"]').catch(() => null);

    if (!searchBtn) throw new Error("Pulsante Ricerca non trovato sulla pagina");
    await searchBtn.click();
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null);
    await sleep(AJAX_WAIT);

    logMsg("📊 Parsing sessioni disponibili…");

    const sessioni = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#listTable > tbody > tr"));
      return rows.map((tr) => {
        const tds   = tr.querySelectorAll("td");
        const input = tr.querySelector("input[type='hidden'], input[type='radio']");
        return {
          id_verbale:   input?.value || "",
          data_sessione: (tds[3]?.innerText || "").trim(),
          data_limite:   (tds[4]?.innerText || "").trim(),
          desc_esame:    (tds[5]?.innerText || "").trim(),
          fascia_oraria: (tds[6]?.innerText || "").trim(),
          localita:      (tds[8]?.innerText || "").trim(),
          aula:          (tds[9]?.innerText || "").trim(),
          turni:         (tds[10]?.innerText || "").trim(),
          esaminatori:   (tds[11]?.innerText || "").trim(),
          cand_possibili: (tds[12]?.innerText || "").trim(),
          cand_prenotati: (tds[13]?.innerText || "").trim(),
          cand_poss_aut:  (tds[14]?.innerText || "").trim(),
          cand_pren_aut:  (tds[15]?.innerText || "").trim(),
          loc_descrizione:(tds[16]?.innerText || "").trim(),
          stato_verbale:  (tds[17]?.innerText || "").trim(),
        };
      }).filter((s) => s.id_verbale);
    });

    logMsg(`✅ Trovate ${sessioni.length} sessioni disponibili`);

    await browser.close().catch(() => null);
    return { success: true, sessioni, log };
  } catch (err) {
    logMsg(`❌ Errore: ${err.message}`);
    if (browser) await browser.close().catch(() => null);
    return { success: false, sessioni: [], error: err.message, log };
  }
}

/**
 * Prenota un candidato in una sessione d'esame sul portale.
 * Replica: portale.func == "prenotazione_esame_programmato" → inserimento
 *
 * @param {object} credentials
 * @param {object} opts — {
 *   id_verbale,          // ID sessione (selectRowId)
 *   tipo_sessione,       // "SQI" | "SGOS"
 *   cod_foglio_rosa,     // codice foglio rosa candidato
 *   cognome,             // cognome candidato
 *   lingua,              // codice lingua (default "I")
 *   audio,               // "S" | "N" (default "N")
 *   turno,               // numero turno (default 1)
 *   aula,                // progressivo aula (default 1, SQI only)
 * }
 */
async function prenotaCandidatoEsame(credentials, opts = {}) {
  const log = [];
  const logMsg = (m) => { log.push(m); opts.onProgress?.({ message: m }); };
  let browser;

  const {
    id_verbale,
    tipo_sessione = "SQI",
    cod_foglio_rosa = "",
    cognome = "",
    lingua  = "I",
    audio   = "N",
    turno   = "1",
    aula    = "1",
  } = opts;

  if (!id_verbale) return { success: false, error: "id_verbale obbligatorio", log };
  if (!cod_foglio_rosa && tipo_sessione === "SQI") return { success: false, error: "cod_foglio_rosa obbligatorio per SQI", log };

  try {
    logMsg(`🔑 Login portale per prenotazione ${tipo_sessione}…`);
    ({ browser } = await openBrowserAndLogin(credentials));
    const page = (await browser.pages())[0] || await browser.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);

    if (tipo_sessione === "SQI") {
      // Prenotazione quiz: un'unica navigazione conferma la prenotazione
      const params = new URLSearchParams({
        "pageStatus": "New",
        "disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId":           id_verbale,
        "disponibilitaSessioneEsameEPView.indicatoreTipoSessione":                                  "SQI",
        "disponibilitaSessioneEsameEPView.visualizzaCaptcha":                                        "false",
        "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosa": cod_foglio_rosa,
        "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.thePersonaFisica.descrizioneCognomePersonaFisica": cognome,
        "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceLinguaPrenotazioneCandidato": lingua,
        "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.supportoAudio":                     audio,
        "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore":                  String(turno),
        "disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.theAulaEP.progressivoAula": String(aula),
        "action:CreateSIP_saveNewElementCandidato": "Conferma",
      });

      const bookUrl = `${SGOS_BASE}/Select_listCandidati.action?${params.toString()}`;
      logMsg(`📝 Prenotazione SQI → ${bookUrl.substring(0, 120)}…`);
      await page.goto(bookUrl, { waitUntil: "domcontentloaded" });
      await sleep(AJAX_WAIT);

      // Controlla errori
      const errMsg = await page.evaluate(() => {
        const err = document.querySelector(".messaggio p, .errorMessage, .actionError");
        return err?.innerText?.trim() || "";
      });
      if (errMsg) throw new Error(errMsg);

      // Verifica successo (tornato sulla lista candidati)
      const pageTitle = await page.evaluate(() => document.title || "");
      logMsg(`✅ Prenotazione SQI completata. Pagina: ${pageTitle}`);

    } else if (tipo_sessione === "SGOS") {
      // Prenotazione guida: step 1 → apri form nuovo candidato
      const step1Params = new URLSearchParams({
        "pageStatus": "READ",
        "disponibilitaSessioneEsameEPView.indicatoreTipoSessione":                   "SGOS",
        "disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId": id_verbale,
        "disponibilitaSessioneEsameEPView.prenotazioneSessioneEsameEP.selectRowId":   id_verbale,
        "action:SelectCandidato_viewNewCandidato": "Nuovo Candidato",
      });

      const step1Url = `${SGOS_BASE}/Read_undoListCandidati.action?${step1Params.toString()}`;
      logMsg(`📝 SGOS step 1 → ${step1Url.substring(0, 120)}…`);
      await page.goto(step1Url, { waitUntil: "domcontentloaded" });
      await sleep(AJAX_WAIT);

      // Controlla se siamo sul form di inserimento candidato
      const hasForm = await page.evaluate(() =>
        !!document.querySelector('input[name*="codiceFoglioRosa"], input[name*="codiceFoglio"]')
      );

      if (hasForm) {
        logMsg("📋 Form nuovo candidato trovato, compilazione…");

        // Compila foglio rosa
        await page.evaluate((cfr) => {
          const fr = document.querySelector('input[name*="codiceFoglioRosa"]');
          if (fr) { fr.value = cfr; fr.dispatchEvent(new Event("change")); }
        }, cod_foglio_rosa);

        await sleep(500);

        // Compila cognome se presente
        await page.evaluate((cog) => {
          const cEl = document.querySelector('input[name*="cognome"], input[name*="Cognome"]');
          if (cEl) { cEl.value = cog; }
        }, cognome);

        // Lingua
        await page.evaluate((lng) => {
          const lngEl = document.querySelector('select[name*="codiceLingua"]');
          if (lngEl) { lngEl.value = lng; lngEl.dispatchEvent(new Event("change")); }
        }, lingua);

        // Audio
        await page.evaluate((aud) => {
          const audEl = document.querySelector('select[name*="supportoAudio"]');
          if (audEl) { audEl.value = aud; }
        }, audio);

        await sleep(500);

        // Submit conferma
        const confBtn = await page.$('input[name*="Conferma"], button[name*="Conferma"], input[value="Conferma"]');
        if (!confBtn) throw new Error("Pulsante Conferma non trovato nel form SGOS");
        await confBtn.click();
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null);
        await sleep(AJAX_WAIT);
      }

      // Controlla errori
      const errMsg = await page.evaluate(() => {
        const err = document.querySelector(".messaggio p, .errorMessage, .actionError");
        return err?.innerText?.trim() || "";
      });
      if (errMsg) throw new Error(errMsg);

      logMsg("✅ Prenotazione SGOS completata");
    } else {
      throw new Error(`Tipo sessione non supportato: ${tipo_sessione}`);
    }

    await browser.close().catch(() => null);
    return { success: true, log };
  } catch (err) {
    logMsg(`❌ Errore prenotazione: ${err.message}`);
    if (browser) await browser.close().catch(() => null);
    return { success: false, error: err.message, log };
  }
}

// EXPORTS
// =============================================================================

module.exports = {
  trasmettiConseguimentoPatente,
  trasmettiConseguimentoCQC,
  trasmettiRinnCQC,
  trasmettiPrimaFase,
  trasmettiRinnovoPatente,
  trasmettiRinnovoMedico,
  trasmettiPraticaAltro,
  verificaRinnovabilita,
  buildModuloFromCandidato,
  trasmettiGuide,
  stampaAttestatoGuide,
  cercaSessioniEsame,
  prenotaCandidatoEsame,
};
