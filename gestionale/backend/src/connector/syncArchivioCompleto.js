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
function parseVerbaliFromHtml(html) {
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

  if (!verbali.length) {
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
  const initUrl = `${BASE_URL}/RichiestaPatenti/richiestaEsame/Read_initAction.action`;
  let html = (await client.get(initUrl, {
    headers: { Referer: `${BASE_URL}/prenotazione/menu/LoadMenu_execute.action` },
  })).data;
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

  const progress = (fase, completati, totale, errori = 0) => {
    if (typeof onProgress === "function") {
      onProgress({ fase, completati, totale, errori });
    }
  };

  // Login — credenziali del record autoscuola se fornite, env come ripiego
  progress("login", 0, 1);
  const jar = await loginDirectHttp({
    username: credenziali?.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: credenziali?.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      credenziali?.pin      || process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);

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

  const candidatiList = Array.from(candidatiMap.values());
  console.log(`[syncArchivio] Trovati ${candidatiList.length} candidati unici`);
  progress("candidati_trovati", candidatiList.length, candidatiList.length);

  if (candidatiList.length === 0) {
    return { inserted: 0, updated: 0, errors: 0, skipped: 0, found: 0 };
  }

  // ── FASE 2: scheda individuale + upsert ───────────────────────────────────
  let inserted = 0;
  let updated  = 0;
  let errors   = 0;
  let skipped  = 0;

  progress("upsert", 0, candidatiList.length);

  const processCandidate = async (candidatoRow, i) => {
    try {
      let scheda = {};

      if (fetchDettaglio && candidatoRow.marcaOperativa) {
        try {
          scheda = await fetchSchedaCandidato(client, {
            idAutAg,
            codUfficioMctc,
            marcaOperativa: candidatoRow.marcaOperativa,
            pin: credenziali?.pin || process.env.PORTAL_PIN || null,
          });
          await delay(SYNC_DETAIL_DELAY_MS);
        } catch (err) {
          console.warn(`[syncArchivio] Errore scheda ${candidatoRow.marcaOperativa}:`, err.message);
          scheda = {};
        }
      }

      await upsertCandidatoCompleto(scheda, candidatoRow, autoscuolaId);
      inserted++;
    } catch (err) {
      console.warn(`[syncArchivio] Errore upsert ${candidatoRow.cognome}:`, err.message);
      errors++;
    }

    if (i % 5 === 0) {
      progress("upsert", i + 1, candidatiList.length, errors);
    }
  };

  await mapConcurrent(candidatiList, processCandidate, SYNC_MAX_CONCURRENCY);

  progress("completato", candidatiList.length, candidatiList.length, errors);
  console.log(`[syncArchivio] Completato: ${inserted} inseriti/aggiornati, ${errors} errori`);

  return {
    found:    candidatiList.length,
    inserted,
    updated,
    errors,
    skipped,
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
