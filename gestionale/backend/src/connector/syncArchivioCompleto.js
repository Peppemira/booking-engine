/**
 * SYNC ARCHIVIO COMPLETO — Replica iPatente
 * ============================================================
 * Scarica TUTTI i candidati dell'autoscuola dal portale
 * (inclusi storici/sospesi) e li inserisce/aggiorna su Supabase.
 *
 * Architettura (replica leggiSituazioneCandidati di iPatente):
 *   1. Chiama Read_initActionSituazioneCandidati.action per
 *      combinazioni (P/T, Q/T, P/G) → ottiene lista verbali
 *   2. Per ogni verbale → POST ReadSituazioneCandidati_searchSituazioneCandidati
 *      → ottiene lista candidati nella seduta
 *   3. Per ogni candidato → GET Read_initAction.action con marcaOperativa
 *      + indicatoreRicercaEstesa=S → scheda individuale con CF, dati
 *      anagrafici, picBase64 (foto), picFirmaBase64 (firma)
 *   4. Upsert su Supabase via upsertCandidateToDB()
 *
 * Env utili:
 *   PORTAL_USER / PORTAL_PASS / PORTAL_PIN
 *   CODICE_AUTOSCUOLA (o idAutAg)
 *   PORTAL_UFFICIO_MCTC (o codUfficioMctc)
 *   SYNC_MAX_CONCURRENCY   Parallelismo richieste dettaglio (default 3)
 *   SYNC_DETAIL_DELAY_MS   Ritardo ms tra batch dettaglio (default 200)
 */

require("dotenv").config({ quiet: true });

const cheerio = require("cheerio");
const { loginDirectHttp } = require("./portalSession");
const { makeHttpClient, serializePayloadRaw } = require("./portalHttp");
const { upsertCandidateToDB } = require("./importByPatente");
const supabase = require("../database/supabase");

const BASE_URL = "https://www.ilportaledellautomobilista.it";

const SYNC_MAX_CONCURRENCY = Number(process.env.SYNC_MAX_CONCURRENCY || 3);
const SYNC_DETAIL_DELAY_MS = Number(process.env.SYNC_DETAIL_DELAY_MS || 200);

// ---------------------------------------------------------------------------
// UTILITÀ
// ---------------------------------------------------------------------------

function norm(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Esegue fn su ogni elemento di arr, al massimo maxConcurrency alla volta.
 */
async function mapConcurrent(arr, fn, maxConcurrency = 3) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < arr.length) {
      const i = idx++;
      results[i] = await fn(arr[i], i).catch((e) => ({ _error: e.message }));
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, arr.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// HELPER — init + POST del form (pattern del gestionale IO PATENTE)
// ---------------------------------------------------------------------------
// Da agosto 2026 il Portale ignora i parametri e le azioni Struts passati in
// query string su una GET: la maschera torna vuota e il parser conta zero.
// Il flusso che il Portale accetta (collaudato ogni giorno dal gestionale) è:
// GET della pagina init → catena dispatcher SSO → POST del form VERO, coi
// token nascosti letti dal DOM e i criteri scritti sopra i campi del form.

/** Segue l'auto-submit del dispatcher SSO e l'eventuale pagina PIN. */
async function seguiDispatcherEPin(client, html, refererUrl, pin = null) {
  for (let i = 0; i < 6; i++) {
    if (typeof html !== "string") break;
    const low = html.toLowerCase();
    const $ = cheerio.load(html || "");

    if (low.includes("sso - pin validation") || low.includes("loginview.pin")) {
      const pinValue = pin || process.env.PORTAL_PIN || "";
      if (!pinValue) break;
      const form = $("form#LoginForm, form[name='LoginForm']").first().length
        ? $("form#LoginForm, form[name='LoginForm']").first() : $("form").first();
      if (!form.length) break;
      const action = form.attr("action");
      const resolved = action ? (action.startsWith("http") ? action : BASE_URL + action) : refererUrl;
      const data = new URLSearchParams();
      form.find("input[type='hidden']").each((_, inp) => {
        const n = $(inp).attr("name");
        if (n) data.append(n, $(inp).attr("value") || "");
      });
      data.set("loginView.pin", pinValue);
      data.set("action:Pin_executePinValidation", "Conferma");
      html = (await client.post(resolved, serializePayloadRaw(data), {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: refererUrl },
      })).data;
      continue;
    }

    if (low.includes("dispatcherentry_executedispatch")) {
      const form = $("form[name='postform'], form[name='postForm']").first().length
        ? $("form[name='postform'], form[name='postForm']").first() : $("form").first();
      if (!form.length) break;
      const action = form.attr("action");
      const resolved = action ? (action.startsWith("http") ? action : BASE_URL + action) : refererUrl;
      const data = new URLSearchParams();
      form.find("input").each((_, inp) => {
        const n = $(inp).attr("name");
        const t = String($(inp).attr("type") || "").toLowerCase();
        if (!n || t === "submit" || t === "button" || t === "image") return;
        data.append(n, $(inp).attr("value") || "");
      });
      html = (await client.post(resolved, serializePayloadRaw(data), {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: refererUrl },
      })).data;
      continue;
    }

    break;
  }
  return html;
}

/**
 * Raccoglie TUTTI i campi di un form come farebbe il browser: hidden e testo
 * col loro value, tendine con l'option scelta, caselle/radio solo se spuntate,
 * nomi ripetuti conservati (Struts ne è pieno). I pulsanti restano fuori.
 */
function costruisciPayloadDaForm($, form) {
  const payload = new URLSearchParams();
  form.find("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name) return;
    const tag = String(el.tagName || el.name || "").toLowerCase();
    if (tag === "select") {
      const $opt = $el.find("option[selected]").first().length
        ? $el.find("option[selected]").first() : $el.find("option").first();
      payload.append(name, $opt.attr("value") ?? $opt.text() ?? "");
      return;
    }
    if (tag === "textarea") { payload.append(name, $el.text() || ""); return; }
    const type = String($el.attr("type") || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "image" || type === "file") return;
    if (type === "checkbox" || type === "radio") {
      if ($el.attr("checked") !== undefined) payload.append(name, $el.attr("value") || "on");
      return;
    }
    payload.append(name, $el.attr("value") || "");
  });
  return payload;
}

/** Scrive `value` su ogni campo del payload il cui nome contiene il frammento (case-insensitive). */
function scriviPerFrammento(payload, frammento, value, escludi = null) {
  const f = frammento.toLowerCase();
  let scritti = 0;
  for (const key of Array.from(new Set(payload.keys()))) {
    const low = key.toLowerCase();
    if (!low.includes(f)) continue;
    if (escludi && low.includes(escludi.toLowerCase())) continue;
    payload.set(key, value);
    scritti++;
  }
  return scritti;
}

/** Rimuove tutte le azioni Struts (`action:*`) presenti nel payload. */
function rimuoviAzioni(payload) {
  for (const key of Array.from(new Set(payload.keys()))) {
    if (key.startsWith("action:")) payload.delete(key);
  }
}

/** Risolve l'action di un form rispetto alla base del Portale. */
function risolviActionForm(form, fallbackUrl) {
  const action = form.attr("action");
  if (!action) return fallbackUrl;
  return action.startsWith("http") ? action : BASE_URL + action;
}

// ---------------------------------------------------------------------------
// STEP 1 — Lista verbali (sessions) da SituazioneCandidati
// ---------------------------------------------------------------------------

/** Data in formato Portale gg/mm/aaaa. */
function fmtDataPortale(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Titolo pagina, per log senza dati personali. */
function titoloPagina(html) {
  return (((html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    .replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Sceglie il form di ricerca come il gestionale: non il postform del
 * dispatcher né i form SSO, ma quello con PIÙ campi.
 */
function trovaFormRicerca($) {
  let migliore = null, campiMax = -1;
  $("form").each((_, f) => {
    const $f = $(f);
    const action = String($f.attr("action") || "").toLowerCase();
    if (action.includes("dispatcherentry") || action.includes("/sso/")) return;
    const campi = $f.find("input, select, textarea").length;
    if (campi > campiMax) { campiMax = campi; migliore = $f; }
  });
  return migliore;
}

/**
 * Sceglie l'option giusta di ogni select del form LEGGENDO le option reali
 * (mai valori inventati): criterio esplicito per frammento di nome se la sua
 * option esiste; altrimenti selected → «tutti/tutte» → prima con value.
 * Gli indicatori obbligatori lasciati vuoti fanno fallire la validazione
 * della maschera (lezione del gestionale) — per questo mai stringhe a caso.
 */
function applicaCriteriSelect($, form, payload, criteri) {
  form.find("select").each((_, sel) => {
    const $sel = $(sel);
    const name = $sel.attr("name");
    if (!name) return;
    const options = $sel.find("option").toArray();
    if (!options.length) return;

    const frammento = Object.keys(criteri)
      .filter((f) => name.toLowerCase().includes(f.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (frammento !== undefined) {
      const voluto = criteri[frammento];
      const opzione = options.find((o) => String($(o).attr("value") ?? "") === voluto)
        || options.find((o) => String($(o).text() || "").trim().toLowerCase() === String(voluto).toLowerCase());
      if (opzione) { payload.set(name, $(opzione).attr("value") ?? ""); return; }
    }

    let scelta = options.find((o) => $(o).attr("selected") !== undefined);
    scelta = scelta || options.find((o) => {
      const txt = String($(o).text() || "").trim().toLowerCase();
      return ($(o).attr("value") || "") !== "" && (txt === "tutti" || txt === "tutte" || txt.startsWith("tutt"));
    });
    scelta = scelta || options.find((o) => ($(o).attr("value") || "") !== "");
    scelta = scelta || options[0];
    payload.set(name, $(scelta).attr("value") ?? "");
  });
}

/**
 * Recupera la lista dei verbali/sedute dalla maschera Situazione Candidati:
 * init (?pageStatus=SEARCH) → catena SSO → POST del form con criteri scelti
 * fra le option reali → se la risposta non ha righe, GET del paging con
 * Referer (il doppio binario del gestionale).
 * Returns array di { id_verbale, data, tipo, ... }
 */
async function fetchVerbaliList(client, { codiceAutoscuola, codUfficio, tipo = "P", tipoProva = "T", pin = null }) {
  const namespaceUrl = `${BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP`;
  const initUrl = `${namespaceUrl}/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH`;
  const pagingUrl = `${namespaceUrl}/ReadSituazioneCandidati_pagingSituazioneCandidati.action`;

  let html = (await client.get(initUrl, {
    headers: { Referer: `${BASE_URL}/prenotazione/menu/LoadMenu_execute.action` },
  })).data;
  html = await seguiDispatcherEPin(client, html, initUrl, pin);
  console.log(`[syncArchivio] init Situazione Candidati (${tipo}/${tipoProva}): title = ${titoloPagina(html)}`);

  const $ = cheerio.load(html || "");
  const form = trovaFormRicerca($);
  if (!form) {
    console.warn("[syncArchivio] Situazione Candidati: nessun form di ricerca nella pagina init");
    return [];
  }

  const payload = costruisciPayloadDaForm($, form);
  applicaCriteriSelect($, form, payload, {
    indicatoreTipoSessione: "C",
    indicatoreConseguimentoEsame: tipo,
    indicatoreTipoProvaEsameDaPrenotare: tipoProva,
  });
  if (codUfficio) scriviPerFrammento(payload, "codUfficioMCTC", codUfficio);
  if (codiceAutoscuola) scriviPerFrammento(payload, "codiceIdentificativoAutoscuolaAgenzia", codiceAutoscuola);
  // Date largo passato → oggi (come l'import anagrafica del gestionale:
  // lasciarle vuote può non passare la validazione della maschera).
  const oggi = new Date();
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const seiAnniFa = new Date(oggi); seiAnniFa.setFullYear(oggi.getFullYear() - 6);
  scriviPerFrammento(payload, "dataFrom", fmt(seiAnniFa));
  scriviPerFrammento(payload, "dataTo", fmt(oggi));

  // Bottone azione: quello del form se parla di Situazione Candidati, altrimenti il paging noto.
  rimuoviAzioni(payload);
  let azione = null;
  form.find("input[name^='action:']").each((_, b) => {
    const n = $(b).attr("name") || "";
    if (!azione && n.toLowerCase().includes("situazionecandidati")) azione = { n, v: $(b).attr("value") || "Ricerca" };
  });
  if (!azione) {
    const primo = form.find("input[name^='action:']").first();
    if (primo.length) azione = { n: primo.attr("name"), v: primo.attr("value") || "Ricerca" };
  }
  if (azione) payload.set(azione.n, azione.v);
  else payload.set("action:ReadSituazioneCandidati_pagingSituazioneCandidati", "Ricerca");

  // Diagnostico GDPR-safe: solo NOMI campo, con flag "valorizzato".
  const campiInfo = Array.from(new Set(payload.keys()))
    .filter((k) => !k.startsWith("action:")).slice(0, 40)
    .map((k) => k.split(".").pop() + (payload.get(k) ? "=✓" : "")).join(",");
  console.log(`[syncArchivio] POST ricerca (${tipo}/${tipoProva}): campi ${campiInfo}`);

  const action = risolviActionForm(form, initUrl);
  let outHtml = (await client.post(action, serializePayloadRaw(payload), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: initUrl },
  })).data;
  outHtml = await seguiDispatcherEPin(client, outHtml, action, pin);
  let verbali = parseVerbaliFromHtml(outHtml);
  console.log(`[syncArchivio] dopo POST: title = ${titoloPagina(outHtml)}, righe = ${verbali.length}`);
  if (verbali.length) return { verbali, html: outHtml };

  // Doppio binario del gestionale: GET secca sul paging, Referer = init.
  let pagHtml = (await client.get(pagingUrl, { headers: { Referer: initUrl } })).data;
  pagHtml = await seguiDispatcherEPin(client, pagHtml, pagingUrl, pin);
  verbali = parseVerbaliFromHtml(pagHtml);
  console.log(`[syncArchivio] dopo GET paging: title = ${titoloPagina(pagHtml)}, righe = ${verbali.length}`);
  return { verbali, html: verbali.length ? pagHtml : outHtml };
}

/**
 * Estrae le righe della griglia risultati. La griglia NON è la prima tabella
 * della pagina (quella è layout): come il gestionale, si scandiscono TUTTE le
 * righe del documento e si tengono quelle "selezionabili" — con un input di
 * riga valorizzato (radio/hidden selectRowId o simile) e almeno due celle.
 */
function parseVerbaliFromHtml(html, silenzioso = false) {
  const $ = cheerio.load(html || "");
  const verbali = [];
  const visti = new Set();

  $("tr").each((_, tr) => {
    const $tr = $(tr);
    const $tds = $tr.find("td");
    if ($tds.length < 2) return;
    // input di riga: preferisci quelli col nome selectRowId, poi qualunque input in cella
    let $inp = $tr.find("input[name*='selectRowId' i]").first();
    if (!$inp.length) $inp = $tr.find("td input[type='radio'], td input[type='hidden'], td > input").first();
    if (!$inp.length) return;
    const idVerbale = String($inp.attr("value") || "").trim();
    if (!idVerbale || visti.has(idVerbale)) return;
    visti.add(idVerbale);

    const cells = $tds.map((__, td) => norm($(td).text())).get();
    verbali.push({
      id_verbale: idVerbale,
      data:       cells[1] || cells[0] || "",
      tipo:       cells[2] || "",
      sede:       cells[3] || "",
      raw:        cells,
    });
  });

  if (!verbali.length && !silenzioso) {
    // Diagnostica GDPR-safe: perché zero? (solo struttura, mai valori)
    const low = (html || "").toLowerCase();
    if (low.includes("nessun dato")) {
      console.log("[syncArchivio]   ↳ la pagina dice «nessun dato» per questi criteri");
    } else {
      const tabelle = $("table").map((_, t) => $(t).find("tr").length).get().join(",");
      const inputRiga = $("input[name*='selectRowId' i]").length;
      console.log(`[syncArchivio]   ↳ griglia non riconosciuta: tabelle(righe)=[${tabelle}] inputSelectRowId=${inputRiga}`);
    }
  }

  return verbali;
}

// ---------------------------------------------------------------------------
// STEP 2 — Candidati in una seduta (verbale)
// ---------------------------------------------------------------------------

/**
 * Per ogni riga della griglia risultati, apre il Dettaglio (lettura) e
 * restituisce i candidati. Il POST è costruito dal form della PAGINA DEI
 * RISULTATI (token Struts freschi inclusi): il radio di riga viene spuntato
 * e l'azione viewElement/dettaglio si legge dal DOM, come fa il gestionale.
 */
async function fetchCandidatiInVerbale(client, { idVerbale, paginaRisultati = "", pin = null }) {
  const $ = cheerio.load(paginaRisultati || "");
  const form = trovaFormRicerca($);
  const initReferer = `${BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action`;

  let payload, url;
  if (form) {
    payload = costruisciPayloadDaForm($, form);
    if (!scriviPerFrammento(payload, "selectRowId", idVerbale)) {
      // il radio non spuntato non è nel payload: recupera il suo nome dal DOM
      const nomeRadio = $("input[name*='selectRowId' i]").first().attr("name")
        || "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.selectRowId";
      payload.append(nomeRadio, idVerbale);
    }
    rimuoviAzioni(payload);
    let azione = null;
    form.find("input[name^='action:']").each((_, b) => {
      const n = ($(b).attr("name") || "").toLowerCase();
      if (!azione && (n.includes("viewelement") || n.includes("dettaglio")))
        azione = { n: $(b).attr("name"), v: $(b).attr("value") || "Dettaglio" };
    });
    if (azione) payload.set(azione.n, azione.v);
    else payload.set("action:SelectSituazioneCandidati_viewElementSituazioneCandidati", "Dettaglio");
    url = risolviActionForm(form, initReferer);
  } else {
    // ripiego: POST a secco come il vecchio flusso
    payload = new URLSearchParams();
    payload.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.selectRowId", idVerbale);
    payload.set("action:SelectSituazioneCandidati_viewElementSituazioneCandidati", "Dettaglio");
    url = `${BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/ReadSituazioneCandidati_searchSituazioneCandidati.action`;
  }

  let { data: html } = await client.post(url, serializePayloadRaw(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: initReferer,
    },
  });
  html = await seguiDispatcherEPin(client, html, url, pin);
  console.log(`[syncArchivio] dettaglio riga: title = ${titoloPagina(html)}`);

  return parseCandidatiInVerbaleHtml(html);
}

// ---------------------------------------------------------------------------
// STEP 1-ter — ARCHIVIO STORICO dai VERBALI SVOLTI (Conseguimento)
// ---------------------------------------------------------------------------
// La Situazione Candidati mostra solo i candidati correnti; lo STORICO
// completo sta nei «Verbali Svolti» (indicazione del titolare, 28/08/2026):
// maschera sessioneEsameAbilitazioneEP, ricerca per finestre di date e
// Dettaglio per ogni verbale con l'elenco dei candidati esaminati.

// Le 4 sezioni dei Verbali Svolti, come nel gestionale (PortaleNativeService.Verbali.cs):
// init SENZA il prefisso /prenotazione (con /prenotazione risponde 404) e azione di
// ricerca propria per sezione. Il Portale impone MAX 7 GIORNI per finestra.
const SEZIONI_VERBALI_SVOLTI = [
  { init: "/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action?pageStatus=SEARCH",
    azione: "action:ReadConseguimento_pagingConseguimento", codice: "VSC", desc: "Conseguimento" },
  { init: "/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqc.action?pageStatus=SEARCH",
    azione: "action:ReadCqc_pagingCQC", codice: "VSQ", desc: "CQC" },
  { init: "/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiRevisione.action?pageStatus=SEARCH",
    azione: "action:ReadRevisione_pagingRevisione", codice: "VSR", desc: "Revisione patente" },
  { init: "/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqcRev.action?pageStatus=SEARCH",
    azione: "action:ReadRevisione_pagingRevisione", codice: "VSRCQCC", desc: "Revisione CQC" },
];

/** Il titolo indica la HOME del Portale? (endpoint init non valido → rimbalzo). */
function paginaHome(html) {
  const t = titoloPagina(html).toLowerCase();
  return t.endsWith("- home") || t.endsWith("- homepage") || t.includes("home professionista")
    || t.includes("homepage professionista");
}

/** Tabella "principale" della pagina (quella con più righe): intestazioni + celle testo. */
function parseTabellaGrande(html) {
  const $ = cheerio.load(html || "");
  let migliore = null, righeMax = -1;
  $("table").each((_, t) => {
    const n = $(t).find("tr").length;
    if (n > righeMax) { righeMax = n; migliore = $(t); }
  });
  if (!migliore) return { colonne: [], righe: [] };
  const colonne = migliore.find("th").map((_, th) => norm($(th).text())).get();
  const righe = [];
  migliore.find("tr").each((_, tr) => {
    const celle = $(tr).find("td").map((__, td) => norm($(td).text())).get();
    if (celle.length >= 2) righe.push(celle);
  });
  return { colonne, righe };
}

/**
 * Ricerca Verbali Svolti di UNA sezione in una finestra ≤7 giorni: init+POST
 * col form vero, campi come il gestionale (codUfficioMCTC, coppia
 * dataVerbaleEsameAbilitazione/…TO, codiceTipoProvaSedutaEsame vuoto = tutte).
 */
async function eseguiRicercaVerbaliSvolti(client, { sezione, dataDa, dataA, ufficio, pin = null }) {
  const vuoto = { verbali: [], html: "", tabella: { colonne: [], righe: [] } };
  // prova prima il namespace del gestionale, poi la variante /prenotazione
  for (const prefisso of ["", "/prenotazione"]) {
    const initUrl = `${BASE_URL}${prefisso}${sezione.init}`;
    let html;
    try {
      html = (await client.get(initUrl, {
        headers: { Referer: `${BASE_URL}/prenotazione/menu/LoadMenu_execute.action` },
      })).data;
    } catch (err) {
      if (err?.response?.status === 404) continue;
      throw err;
    }
    html = await seguiDispatcherEPin(client, html, initUrl, pin);
    if (paginaHome(html)) continue; // endpoint non valido: prova la variante

    const $ = cheerio.load(html || "");
    const form = trovaFormRicerca($);
    if (!form) {
      console.warn(`[syncArchivio] Verbali Svolti ${sezione.codice}: nessun form, title =`, titoloPagina(html));
      return vuoto;
    }

    const payload = costruisciPayloadDaForm($, form);
    for (const key of Array.from(new Set(payload.keys()))) {
      if (key.includes("codUfficioMCTC")) payload.set(key, ufficio || "");
      else if (key.includes("dataVerbaleEsameAbilitazioneTO")) payload.set(key, dataA);
      else if (key.endsWith("dataVerbaleEsameAbilitazione")) payload.set(key, dataDa);
      else if (key.includes("codiceTipoProvaSedutaEsame")) payload.set(key, ""); // tutte le prove
    }
    rimuoviAzioni(payload);
    payload.set(sezione.azione, "Ricerca");

    const action = risolviActionForm(form, initUrl);
    let outHtml = (await client.post(action, serializePayloadRaw(payload), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: initUrl },
    })).data;
    outHtml = await seguiDispatcherEPin(client, outHtml, action, pin);
    if (paginaHome(outHtml)) continue;

    // Paging: segue le eventuali pagine successive (di norma 1 con finestre di 7gg)
    const verbali = parseVerbaliFromHtml(outHtml, true);
    const tabella = parseTabellaGrande(outHtml);
    let pagHtml = outHtml;
    for (let pag = 2; pag <= 10; pag++) {
      const $p = cheerio.load(pagHtml || "");
      let next = null;
      $p("a[href]").each((_, aEl) => {
        if (next) return;
        const testo = norm($p(aEl).text()).toLowerCase();
        const href = String($p(aEl).attr("href") || "");
        if (href.startsWith("javascript:") || href === "#") return;
        const hrefLow = href.toLowerCase();
        if (testo === "»" || testo === "›" || testo === ">" || testo.includes("success") || testo.includes("avanti")
            || (hrefLow.includes("paging") && (hrefLow.includes("page") || hrefLow.includes("pagina"))))
          next = href.startsWith("http") ? href : BASE_URL + href;
      });
      if (!next) break;
      try { pagHtml = (await client.get(next, { headers: { Referer: action } })).data; }
      catch { break; }
      if (paginaHome(pagHtml)) break;
      const vN = parseVerbaliFromHtml(pagHtml, true);
      const tN = parseTabellaGrande(pagHtml);
      if (!vN.length && !tN.righe.length) break;
      for (const v of vN) if (!verbali.some((x) => x.id_verbale === v.id_verbale)) verbali.push(v);
      tabella.righe.push(...tN.righe);
    }

    return { verbali, html: outHtml, tabella };
  }
  throw new Error("init Verbali Svolti non raggiungibile (404/home su entrambe le varianti)");
}

/** Dettaglio di un verbale svolto: candidati esaminati con esito e celle grezze. */
async function fetchCandidatiVerbaleSvolto(client, paginaRisultati, idVerbale, pin = null) {
  const $ = cheerio.load(paginaRisultati || "");
  const form = trovaFormRicerca($);
  if (!form) return [];
  const initReferer = `${BASE_URL}/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action`;

  const payload = costruisciPayloadDaForm($, form);
  if (!scriviPerFrammento(payload, "selectRowId", idVerbale)) {
    const nomeRadio = $("input[name*='selectRowId' i]").first().attr("name")
      || "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.selectRowId";
    payload.append(nomeRadio, idVerbale);
  }
  rimuoviAzioni(payload);
  let azione = null;
  form.find("input[name^='action:']").each((_, b) => {
    const n = ($(b).attr("name") || "").toLowerCase();
    if (!azione && (n.includes("viewdetail") || n.includes("dettaglio")))
      azione = { n: $(b).attr("name"), v: $(b).attr("value") || "Dettaglio" };
  });
  if (azione) payload.set(azione.n, azione.v);
  else payload.set("action:Select_viewDetailVerbale", "Dettaglio");

  const url = risolviActionForm(form, initReferer);
  let { data: html } = await client.post(url, serializePayloadRaw(payload), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: initReferer },
  });
  html = await seguiDispatcherEPin(client, html, url, pin);

  const $det = cheerio.load(html || "");
  const candidati = [];
  // colonne comuni quiz/guida: 1=marca, 2=abilitazione, 6=cognome, 7=nome, 8=data nascita;
  // esito: col 12 nei quiz, col 10 nelle guide (iPatente) — si tiene il primo non vuoto e
  // TUTTE le celle grezze, così nulla dei verbali va perso (schede quiz/esiti compresi).
  $det("#listSedutaEsameAbilitazioneEP tbody tr, table tbody tr").each((_, tr) => {
    const $tds = $det(tr).find("td");
    if ($tds.length < 8) return;
    const marcaOperativa = norm($tds.eq(1).text());
    if (!/^\d{2}[A-Z]{2}\d{4,}$/i.test(marcaOperativa)) return;
    const celle = $tds.map((__, td) => norm($det(td).text())).get();
    candidati.push({
      marcaOperativa,
      abilitazione: celle[2] || "",
      cognome:      celle[6] || "",
      nome:         celle[7] || "",
      dataNascita:  celle[8] || "",
      esito:        celle[12] || celle[10] || "",
      celle,
    });
  });
  return candidati;
}

// ── Cursori di ripresa (tabella sync_cursori) ───────────────────────────────
// Il giro storico dura ore e può venire interrotto (403 del Portale, riavvii):
// l'ultima finestra completata per sezione si salva su Supabase e alla
// ripartenza si riprende da lì invece di ripercorrere anni già fatti.

async function leggiCursore(autoscuolaId, chiave) {
  if (!autoscuolaId) return null;
  const { data } = await supabase
    .from("sync_cursori").select("valore")
    .eq("autoscuola_id", autoscuolaId).eq("chiave", chiave).maybeSingle();
  return data?.valore || null;
}

async function scriviCursore(autoscuolaId, chiave, valore) {
  if (!autoscuolaId) return;
  await supabase.from("sync_cursori").upsert(
    { autoscuola_id: autoscuolaId, chiave, valore, updated_at: new Date().toISOString() },
    { onConflict: "autoscuola_id,chiave" });
}

/** gg/mm/aaaa → aaaa-mm-gg (null se non è una data). */
function dataIso(gma) {
  const m = String(gma || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Salva le righe di seduta in verbali_svolti (stessa mappatura per frammento
 * di intestazione del gestionale; dedupe su autoscuola+tipo+data+numero).
 */
async function salvaVerbaliSvoltiSupabase({ colonne, righe }, tipoVerbale, autoscuolaId) {
  if (!autoscuolaId || !righe.length) return 0;
  const idx = (pred) => colonne.findIndex((c) => pred((c || "").trim().toLowerCase()));
  const iData = idx((c) => c.includes("data"));
  const iEsame = idx((c) => c === "esame" || (c.includes("esame") && !c.includes("data")));
  const iFo = idx((c) => c.startsWith("f.o") || c.includes("fascia"));
  const iVerb = idx((c) => c === "verb." || c === "verb" || (c.includes("verb") && !c.includes("data") && !c.includes("stato")));
  const iCand = idx((c) => c.includes("cand"));
  const iStato = idx((c) => c.includes("stato"));
  const iUff = idx((c) => c.includes("uff") || c.includes("prov"));
  const iDesc = idx((c) => c.includes("desc"));
  const iIndir = idx((c) => c.includes("indir"));

  let inseriti = 0;
  for (const r of righe) {
    const val = (i) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");
    const dataVerb = dataIso(val(iData));
    const numero = parseInt(val(iVerb), 10) || 0;
    if (!dataVerb && !numero) continue; // riga non-dati

    let q = supabase
      .from("verbali_svolti")
      .select("id", { count: "exact", head: true })
      .eq("autoscuola_id", autoscuolaId)
      .eq("tipo_verbale", tipoVerbale);
    q = dataVerb ? q.eq("data_verbale", dataVerb) : q.is("data_verbale", null);
    q = numero ? q.eq("numero_verbale", numero) : q.is("numero_verbale", null);
    const { count } = await q;
    if (count > 0) continue;

    const raw = {};
    colonne.forEach((c, i) => { const k = c || `col${i}`; if (!(k in raw)) raw[k] = val(i); });
    const { error } = await supabase.from("verbali_svolti").insert({
      autoscuola_id: autoscuolaId,
      data_verbale: dataVerb,
      tipo_esame: val(iEsame),
      fascia_oraria: val(iFo),
      numero_verbale: numero || null,
      candidati_prenotati: parseInt(val(iCand), 10) || null,
      stato_verbale: val(iStato),
      ufficio_provinciale: val(iUff),
      desc_localita: val(iDesc),
      indirizzo: val(iIndir),
      tipo_verbale: tipoVerbale,
      raw_html: JSON.stringify(raw),
      synced_at: new Date().toISOString(),
    });
    if (!error) inseriti++;
  }
  return inseriti;
}

/**
 * Salva gli esiti per candidato in esiti_esami, risolvendo candidato_id dalla
 * marca operativa (i candidati sono già stati upsertati dalla FASE 2).
 * Dedupe su autoscuola+candidato+verbale+data.
 */
async function salvaEsitiEsami(esiti, autoscuolaId) {
  if (!autoscuolaId || !esiti.length) return 0;
  const marche = Array.from(new Set(esiti.map((e) => e.marcaOperativa)));
  const idPerMarca = new Map();
  for (let i = 0; i < marche.length; i += 100) {
    const blocco = marche.slice(i, i + 100);
    const { data } = await supabase
      .from("candidates").select("id, marca_operativa")
      .eq("autoscuola_id", autoscuolaId).in("marca_operativa", blocco);
    for (const row of data || []) idPerMarca.set(row.marca_operativa, row.id);
  }

  let inseriti = 0;
  for (const e of esiti) {
    const candidatoId = idPerMarca.get(e.marcaOperativa);
    if (!candidatoId) continue;
    const dataEsame = dataIso(e.dataVerbale) || null;
    const { count } = await supabase
      .from("esiti_esami")
      .select("id", { count: "exact", head: true })
      .eq("autoscuola_id", autoscuolaId)
      .eq("candidato_id", candidatoId)
      .eq("id_verbale_portale", e.idVerbale || "")
      .eq("tipo_esame", e.tipoSezione || "");
    if (count > 0) continue;

    const { error } = await supabase.from("esiti_esami").insert({
      autoscuola_id: autoscuolaId,
      candidato_id: candidatoId,
      data_esame: dataEsame,
      tipo_esame: e.tipoSezione || "",
      codice_sessione: e.numeroVerbale || null,
      esito: e.esito || null,
      id_verbale_portale: e.idVerbale || null,
      data_sync_portale: new Date().toISOString(),
      note: JSON.stringify({ abilitazione: e.abilitazione, celle: e.celle }),
    });
    if (!error) inseriti++;
  }
  return inseriti;
}

function parseCandidatiInVerbaleHtml(html) {
  const $ = cheerio.load(html || "");
  const candidati = [];

  // iPatente usa .tabella-1 > tbody per i candidati della seduta
  $(".tabella-1 > tbody tr, table tbody tr").each((_, tr) => {
    const $tds = $(tr).find("td");
    if ($tds.length < 3) return;

    const marcaOperativa = norm($tds.eq(0).text());
    const cognome        = norm($tds.eq(1).text());
    const nome           = norm($tds.eq(2).text());
    const codiceStatino  = norm($tds.eq(3).text());
    const dataEmissione  = norm($tds.eq(4).text());
    const scadenza       = norm($tds.eq(5).text());
    const categoria      = norm($tds.eq(6).text());
    const tipoEsame      = norm($tds.eq(7).text());

    if (!cognome && !marcaOperativa) return;
    // Solo righe con marca operativa vera (es. 98ME202128): il resto è
    // arredamento della pagina (messaggi, calendario) che finiva nei candidati.
    if (!/^\d{2}[A-Z]{2}\d{4,}$/i.test(marcaOperativa)) return;

    candidati.push({
      marcaOperativa,
      cognome,
      nome,
      codiceStatino,
      dataEmissione,
      scadenza,
      categoria,
      tipoEsame,
    });
  });

  return candidati;
}

// ---------------------------------------------------------------------------
// STEP 3 — Scheda individuale candidato
// ---------------------------------------------------------------------------

/**
 * Recupera la scheda completa di un candidato dalla sua marcaOperativa.
 * Estrae: CF, DOB, anagrafica, foto (picBase64/dedemBase64), firma (picFirmaBase64).
 *
 * Con indicatoreRicercaEstesa=S vengono inclusi anche candidati storici.
 */
async function fetchSchedaCandidato(client, {
  idAutAg,
  codUfficioMctc,
  marcaOperativa,
  codiceFiscale = "",
  pin = null,
}) {
  const useEstesa = marcaOperativa && !String(marcaOperativa).startsWith("98");

  // Init della maschera «Richiesta Esame» + POST del form (vedi helper sopra:
  // la GET con azione in query string non è più accettata dal Portale).
  // pageStatus=SEARCH è obbligatorio: l'init nudo risponde 500.
  const initUrl = `${BASE_URL}/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=SEARCH`;
  let html;
  try {
    html = (await client.get(initUrl, {
      headers: { Referer: `${BASE_URL}/prenotazione/menu/LoadMenu_execute.action` },
    })).data;
  } catch (err) {
    console.warn(`[syncArchivio] init Richiesta Esame: HTTP ${err?.response?.status || err.message}`);
    return {};
  }
  html = await seguiDispatcherEPin(client, html, initUrl, pin);

  const $ = cheerio.load(html || "");
  const form = trovaFormRicerca($);
  if (!form) {
    console.warn("[syncArchivio] maschera Richiesta Esame senza form, title =", titoloPagina(html));
    return {};
  }

  const payload = costruisciPayloadDaForm($, form);
  applicaCriteriSelect($, form, payload, {});
  scriviPerFrammento(payload, "richiestaFrom.idAutAg", String(idAutAg || ""));
  scriviPerFrammento(payload, "codiceUffOperativo", String(codUfficioMctc || ""));
  scriviPerFrammento(payload, "richiestaFrom.marcaOperativa", String(marcaOperativa || ""));
  if (codiceFiscale) scriviPerFrammento(payload, "theAnagrafica.codiceFiscale", String(codiceFiscale));
  if (useEstesa) {
    // La casella «ricerca estesa» include i candidati storici: se il form la
    // espone come checkbox non spuntata non è nel payload — va aggiunta.
    if (!scriviPerFrammento(payload, "indicatoreRicercaEstesa", "S")) {
      payload.set("richiestaPerEsameView.richiestaFrom.indicatoreRicercaEstesa", "S");
    }
  }
  rimuoviAzioni(payload);
  let azioneScheda = null;
  form.find("input[name^='action:']").each((_, b) => {
    const n = ($(b).attr("name") || "").toLowerCase();
    if (!azioneScheda && (n.includes("paging") || n.includes("ricerca")))
      azioneScheda = { n: $(b).attr("name"), v: $(b).attr("value") || "Ricerca" };
  });
  if (azioneScheda) payload.set(azioneScheda.n, azioneScheda.v);
  else payload.set("action:Read_paging", "Ricerca");

  const action = risolviActionForm(form, initUrl);
  let outHtml = (await client.post(action, serializePayloadRaw(payload), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: initUrl },
  })).data;
  outHtml = await seguiDispatcherEPin(client, outHtml, action, pin);

  return parseSchedaCandidatoHtml(outHtml);
}

/**
 * Parsa la scheda individuale del candidato.
 * Estrae: codice fiscale, anagrafica, foto e firma (base64 da input nascosti).
 */
function parseSchedaCandidatoHtml(html) {
  if (!html) return {};
  const $ = cheerio.load(html);

  function getInput(name) {
    return norm($(`[name="${name}"], [name*="${name}"]`).first().val() || "");
  }
  function getVal(selector) {
    return norm($(selector).first().val() || "");
  }
  function getText(selector) {
    return norm($(selector).first().text() || "");
  }

  // Codice fiscale
  const codiceFiscale =
    getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.codiceFiscale") ||
    getInput("codiceFiscale") ||
    getInput("cf") || "";

  // Anagrafica
  const cognome       = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.cognome") || getInput("cognome") || "";
  const nome          = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.nome") || getInput("nome") || "";
  const dataNascita   = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.dataNascitaString") ||
                        getInput("dataNascita") || "";
  const sesso         = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.sesso") || getInput("sesso") || "";

  // Contatti
  const telefono      = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.telefono") ||
                        getInput("telefono") || "";
  const email         = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.email") ||
                        getInput("email") || "";

  // Indirizzo
  const indirizzo     = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.indirizzoResidenza") ||
                        getInput("indirizzo") || getInput("via") || "";
  const cap           = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.capResidenza") ||
                        getInput("cap") || "";

  // Patente
  const numeroPatente = getInput("richiestaPerEsameView.richiestaFrom.theAnagrafica.numeroPatente") ||
                        getInput("patente") || getInput("numeroPatente") || "";
  const categoria     = getInput("richiestaPerEsameView.richiestaFrom.theTipoCategoriaPatenteAb.selectRowId") ||
                        getInput("categoria") || "";

  // Foglio Rosa
  const codiceFoglioRosa =
    getInput("richiestaPerEsameView.richiestaFrom.codiceFoglioRosa") ||
    getInput("codiceFoglioRosa") || "";

  // Scadenza foglio rosa
  const scadenzaFoglioRosa =
    getInput("richiestaPerEsameView.richiestaFrom.dataScadenzaFoglioRosaString") ||
    getInput("dataScadenzaFoglioRosa") || "";

  // Foto e firma: iPatente legge picBase64, dedemBase64, picFirmaBase64
  // (input nascosti con l'immagine in base64)
  const fotoBase64 =
    getVal("[name='picBase64']") ||
    getVal("[name='dedemBase64']") || "";
  const firmaBase64 = getVal("[name='picFirmaBase64']") || "";

  // Marca operativa dalla scheda
  const marcaOperativa =
    getInput("richiestaPerEsameView.richiestaFrom.marcaOperativa") ||
    getInput("marcaOperativa") || "";

  return {
    codice_fiscale:       codiceFiscale,
    cognome,
    nome,
    data_nascita:         dataNascita,
    sesso,
    telefono,
    email,
    indirizzo,
    cap,
    patente_numero:       numeroPatente,
    categoria_patente:    categoria,
    codice_foglio_rosa:   codiceFoglioRosa,
    ppg_data_scadenza:    scadenzaFoglioRosa,
    marca_operativa:      marcaOperativa,
    foto_base64:          fotoBase64,
    firma_base64:         firmaBase64,
  };
}

// ---------------------------------------------------------------------------
// STORAGE — Salva foto/firma su Supabase Storage
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = "candidate-media";
let _bucketReady = false;

/** Crea il bucket candidate-media se non esiste (idempotente). */
async function ensureBucket() {
  if (_bucketReady) return;
  try {
    const { data: list } = await supabase.storage.listBuckets();
    const exists = list?.some((b) => b.name === STORAGE_BUCKET);
    if (!exists) {
      const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5 MB
      });
      if (error && !error.message?.includes("already exists")) {
        console.warn("[syncArchivio] Impossibile creare bucket:", error.message);
      }
    }
    _bucketReady = true;
  } catch (err) {
    console.warn("[syncArchivio] Errore verifica bucket:", err.message);
  }
}

/**
 * Carica immagine base64 su Supabase Storage.
 * Ritorna il path pubblico, o null se fallisce.
 */
async function uploadImageToStorage(base64Data, path) {
  await ensureBucket();
  if (!base64Data || base64Data.length < 100) return null;
  try {
    // Rimuovi eventuale data URI prefix
    const clean = base64Data.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(clean, "base64");
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, buf, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) throw error;
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (err) {
    console.warn(`[syncArchivio] Storage upload fallito per ${path}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// STEP 4 — Upsert candidato con tutti i dati
// ---------------------------------------------------------------------------

async function upsertCandidatoCompleto(schedaRaw, listaRow, autoscuolaId) {
  const scheda = schedaRaw || {};
  const lista  = listaRow  || {};

  // Costruisci oggetto candidato per upsertCandidateToDB
  const candidato = {
    codice_fiscale:    scheda.codice_fiscale || undefined,
    cognome:           scheda.cognome    || lista.cognome    || "",
    nome:              scheda.nome       || lista.nome       || "",
    data_nascita:      scheda.data_nascita || undefined,
    sesso:             scheda.sesso      || undefined,
    telefono:          scheda.telefono   || undefined,
    email:             scheda.email      || undefined,
    indirizzo:         scheda.indirizzo  || undefined,
    cap:               scheda.cap        || undefined,
    patente_numero:    scheda.patente_numero || undefined,
    categoria_patente: scheda.categoria_patente || lista.categoria || "B",
    marca_operativa:   scheda.marca_operativa || lista.marcaOperativa || undefined,
    codice_statino:    lista.codiceStatino || undefined,
    codice_foglio_rosa: scheda.codice_foglio_rosa || undefined,
    ppg_data_scadenza: scheda.ppg_data_scadenza || lista.scadenza || undefined,
    stato:             "attivo",
    stato_iscrizione:  "attivo",
    data_iscrizione:   lista.dataEmissione || undefined,
    raw_portale: {
      tipo_esame:            lista.tipoEsame || undefined,
      data_emissione_statino: lista.dataEmissione || undefined,
    },
  };

  // Salva foto e firma su Supabase Storage se presenti
  if (scheda.foto_base64 && scheda.foto_base64.length > 100) {
    const cfSlug = String(candidato.codice_fiscale || candidato.cognome || "unknown")
      .replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const fotoPath = `${cfSlug}/foto.jpg`;
    const fotoUrl = await uploadImageToStorage(scheda.foto_base64, fotoPath);
    if (fotoUrl) candidato.raw_portale.foto_url = fotoUrl;
    else candidato.raw_portale.foto_base64 = scheda.foto_base64.slice(0, 50000); // fallback parziale
  }

  if (scheda.firma_base64 && scheda.firma_base64.length > 100) {
    const cfSlug = String(candidato.codice_fiscale || candidato.cognome || "unknown")
      .replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const firmaPath = `${cfSlug}/firma.jpg`;
    const firmaUrl = await uploadImageToStorage(scheda.firma_base64, firmaPath);
    if (firmaUrl) candidato.raw_portale.firma_url = firmaUrl;
  }

  return upsertCandidateToDB(candidato, autoscuolaId);
}

// ---------------------------------------------------------------------------
// ORCHESTRATORE PRINCIPALE
// ---------------------------------------------------------------------------

/**
 * Sync archivio completo — replica iPatente.
 *
 * @param {object} opts
 * @param {string} opts.idAutAg            Codice meccanografico autoscuola (CODMEC)
 * @param {string} opts.codUfficioMctc     Codice ufficio MCTC (provincia)
 * @param {string} [opts.autoscuolaId]     ID Supabase autoscuola (per upsert)
 * @param {boolean} [opts.fetchDettaglio]  Se true, recupera scheda individuale per ogni candidato (default true)
 * @param {function} [opts.onProgress]     Callback({ fase, totale, completati, errori })
 * @returns {Promise<{ inserted, updated, errors, skipped }>}
 */
async function syncArchivioCompleto(opts = {}) {
  const {
    idAutAg         = process.env.CODICE_AUTOSCUOLA || process.env.ARCHIVIO_CODICE_AUTOSCUOLA || "",
    codUfficioMctc  = process.env.PORTAL_UFFICIO_MCTC || "",
    autoscuolaId    = null,
    fetchDettaglio  = true,
    onProgress      = null,
    credenziali     = null, // {username,password,pin} dal record autoscuola (resolvePortalCredentials)
  } = opts;

  if (!idAutAg) throw new Error("idAutAg (codice meccanografico) obbligatorio");

  // messaggio: riga leggibile mostrata IN DIRETTA nel log del gestionale (SSE).
  // GDPR: mai nomi, marche o dati personali — solo sezioni, date e conteggi.
  const progress = (fase, completati, totale, errori = 0, messaggio = "") => {
    if (typeof onProgress === "function") {
      onProgress({ fase, completati, totale, errori, messaggio });
    }
  };

  // Login — credenziali del record autoscuola se fornite, env come ripiego.
  // faiLogin è riusabile: il giro storico dura ore e la sessione va rinfrescata.
  progress("login", 0, 1);
  const faiLogin = async () => makeHttpClient(await loginDirectHttp({
    username: credenziali?.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: credenziali?.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      credenziali?.pin      || process.env.PORTAL_PIN,
  }));
  let client = await faiLogin();
  progress("login", 1, 1, 0, "✓ Login al Portale riuscito");

  // Combinazioni iPatenteCloud (replica completa GeCA Trasmiss):
  //   P = Patente, Q = CQC
  //   T = Teoria,  G = Guida
  // Copertura TOTALE dei verbali esami = 4 combinazioni.
  const COMBINAZIONI = [
    { tipo: "P", tipoProva: "T", desc: "Patente Teoria" },
    { tipo: "Q", tipoProva: "T", desc: "CQC Teoria"     },
    { tipo: "P", tipoProva: "G", desc: "Patente Guida"  },
    { tipo: "Q", tipoProva: "G", desc: "CQC Guida"      }, // FASE A — combinazione mancante
  ];

  // Mappa marca operativa → dati lista (evita duplicati)
  const candidatiMap = new Map(); // key: marcaOperativa

  // ── FASE 1: raccolta verbali e candidati ──────────────────────────────────
  progress("verbali", 0, COMBINAZIONI.length);

  for (let ci = 0; ci < COMBINAZIONI.length; ci++) {
    const comb = COMBINAZIONI[ci];
    progress("verbali", ci, COMBINAZIONI.length);

    const pinPortale = credenziali?.pin || process.env.PORTAL_PIN || null;
    const criteriRicerca = {
      codiceAutoscuola: idAutAg,
      codUfficio: codUfficioMctc,
      tipo:      comb.tipo,
      tipoProva: comb.tipoProva,
      pin:       pinPortale,
    };

    let verbali = [];
    let paginaRisultati = "";
    try {
      const ricerca = await fetchVerbaliList(client, criteriRicerca);
      verbali = ricerca.verbali;
      paginaRisultati = ricerca.html;
      console.log(`[syncArchivio] ${comb.desc}: ${verbali.length} verbali`);
      progress("situazione", ci + 1, COMBINAZIONI.length, 0,
        `Situazione Candidati — ${comb.desc}: ${verbali.length} gruppi`);
    } catch (err) {
      console.warn(`[syncArchivio] Errore verbali ${comb.desc}:`, err.message);
      continue;
    }

    // Per ogni riga, apri il Dettaglio partendo dalla pagina risultati (token
    // freschi); i token Struts sono monouso, quindi dopo ogni Dettaglio la
    // ricerca viene rieseguita per la riga successiva.
    for (let vi = 0; vi < verbali.length; vi++) {
      const verbale = verbali[vi];
      if (!verbale.id_verbale) continue;
      try {
        const cands = await fetchCandidatiInVerbale(client, {
          idVerbale: verbale.id_verbale,
          paginaRisultati,
          pin: pinPortale,
        });
        for (const c of cands) {
          if (!c.marcaOperativa) continue;
          if (!candidatiMap.has(c.marcaOperativa)) {
            candidatiMap.set(c.marcaOperativa, { ...c, combo: comb });
          }
        }
      } catch (err) {
        console.warn(`[syncArchivio] Errore candidati verbale ${verbale.id_verbale}:`, err.message);
      }
      await delay(100); // throttle
      if (vi < verbali.length - 1) {
        try { paginaRisultati = (await fetchVerbaliList(client, criteriRicerca)).html; }
        catch { paginaRisultati = ""; }
      }
    }
  }

  // ── FASE 1-ter: ARCHIVIO STORICO dai VERBALI SVOLTI ───────────────────────
  // Come il gestionale (PortaleNativeService.Verbali.cs): 4 sezioni, finestre
  // di MAX 7 GIORNI (limite del Portale) da ARCHIVIO_ANNO_INIZIO (default 2000)
  // a oggi. Le sezioni girano in parallelo, ognuna con la propria sessione,
  // re-login ogni 30 finestre. Ogni verbale: riga di seduta → verbali_svolti;
  // Dettaglio → candidati con esito (anagrafica + esiti_esami).
  const esitiRaccolti = [];
  {
    const pinPortale = credenziali?.pin || process.env.PORTAL_PIN || null;
    const annoInizio = Number(process.env.ARCHIVIO_ANNO_INIZIO || 2000);
    const fine = new Date();
    // Interruttore globale: al primo accenno di rifiuto sistematico (403) il
    // giro storico si SOSPENDE — martellare il Portale rischia il blocco
    // dell'utenza. Il lavoro fatto è salvo e il cursore riparte da lì.
    let sospeso403 = false;

    const lavoraSezione = async (sezione) => {
      let clientSez = await faiLogin();
      let finestreDaLogin = 0;
      let erroriConsecutivi = 0, errori403Consecutivi = 0;
      let raccolti = 0, verbaliTot = 0, finestreConDati = 0, salvatiSedute = 0, finestreFatte = 0;

      // Ripresa dal cursore: ultima finestra completata per questa sezione.
      const chiaveCursore = `verbali_svolti:${sezione.codice}`;
      let da = new Date(annoInizio, 0, 1);
      const cursore = await leggiCursore(autoscuolaId, chiaveCursore).catch(() => null);
      if (cursore) {
        const ripresa = new Date(cursore);
        if (!isNaN(ripresa) && ripresa > da) {
          da = ripresa; da.setDate(da.getDate() + 1);
          console.log(`[syncArchivio] Verbali Svolti ${sezione.desc}: riprendo dal ${fmtDataPortale(da)}`);
        }
      }

      progress("verbali_svolti", 0, 0, 0,
        `▶ Verbali Svolti — ${sezione.desc}: dal ${fmtDataPortale(da)} a oggi (finestre di 7 giorni)`);
      while (da <= fine && !sospeso403) {
        let a = new Date(da);
        a.setDate(a.getDate() + 6); // finestra di 7 giorni, limite del Portale
        if (a > fine) a = new Date(fine);
        if (finestreDaLogin >= 30) { // sessione fresca a intervalli regolari
          try { clientSez = await faiLogin(); finestreDaLogin = 0; } catch { /* riusa la vecchia */ }
        }
        try {
          let ricerca = await eseguiRicercaVerbaliSvolti(clientSez, {
            sezione, dataDa: fmtDataPortale(da), dataA: fmtDataPortale(a),
            ufficio: codUfficioMctc, pin: pinPortale,
          });
          if (ricerca.tabella.righe.length) {
            salvatiSedute += await salvaVerbaliSvoltiSupabase(ricerca.tabella, sezione.codice, autoscuolaId)
              .catch((e) => { console.warn(`[syncArchivio] verbali_svolti ${sezione.codice}:`, e.message); return 0; });
          }
          if (ricerca.verbali.length) {
            finestreConDati++;
            verbaliTot += ricerca.verbali.length;
            progress("verbali_svolti", verbaliTot, 0, 0,
              `  ${sezione.desc} ${fmtDataPortale(da)}–${fmtDataPortale(a)}: ${ricerca.verbali.length} verbali`);
            for (const v of ricerca.verbali) {
              if (!v.id_verbale) continue;
              let cands = await fetchCandidatiVerbaleSvolto(clientSez, ricerca.html, v.id_verbale, pinPortale);
              if (!cands.length) {
                // token monouso probabilmente consumato: ricerca fresca e secondo tentativo
                ricerca = await eseguiRicercaVerbaliSvolti(clientSez, {
                  sezione, dataDa: fmtDataPortale(da), dataA: fmtDataPortale(a),
                  ufficio: codUfficioMctc, pin: pinPortale,
                });
                cands = await fetchCandidatiVerbaleSvolto(clientSez, ricerca.html, v.id_verbale, pinPortale);
              }
              for (const c of cands) {
                if (!candidatiMap.has(c.marcaOperativa)) {
                  candidatiMap.set(c.marcaOperativa, { ...c, combo: { desc: `Verbali Svolti ${sezione.desc}` } });
                  raccolti++;
                }
                esitiRaccolti.push({
                  marcaOperativa: c.marcaOperativa,
                  abilitazione: c.abilitazione,
                  esito: c.esito,
                  celle: c.celle,
                  idVerbale: v.id_verbale,
                  numeroVerbale: v.raw?.[4] || null,
                  dataVerbale: v.data || "",
                  tipoSezione: sezione.codice,
                });
              }
              await delay(250);
            }
          }
          erroriConsecutivi = 0;
          errori403Consecutivi = 0;
          // Finestra completata: avanza il cursore (aaaa-mm-gg dell'estremo superiore).
          await scriviCursore(autoscuolaId, chiaveCursore, a.toISOString().slice(0, 10)).catch(() => {});
        } catch (err) {
          const status = err?.response?.status;
          erroriConsecutivi++;
          errori403Consecutivi = status === 403 ? errori403Consecutivi + 1 : 0;
          console.warn(`[syncArchivio] Verbali Svolti ${sezione.desc} ${fmtDataPortale(da)}-${fmtDataPortale(a)}:`, err.message);
          // NIENTE re-login qui: con un 403 non serve e a raffica diventa una
          // tempesta di login (lezione del 29/08). Solo attesa crescente.
          await delay(Math.min(2000 * erroriConsecutivi, 30000));
          if (errori403Consecutivi >= 5) {
            console.warn(`[syncArchivio] Verbali Svolti ${sezione.desc}: il Portale rifiuta le richieste (403 ripetuti) — GIRO STORICO SOSPESO, si riprenderà dal cursore al prossimo scarico.`);
            progress("verbali_svolti", verbaliTot, 0, erroriConsecutivi,
              `⚠ Il Portale rifiuta le richieste (403): giro storico SOSPESO — riprenderà dal punto salvato al prossimo scarico`);
            sospeso403 = true;
            break;
          }
          if (erroriConsecutivi >= 10) {
            console.warn(`[syncArchivio] Verbali Svolti ${sezione.desc}: troppi errori consecutivi — sezione sospesa, si riprenderà dal cursore.`);
            progress("verbali_svolti", verbaliTot, 0, erroriConsecutivi,
              `⚠ ${sezione.desc}: troppi errori consecutivi — sezione sospesa (riprenderà dal punto salvato)`);
            break;
          }
          continue; // NON avanzare il cursore: la finestra fallita si ritenta al prossimo giro
        }
        finestreFatte++;
        finestreDaLogin++;
        if (finestreFatte % 100 === 0)
          console.log(`[syncArchivio] Verbali Svolti ${sezione.desc}: al ${fmtDataPortale(a)} — ${verbaliTot} verbali, ${raccolti} candidati finora`);
        if (finestreFatte % 25 === 0)
          progress("verbali_svolti", verbaliTot, 0, 0,
            `  ${sezione.desc}: arrivato al ${fmtDataPortale(a)} — ${verbaliTot} verbali, ${raccolti} candidati finora`);
        da = new Date(a);
        da.setDate(da.getDate() + 1);
        await delay(400);
      }
      console.log(`[syncArchivio] Verbali Svolti ${sezione.desc}: ${verbaliTot} verbali in ${finestreConDati} finestre, ${raccolti} candidati nuovi, ${salvatiSedute} sedute salvate`);
      progress("verbali_svolti", verbaliTot, verbaliTot, 0,
        `✓ Verbali Svolti — ${sezione.desc}: ${verbaliTot} verbali, ${raccolti} candidati nuovi, ${salvatiSedute} sedute salvate`);
    };

    // Sezioni in SERIE, non in parallelo: quattro sessioni simultanee più i
    // dettagli hanno fatto scattare il rate-limit del Portale (29/08).
    for (const s of SEZIONI_VERBALI_SVOLTI) {
      if (sospeso403) break;
      await lavoraSezione(s).catch((e) => console.warn(`[syncArchivio] sezione ${s.codice}:`, e.message));
    }
  }

  // Sessione fresca per la FASE 2: il giro storico può aver consumato ore.
  try { client = await faiLogin(); } catch { /* riusa la sessione esistente */ }

  const candidatiList = Array.from(candidatiMap.values());
  console.log(`[syncArchivio] Trovati ${candidatiList.length} candidati unici`);
  progress("candidati_trovati", candidatiList.length, candidatiList.length, 0,
    `Candidati unici raccolti: ${candidatiList.length} — scarico le schede individuali…`);

  if (candidatiList.length === 0) {
    return { inserted: 0, updated: 0, errors: 0, skipped: 0, found: 0 };
  }

  // ── FASE 2: scheda individuale + upsert ───────────────────────────────────
  let inserted = 0;
  let updated  = 0;
  let errors   = 0;
  let skipped  = 0;

  progress("upsert", 0, candidatiList.length);

  // Interruttore anche qui: se il Portale rifiuta le schede in serie (403/500
  // da rate-limit), si smette di chiederle e si upserta coi soli dati di lista
  // — le schede arriveranno al prossimo scarico a blocco rientrato.
  let schedeErroriConsecutivi = 0;
  let schedeSospese = false;

  const processCandidate = async (candidatoRow, i) => {
    try {
      let scheda = {};

      if (fetchDettaglio && candidatoRow.marcaOperativa && !schedeSospese) {
        try {
          scheda = await fetchSchedaCandidato(client, {
            idAutAg,
            codUfficioMctc,
            marcaOperativa: candidatoRow.marcaOperativa,
            pin: credenziali?.pin || process.env.PORTAL_PIN || null,
          });
          schedeErroriConsecutivi = 0;
          await delay(SYNC_DETAIL_DELAY_MS);
        } catch (err) {
          console.warn(`[syncArchivio] Errore scheda ${candidatoRow.marcaOperativa}:`, err.message);
          scheda = {};
          schedeErroriConsecutivi++;
          if (schedeErroriConsecutivi >= 8 && !schedeSospese) {
            schedeSospese = true;
            console.warn("[syncArchivio] Schede individuali: troppi errori consecutivi (rate-limit?) — SOSPESE per questo giro, si upserta coi dati di lista.");
            progress("upsert", i + 1, candidatiList.length, errors,
              "⚠ Il Portale rifiuta le schede in serie: sospese per questo giro (si salvano i dati di lista)");
          }
        }
      }

      await upsertCandidatoCompleto(scheda, candidatoRow, autoscuolaId);
      inserted++;
    } catch (err) {
      console.warn(`[syncArchivio] Errore upsert ${candidatoRow.cognome}:`, err.message);
      errors++;
    }

    if (i % 5 === 0) {
      progress("upsert", i + 1, candidatiList.length, errors,
        `  Schede: ${i + 1}/${candidatiList.length}${errors ? ` (errori ${errors})` : ""}`);
    }
  };

  await mapConcurrent(candidatiList, processCandidate, SYNC_MAX_CONCURRENCY);

  // ── FASE 3: esiti d'esame per candidato (dai Dettagli dei Verbali Svolti) ──
  // Va DOPO la FASE 2: la risoluzione marca → candidato_id richiede che i
  // candidati siano già in tabella.
  let esitiSalvati = 0;
  if (esitiRaccolti.length) {
    try {
      esitiSalvati = await salvaEsitiEsami(esitiRaccolti, autoscuolaId);
      console.log(`[syncArchivio] Esiti esami: ${esitiSalvati} salvati su ${esitiRaccolti.length} raccolti`);
      progress("esiti", esitiSalvati, esitiRaccolti.length, 0,
        `Esiti esami salvati: ${esitiSalvati} su ${esitiRaccolti.length}`);
    } catch (err) {
      console.warn("[syncArchivio] Errore salvataggio esiti:", err.message);
    }
  }

  progress("completato", candidatiList.length, candidatiList.length, errors,
    `✓ Motore: ${inserted} candidati inseriti/aggiornati, ${errors} errori`);
  console.log(`[syncArchivio] Completato: ${inserted} inseriti/aggiornati, ${errors} errori`);

  return {
    found:    candidatiList.length,
    inserted,
    updated,
    errors,
    skipped,
    esiti: esitiSalvati,
  };
}

// ---------------------------------------------------------------------------
// FUNZIONE AUSILIARIA — Fetch e salva foto/firma per un singolo candidato
// ---------------------------------------------------------------------------

/**
 * Recupera foto e firma dal portale per un candidato già in DB.
 * @param {object} opts
 * @param {string} opts.marcaOperativa
 * @param {string} opts.candidateId     UUID Supabase del candidato
 * @returns {Promise<{ foto_url, firma_url }>}
 */
async function syncFotoFirmaCandidato(opts = {}) {
  const {
    marcaOperativa,
    candidateId,
    idAutAg        = process.env.CODICE_AUTOSCUOLA || "",
    codUfficioMctc = process.env.PORTAL_UFFICIO_MCTC || "",
    credenziali    = null,
  } = opts;

  if (!marcaOperativa) throw new Error("marcaOperativa obbligatoria");

  const jar = await loginDirectHttp({
    username: credenziali?.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: credenziali?.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      credenziali?.pin      || process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);

  const scheda = await fetchSchedaCandidato(client, {
    idAutAg, codUfficioMctc, marcaOperativa,
    pin: credenziali?.pin || process.env.PORTAL_PIN || null,
  });
  const cfSlug = String(candidateId || marcaOperativa).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

  const fotoUrl  = await uploadImageToStorage(scheda.foto_base64, `${cfSlug}/foto.jpg`);
  const firmaUrl = await uploadImageToStorage(scheda.firma_base64, `${cfSlug}/firma.jpg`);

  // Aggiorna raw_portale del candidato in Supabase
  if (candidateId && (fotoUrl || firmaUrl)) {
    const { data: current } = await supabase
      .from("candidates")
      .select("raw_portale")
      .eq("id", candidateId)
      .maybeSingle();

    const updatedRaw = {
      ...(current?.raw_portale || {}),
      ...(fotoUrl  ? { foto_url:  fotoUrl  } : {}),
      ...(firmaUrl ? { firma_url: firmaUrl } : {}),
    };

    await supabase
      .from("candidates")
      .update({ raw_portale: updatedRaw, updated_at: new Date().toISOString() })
      .eq("id", candidateId);
  }

  return { foto_url: fotoUrl, firma_url: firmaUrl, scheda };
}

module.exports = {
  syncArchivioCompleto,
  syncFotoFirmaCandidato,
  fetchSchedaCandidato,
  fetchVerbaliList,
  fetchCandidatiInVerbale,
  parseSchedaCandidatoHtml,
  STORAGE_BUCKET,
};
