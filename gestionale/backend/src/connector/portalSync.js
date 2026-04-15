/**
 * portalSync.js
 * =============
 * Replica le funzioni di lettura dal Portale dell'Automobilista
 * che iPatente implementa in portale_read.js, ma via HTTP diretto.
 *
 * Funzioni implementate:
 *   leggiDatiPatentePosseduta(client, { numeroPatente }) — Punto 9
 *   leggiEsamiSvolti(client, { tipo, dataInizio, dataFine }) — Punto 10
 *   leggiRinnoviAttivi(client, { dataInizio, dataFine }) — Punto 12
 *   leggiEsamiCandidato(client, { cf, cognome }) — Punto 11
 *   leggiAllievi(client, { codiceAutoscuola }) — Punto 14
 *   leggiRicevutaSostitutiva(client, { cf, cognome }) — Punto 7
 */

"use strict";

const cheerio    = require("cheerio");
const { makeHttpClient, loadMenu, serializePayloadRaw } = require("./portalHttp");
const { getOrLoginJarFast }        = require("./portalSession");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";

// =============================================================================
// UTILITY
// =============================================================================

function resolvePortalCredentials() {
  return {
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASSWORD || process.env.PORTAL_PWD,
    pin:      process.env.PORTAL_PIN,
  };
}

function normalizeText(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

function toPortalDateParam(isoOrSlash) {
  // Accepts YYYY-MM-DD or DD/MM/YYYY → encodes as DD%2FMM%2FYYYY
  if (!isoOrSlash) return "";
  let str = String(isoOrSlash);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-");
    str = `${d}/${m}/${y}`;
  }
  return str.replace(/\//g, "%2F");
}

/**
 * Ottieni un client HTTP autenticato (con jar di sessione).
 */
async function getClient(credentials = {}) {
  const creds = Object.keys(credentials).length > 0 ? credentials : resolvePortalCredentials();
  const jar = await getOrLoginJarFast({
    username: creds.username,
    password: creds.password,
    pin:      creds.pin,
  });
  return makeHttpClient(jar);
}

// =============================================================================
// PUNTO 9 — DATI PATENTE POSSEDUTA
// =============================================================================

/**
 * Recupera i dati della patente posseduta di un candidato dal portale.
 * URL: /RichiestaPatenti/richiestaCertificatoMedico/SelectFunctionDetail_viewDettaglioDatiPatentePosseduta.action?numeroPatenteCompleto=XX
 *
 * @param {object} client  — HTTP client con sessione attiva
 * @param {string} numeroPatente
 * @returns {object} datiPatente
 */
async function leggiDatiPatentePosseduta(client, { numeroPatente }) {
  const url = `${PORTAL_BASE}/RichiestaPatenti/richiestaCertificatoMedico/SelectFunctionDetail_viewDettaglioDatiPatentePosseduta.action?numeroPatenteCompleto=${encodeURIComponent(numeroPatente || "")}`;
  const res  = await client.get(url);
  const html = typeof res === "string" ? res : res?.data || "";
  const $    = cheerio.load(html);

  function fieldVal(name) {
    return normalizeText($(`[name='${name}']`).val() || $(`[name='${name}']`).text());
  }

  const dati = {
    numero_patente:       fieldVal("patentePossedutaView.patentePossedutaFrom.numeroPatenteCompleto"),
    tipo_patente:         fieldVal("patentePossedutaView.patentePossedutaFrom.theTipoPatente.descrizione"),
    data_rilascio:        fieldVal("patentePossedutaView.patentePossedutaFrom.dataRilascioString"),
    data_scadenza:        fieldVal("patentePossedutaView.patentePossedutaFrom.dataScadenzaString"),
    ufficio_rilascio:     fieldVal("patentePossedutaView.patentePossedutaFrom.theUfficioRilascio.descrizione"),
    provincia_rilascio:   fieldVal("patentePossedutaView.patentePossedutaFrom.theUfficioRilascio.theProvincia.descrizione"),
    categorie:            [],
  };

  // Estrai categorie abilitate dalla tabella
  $("table#listCategoriePatente tbody tr, table tbody tr").each(function () {
    const $tds = $(this).find("td");
    if ($tds.length < 2) return;
    const cat = normalizeText($tds.eq(0).text());
    const dataAb = normalizeText($tds.eq(1).text());
    const dataScad = normalizeText($tds.eq(2).text());
    if (cat && /^[A-Z]/.test(cat)) {
      dati.categorie.push({ categoria: cat, data_abilitazione: dataAb, data_scadenza: dataScad });
    }
  });

  // Fallback: campo singolo categoria
  if (dati.categorie.length === 0) {
    const catStr = fieldVal("patentePossedutaView.patentePossedutaFrom.categorieAmplificate");
    if (catStr) {
      dati.categorie_str = catStr;
    }
  }

  return dati;
}

// =============================================================================
// PUNTO 10 — ESITI ESAMI SVOLTI
// =============================================================================

const VERBALI_SVOLTI_URL = `${PORTAL_BASE}/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action`;
const VERBALI_FORM_ACTION = `/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action`;

/**
 * Legge la lista dei verbali svolti (sessioni di esame completate).
 * Replica leggiEsamiSvoltiQuiz / leggiEsamiSvoltiGuida di iPatente.
 *
 * @param {object} client
 * @param {object} options
 *   tipo: "quiz" | "guida" | "scritto" | "cqc" (default: "quiz")
 *   dataInizio: "DD/MM/YYYY" o "YYYY-MM-DD"
 *   dataFine:   "DD/MM/YYYY" o "YYYY-MM-DD"
 *   withCandidati: boolean (default false — solo header sessioni, true = dettaglio per ogni verbale)
 *
 * @returns {Array} sessioni
 */
async function leggiEsamiSvolti(client, options = {}) {
  const {
    tipo = "quiz",
    dataInizio,
    dataFine,
    withCandidati = false,
  } = options;

  // Mappa tipo → indicatoreTipoSessione Struts2
  const tipoMap = {
    quiz:     "VSC",
    guida:    "VSC",  // stessa URL, stesso tipo; la distinzione è nel dato
    scritto:  "VSQ",
    cqc:      "SCQC",
  };
  const indicatore = tipoMap[tipo] || "VSC";

  // Step 1: GET pagina di ricerca per ottenere il token CSRF
  const searchRes = await client.get(`${VERBALI_SVOLTI_URL}?pageStatus=SEARCH`);
  const searchHtml = typeof searchRes === "string" ? searchRes : searchRes?.data || "";
  const $search = cheerio.load(searchHtml);

  const token = $search("[name='struts.token.name']").val()
    || $search("[name='struts.token']").val()
    || "";
  const tokenName = $search("[name='struts.token.name']").val()
    ? $search("[name='struts.token.name']").next().val()
    : "";

  // Ufficio provinciale dal form
  const uffProv = $search("[name='sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.theUfficioCompetenteMCTCAN.codUfficioMCTC']").val() || "";

  // Step 2: POST per ricerca con date (se fornite)
  let html = searchHtml;
  if (dataInizio || dataFine) {
    const payload = new URLSearchParams({
      "struts.token.name": "tokenListSessioneEsameAbilitazioneEP",
      "sessioneEsameAbilitazioneEPView.indicatoreTipoSessione": indicatore,
      "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.theUfficioCompetenteMCTCAN.codUfficioMCTC": uffProv,
    });
    if (dataInizio) {
      payload.append(
        "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.dataSessioneEsameFrom",
        toPortalDateParam(dataInizio).replace(/%2F/g, "/")
      );
    }
    if (dataFine) {
      payload.append(
        "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.dataSessioneEsameTo",
        toPortalDateParam(dataFine).replace(/%2F/g, "/")
      );
    }
    payload.append("action:ReadVerbaliSvolti_searchVerbaliSvoltiConseguimento", "Ricerca");

    const postRes = await client.post(VERBALI_SVOLTI_URL, serializePayloadRaw(payload), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    html = typeof postRes === "string" ? postRes : postRes?.data || "";
  }

  const $ = cheerio.load(html);
  const sessioni = [];

  // Estrai righe dalla tabella principale
  $("#listTable > tbody tr").each(function () {
    const $tds = $(this).find("td");
    const id_verbale = $(this).find("td > input").val() || "";
    if (!id_verbale) return;

    const sessione = {
      id_verbale:   normalizeText(id_verbale),
      data_verbale: normalizeText($tds.eq(1).text()),
      descrizione:  normalizeText($tds.eq(2).text()),
      fascia_oraria:normalizeText($tds.eq(3).text()),
      n_verbale:    normalizeText($tds.eq(4).text()),
      cand_pren:    normalizeText($tds.eq(5).text()),
      stato:        normalizeText($tds.eq(6).text()),
      uff_prov:     normalizeText($tds.eq(7).text()),
      localita:     normalizeText($tds.eq(8).text()),
      desc_localita:normalizeText($tds.eq(9).text()),
      indirizzo:    normalizeText($tds.eq(10).text()),
      tipo,
      candidati: [],
    };

    sessioni.push(sessione);
  });

  // Step 3 (opzionale): carica dettaglio per ogni verbale
  if (withCandidati && sessioni.length > 0) {
    const uffProvMain = $("[name='sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.theUfficioCompetenteMCTCAN.codUfficioMCTC']").val() || uffProv;

    for (const sessione of sessioni) {
      try {
        const detPayload = new URLSearchParams({
          "struts.token.name": "tokenListSessioneEsameAbilitazioneEP",
          "sessioneEsameAbilitazioneEPView.indicatoreTipoSessione": indicatore,
          "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.selectRowId": sessione.id_verbale,
          "action:Select_viewDetailVerbale": "Dettaglio",
          "disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.theDisponibilitaEsaminatoreEP.codUfficioMCTC": uffProvMain,
        });

        const detRes = await client.post(VERBALI_FORM_ACTION, serializePayloadRaw(detPayload), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det = cheerio.load(detHtml);

        sessione.esaminatore = normalizeText(
          $det("[name='sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.theAbilitazioneEsaminatoreMCTCEP.descrizioneCompletaEsaminatore']").val()
        );

        $det("#listSedutaEsameAbilitazioneEP tbody tr").each(function () {
          const $tds = $det(this).find("td");
          const marcaOp = normalizeText($tds.eq(1).text());
          if (!marcaOp) return;

          // Quiz: col 12=esito_esame; Guida: col 10=esito_esame
          const isGuida = tipo === "guida";
          const candidato = {
            numero:         normalizeText($tds.eq(0).text()),
            marca_operativa:marcaOp,
            abilitazione:   normalizeText($tds.eq(2).text()),
            cognome:        normalizeText($tds.eq(6).text()),
            nome:           normalizeText($tds.eq(7).text()),
            data_nascita:   normalizeText($tds.eq(8).text()),
            stato_presente: normalizeText($tds.eq(isGuida ? 9 : 11).text()),
            esito_esame:    normalizeText($tds.eq(isGuida ? 10 : 12).text()),
            desc_stato:     normalizeText($tds.eq(isGuida ? 11 : 13).text()),
            codice_anomalia:normalizeText($tds.eq(isGuida ? 12 : 14).text()),
          };

          if (!isGuida) {
            candidato.lingua = normalizeText($tds.eq(9).text());
            candidato.audio  = normalizeText($tds.eq(10).text());
          }

          sessione.candidati.push(candidato);
        });
      } catch (_) {
        // ignora errori di singolo verbale
      }
    }
  }

  return sessioni;
}

// =============================================================================
// PUNTO 11 — ESAMI GUIDA PRENOTATI (esami candidato)
// =============================================================================

/**
 * Legge gli esami prenotati per un candidato specifico.
 * Replica leggiEsamiCandidato di portale_read.js.
 *
 * @param {object} client
 * @param {object} options
 *   cf: codice fiscale candidato
 *   cognome: cognome candidato
 *   tipo: "SQI"|"SGOS"|"SCQC"|"SQA" (default: "SGOS" per guida)
 *
 * @returns {Array} esami prenotati
 */
async function leggiEsamiCandidato(client, options = {}) {
  const { cf = "", cognome = "", tipo = "SGOS" } = options;

  const searchUrl = `${PORTAL_BASE}/prenotazione/prenotazioneCandidatoEP/Read_initAction.action?pageStatus=SEARCH`;
  const formAction = `/prenotazione/prenotazioneCandidatoEP/Read_initAction.action`;

  // Step 1: GET pagina ricerca
  const initRes  = await client.get(searchUrl);
  const initHtml = typeof initRes === "string" ? initRes : initRes?.data || "";
  const $init    = cheerio.load(initHtml);

  const uffProv = $init("[name='prenotazioneCandidatoEPView.prenotazioneCandidatoEPFrom.theUfficioCompetenteMCTCAN.codUfficioMCTC']").val() || "";

  // Step 2: POST ricerca con CF o cognome
  const payload = new URLSearchParams({
    "struts.token.name": "tokenListPrenotazioneCandidatoEP",
    "prenotazioneCandidatoEPView.prenotazioneCandidatoEPFrom.theUfficioCompetenteMCTCAN.codUfficioMCTC": uffProv,
    "prenotazioneCandidatoEPView.prenotazioneCandidatoEPFrom.codiceFiscale": cf,
    "prenotazioneCandidatoEPView.prenotazioneCandidatoEPFrom.cognome": cognome,
    "prenotazioneCandidatoEPView.indicatoreTipoSessione": tipo,
    "action:ReadPrenotazioneCandidatoEP_searchPrenotazioneCandidatoEP": "Ricerca",
  });

  const postRes  = await client.post(formAction, serializePayloadRaw(payload), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const postHtml = typeof postRes === "string" ? postRes : postRes?.data || "";
  const $        = cheerio.load(postHtml);

  const esami = [];
  $("#listTable > tbody tr").each(function () {
    const $tds = $(this).find("td");
    const id_pren = $(this).find("td > input").val() || "";

    const esame = {
      id_prenotazione:  id_pren,
      data_esame:       normalizeText($tds.eq(1).text()),
      descrizione:      normalizeText($tds.eq(2).text()),
      fascia_oraria:    normalizeText($tds.eq(3).text()),
      marca_operativa:  normalizeText($tds.eq(4).text()),
      cognome:          normalizeText($tds.eq(5).text()),
      nome:             normalizeText($tds.eq(6).text()),
      data_nascita:     normalizeText($tds.eq(7).text()),
      stato:            normalizeText($tds.eq(8).text()),
      localita:         normalizeText($tds.eq(9).text()),
      tipo_sessione:    tipo,
    };

    if (esame.marca_operativa || esame.cognome) {
      esami.push(esame);
    }
  });

  return esami;
}

// =============================================================================
// PUNTO 12 — RINNOVI ATTIVI
// =============================================================================

/**
 * Legge l'elenco dei rinnovi attivi in un periodo.
 * Replica leggiRinnoviAttivi di portale_read.js.
 *
 * @param {object} client
 * @param {object} options
 *   dataInizio: "YYYY-MM-DD" o "DD/MM/YYYY"
 *   dataFine:   "YYYY-MM-DD" o "DD/MM/YYYY"
 *   withDettaglio: boolean (default true — recupera dati completi per ogni rinnovo)
 *
 * @returns {Array} rinnovi
 */
async function leggiRinnoviAttivi(client, options = {}) {
  const {
    dataInizio,
    dataFine,
    withDettaglio = true,
  } = options;

  const di = toPortalDateParam(dataInizio || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const df = toPortalDateParam(dataFine   || new Date().toISOString().slice(0, 10));

  const searchUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action` +
    `?struts.token.name=tokenListGestRinnAgenzia` +
    `&richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
    `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
    `&richiestaView.cognome=` +
    `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
    `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=A` +
    `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${di}` +
    `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${df}` +
    `&action%3AReadGestRinnAgenzia_pagingGestRinnAgenzia=Ricerca`;

  const res  = await client.get(searchUrl);
  const html = typeof res === "string" ? res : res?.data || "";
  const $    = cheerio.load(html);

  const rinnovi = [];

  // Estrai righe elenco
  $("#listTable > tbody tr").each(function () {
    const $tds = $(this).find("td");
    const marcaOp = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());

    if (!marcaOp) return;

    rinnovi.push({
      marca_operativa: marcaOp,
      cognome:         normalizeText($tds.eq(1).text()),
      nome:            normalizeText($tds.eq(2).text()),
      patente:         normalizeText($tds.eq(3).text()),
      data_inserimento:normalizeText($tds.eq(4).text()),
      stato:           normalizeText($tds.eq(5).text()),
      dettaglio:       null,
    });
  });

  // Step 2 (opzionale): carica dettaglio per ogni rinnovo
  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action`;

    for (const rinnovo of rinnovi) {
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        function fv(name) {
          return normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());
        }

        rinnovo.dettaglio = {
          codice_fiscale:    fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale"),
          data_nascita:      fv("richiestaView.dataNascita"),
          sesso:             fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.sesso"),
          comune_nascita:    fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.descrizioneComune"),
          provincia_nascita: fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.descrizione"),
          comune_residenza:  fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.descrizioneComune"),
          provincia_residenza: fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.theProvincia.descrizione"),
          cap:               fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.cap"),
          indirizzo:         fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.indirizzo"),
          patente_posseduta: fv("richiestaView.richiestaRinnAgenziaFrom.thePatentePosseduta.numeroPatenteCompleto"),
          patente_emessa:    fv("richiestaView.richiestaRinnAgenziaFrom.patente"),
          data_inserimento:  fv("richiestaView.richiestaRinnAgenziaFrom.dataInserimento"),
        };
      } catch (_) {
        // ignora errori singoli
      }
    }
  }

  return rinnovi;
}

// =============================================================================
// PUNTO 7 — RICEVUTA SOSTITUTIVA
// =============================================================================

/**
 * Legge la ricevuta sostitutiva di un candidato.
 * URL: /ricevute/ricevutaSostitutivaDocumentoGuida/Search_initAction.action
 *
 * @param {object} client
 * @param {object} options
 *   cf: codice fiscale
 *   cognome: cognome
 *   numeroPatente: numero patente
 *
 * @returns {object} ricevuta
 */
async function leggiRicevutaSostitutiva(client, options = {}) {
  const { cf = "", cognome = "", numeroPatente = "" } = options;

  const searchUrl = `${PORTAL_BASE}/ricevute/ricevutaSostitutivaDocumentoGuida/Search_initAction.action?pageStatus=SEARCH`;
  const formAction = `/ricevute/ricevutaSostitutivaDocumentoGuida/Search_initAction.action`;

  const initRes  = await client.get(searchUrl);
  const initHtml = typeof initRes === "string" ? initRes : initRes?.data || "";
  const $init    = cheerio.load(initHtml);

  const payload = new URLSearchParams({
    "struts.token.name": "tokenRicevutaSostitutiva",
    "ricevutaSostitutivaDocumentoGuidaView.cognome": cognome,
    "ricevutaSostitutivaDocumentoGuidaView.codiceFiscale": cf,
    "ricevutaSostitutivaDocumentoGuidaView.numeroPatenteCompleto": numeroPatente,
    "action:Search_searchRicevutaSostitutiva": "Ricerca",
  });

  // Includi token CSRF se trovato
  const tokenVal = $init("[name='struts.token']").val();
  if (tokenVal) payload.set("struts.token", tokenVal);

  const postRes  = await client.post(formAction, serializePayloadRaw(payload), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const html = typeof postRes === "string" ? postRes : postRes?.data || "";
  const $    = cheerio.load(html);

  const ricevute = [];
  $("#listTable > tbody tr").each(function () {
    const $tds = $(this).find("td");
    ricevute.push({
      numero_ricevuta:  normalizeText($tds.eq(0).text()),
      cognome:          normalizeText($tds.eq(1).text()),
      nome:             normalizeText($tds.eq(2).text()),
      codice_fiscale:   normalizeText($tds.eq(3).text()),
      data_rilascio:    normalizeText($tds.eq(4).text()),
      data_scadenza:    normalizeText($tds.eq(5).text()),
      tipo_documento:   normalizeText($tds.eq(6).text()),
    });
  });

  return ricevute;
}

// =============================================================================
// PUNTO 14 — ALLIEVI PRENOTATI PER AUTOSCUOLA
// =============================================================================

/**
 * Legge l'elenco degli allievi prenotati per una sessione.
 * Wrapper attorno alle sessioni quiz (SQI) e guide (SGOS) già presenti
 * in portalHttp.js, con filtro per codice autoscuola.
 *
 * @param {object} client
 * @param {object} options
 *   tipo: "SQI" (quiz) | "SGOS" (guida) | "SCQC" (CQC)
 *   dataInizio, dataFine
 *   codiceAutoscuola: filtra per autoscuola
 *
 * @returns {Array} allievi prenotati
 */
async function leggiAllieviPrenotati(client, options = {}) {
  const { tipo = "SQI", dataInizio, dataFine, codiceAutoscuola } = options;

  // Usa endpoint sessioni già esistente
  const { readSessioniQuizInterne, readVerbali, readSessioniApprovate, readSessioniCqc } = require("./portalHttp");

  let sessioni = [];
  try {
    if (tipo === "SQI") {
      sessioni = await readSessioniQuizInterne(client, { stato: "PROGRAMMATE" });
    } else if (tipo === "SGOS") {
      sessioni = await readVerbali(client, { indicatoreTipoSessione: "VAC" });
    } else if (tipo === "SQA") {
      sessioni = await readSessioniApprovate(client);
    } else if (tipo === "SCQC") {
      sessioni = await readSessioniCqc(client);
    }
  } catch (_) {}

  // Flatten candidati
  const allievi = [];
  for (const s of (sessioni || [])) {
    for (const c of (s.candidati || s.students || [])) {
      if (!c) continue;
      if (codiceAutoscuola) {
        const autoscuola = c.codice_autoscuola || c.autoscuola || "";
        if (autoscuola && !autoscuola.includes(codiceAutoscuola)) continue;
      }
      allievi.push({
        ...c,
        sessione_data:  s.data_sessione || s.date || "",
        sessione_tipo:  tipo,
        sessione_id:    s.id_sessione || s.id || "",
      });
    }
  }

  return allievi;
}

// =============================================================================
// PUNTO 8 — CERTIFICATO MEDICO TT2112
// =============================================================================

/**
 * Legge i dati del certificato medico TT2112 dal portale.
 * URL: /RichiestaPatenti/richiestaCertificatoMedico/ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia.action
 *
 * @param {object} client
 * @param {object} options
 *   protocollo: numero protocollo certificato medico
 *   prgRicCerMed: progressivo ricerca certificato
 *
 * @returns {object} datiCertificato
 */
async function leggiCertificatoMedico(client, options = {}) {
  const { protocollo = "", prgRicCerMed = "" } = options;

  const baseUrl = `${PORTAL_BASE}/RichiestaPatenti/richiestaCertificatoMedico`;
  const searchUrl = `${baseUrl}/ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia.action?pageStatus=SEARCH`;

  // Step 1: GET pagina ricerca
  const initRes  = await client.get(searchUrl);
  const initHtml = typeof initRes === "string" ? initRes : initRes?.data || "";
  const $init    = cheerio.load(initHtml);

  // Step 2: Se fornito il progressivo, cerca direttamente
  if (prgRicCerMed) {
    await client.evaluate?.(`
      $("#ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia_richiestaCertificatoMedicoView_richiestaCertificatoMedicoFrom_prgRicCerMed").val("${prgRicCerMed}");
      $("#ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia_button_value_searchElement").click();
    `).catch(() => null);
  }

  // Usa POST per ricerca
  const payload = new URLSearchParams({
    "struts.token.name": "tokenGestCertificatoAgenzia",
    "richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.prgRicCerMed": prgRicCerMed,
    "richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.protocolloCertMed": protocollo,
    "action:ReadGestCertificatoAgenzia_searchGestCertificatoFromAgenzia": "Ricerca",
  });

  const tokenVal = $init("[name='struts.token']").val();
  if (tokenVal) payload.set("struts.token", tokenVal);

  const postRes  = await client.post(
    `${baseUrl}/ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia.action`,
    serializePayloadRaw(payload),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const html = typeof postRes === "string" ? postRes : postRes?.data || "";
  const $    = cheerio.load(html);

  function fv(name) {
    return normalizeText($(`[name='${name}']`).val() || $(`[name='${name}']`).text());
  }

  const risultati = [];

  // Estrai dalla tabella risultati
  $("#listTable > tbody tr").each(function () {
    const $tds = $(this).find("td");
    risultati.push({
      progressivo:        normalizeText($tds.eq(0).text()),
      protocollo:         normalizeText($tds.eq(1).text()),
      cognome:            normalizeText($tds.eq(2).text()),
      nome:               normalizeText($tds.eq(3).text()),
      codice_fiscale:     normalizeText($tds.eq(4).text()),
      data_visita:        normalizeText($tds.eq(5).text()),
      medico:             normalizeText($tds.eq(6).text()),
      commissione:        normalizeText($tds.eq(7).text()),
      idoneita:           normalizeText($tds.eq(8).text()),
    });
  });

  // Se nessun risultato in tabella, leggi dal form diretto
  if (risultati.length === 0 && (fv("richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.prgRicCerMed") || protocollo)) {
    return [{
      progressivo:        fv("richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.prgRicCerMed"),
      protocollo:         fv("richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.protocolloCertMed"),
      data_visita:        fv("richiestaPerEsameView.richiestaFrom.dataVisitaMedicaString"),
      iscrizione_albo:    fv("richiestaPerEsameView.richiestaFrom.codiceIscrizioneAlbo"),
      uff_sanitario:      fv("richiestaPerEsameView.richiestaFrom.codiceTipoUfficialeSanitario"),
    }];
  }

  return risultati;
}

// =============================================================================
// PUNTO 13 — SYNC BIDIREZIONALE (leggiDatiClienteSync)
// =============================================================================

/**
 * Sync completo dati candidato dal portale: patente + ricevuta sostitutiva.
 * Replica il flusso leggiDatiClienteSync di iPatente.
 *
 * @param {object} client
 * @param {object} options
 *   cognome: cognome candidato
 *   numeroPatente: numero patente
 *   cf: codice fiscale
 *
 * @returns { patente, ricevute, datiForm }
 */
async function syncDatiCliente(client, options = {}) {
  const { cognome = "", numeroPatente = "", cf = "" } = options;

  const result = { patente: null, ricevute: [], datiForm: {} };

  // 1. Leggi dati patente posseduta
  if (numeroPatente) {
    try {
      result.patente = await leggiDatiPatentePosseduta(client, { numeroPatente });
    } catch (_) {}
  }

  // 2. Leggi ricevuta sostitutiva
  try {
    result.ricevute = await leggiRicevutaSostitutiva(client, { cf, cognome, numeroPatente });
  } catch (_) {}

  // 3. Leggi dati dal form richiesta esame (per medico_data_visita, ecc.)
  const ricercaUrl = `${PORTAL_BASE}/RichiestaPatenti/richiestaEsame/Read_initAction.action` +
    `?struts.token.name=tokenrichiestaEsame&pageStatus=NEW` +
    `&richiestaPerEsameView.cognome=${encodeURIComponent(cognome)}` +
    `&richiestaPerEsameView.richiestaFrom.thePatentePosseduta.numeroPatenteCompleto=${encodeURIComponent(numeroPatente)}` +
    `&action%3AIns_checkRicercaRichiestaEsame=Ricerca`;

  try {
    const res  = await client.get(ricercaUrl);
    const html = typeof res === "string" ? res : res?.data || "";
    const $    = cheerio.load(html);

    function fv(name) {
      return normalizeText($(`[name='${name}']`).val() || "");
    }

    result.datiForm = {
      medico_data_visita:   fv("richiestaPerEsameView.richiestaFrom.dataVisitaMedicaString"),
      medico_iscrizione_albo: fv("richiestaPerEsameView.richiestaFrom.codiceIscrizioneAlbo"),
      medico_uff_sanitario: fv("richiestaPerEsameView.richiestaFrom.codiceTipoUfficialeSanitario"),
      marca_operativa:      fv("richiestaPerEsameView.richiestaFrom.marcaOperativa"),
      codice_fiscale:       fv("richiestaPerEsameView.richiestaFrom.theAnagrafica.codiceFiscale"),
      cognome:              fv("richiestaPerEsameView.richiestaFrom.theAnagrafica.cognome"),
      nome:                 fv("richiestaPerEsameView.richiestaFrom.theAnagrafica.nome"),
    };
  } catch (_) {}

  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

// =============================================================================
// GENERAZIONE RICEVUTA SOSTITUTIVA
// =============================================================================

/**
 * Genera una nuova ricevuta sostitutiva del documento di guida sul portale.
 * URL: /ricevute/ricevutaSostitutivaDocumentoGuida/Insert_insertAction.action
 *
 * @param {object} client    - axios client autenticato
 * @param {object} options
 *   cf:            codice fiscale del candidato
 *   cognome:       cognome
 *   nome:          nome
 *   numeroPatente: numero patente / foglio rosa
 *   tipoDocumento: "P" = Patente | "F" = Foglio Rosa (default "F")
 *   dataRilascio:  data rilascio in formato gg/mm/yyyy (default oggi)
 *
 * @returns {{ success: boolean, numero_ricevuta: string, messaggio: string }}
 */
async function creaRicevutaSostitutiva(client, options = {}) {
  const {
    cf = "",
    cognome = "",
    nome = "",
    numeroPatente = "",
    tipoDocumento = "F",
    dataRilascio = new Date().toLocaleDateString("it-IT"),
  } = options;

  const BASE_URL = `${PORTAL_BASE}/ricevute/ricevutaSostitutivaDocumentoGuida`;
  const FORM_URL = `${BASE_URL}/Insert_insertAction.action?pageStatus=NEW`;

  // 1. GET del form per recuperare il token CSRF
  const initRes  = await client.get(FORM_URL);
  const initHtml = typeof initRes === "string" ? initRes : (initRes?.data || "");
  const $init    = cheerio.load(initHtml);
  const csrfToken = $init("[name='struts.token']").val() || "";

  // 2. POST con i dati del candidato
  const payload = new URLSearchParams({
    "struts.token.name":                                      "tokenInsertRicevuta",
    ...(csrfToken ? { "struts.token": csrfToken } : {}),
    "ricevutaSostitutivaDocumentoGuidaView.cognome":          cognome,
    "ricevutaSostitutivaDocumentoGuidaView.nome":             nome,
    "ricevutaSostitutivaDocumentoGuidaView.codiceFiscale":    cf,
    "ricevutaSostitutivaDocumentoGuidaView.numeroPatenteCompleto": numeroPatente,
    "ricevutaSostitutivaDocumentoGuidaView.tipoDocumentoGuida":    tipoDocumento,
    "ricevutaSostitutivaDocumentoGuidaView.dataRilascioString":    dataRilascio,
    "action:Insert_insertRicevutaSostitutiva":                "Conferma",
  });

  const postRes  = await client.post(`${BASE_URL}/Insert_insertAction.action`, serializePayloadRaw(payload), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const html = typeof postRes === "string" ? postRes : (postRes?.data || "");
  const $    = cheerio.load(html);

  // 3. Estrai il numero ricevuta dal messaggio di conferma
  const okMsg   = $(".messaggio-ok, .alert-success, #messaggioOk").text().trim();
  const errMsg  = $(".messaggio-errore, .alert-danger, #messaggioErrore").text().trim();
  const numRic  = okMsg.match(/\b\d{4}[A-Z0-9]{6,}\b/)?.[0] ||
                  $("input[name*='numeroRicevuta'], td.numero-ricevuta").first().text().trim() || "";

  if (errMsg) {
    return { success: false, numero_ricevuta: "", messaggio: errMsg };
  }

  return {
    success:         !!okMsg || !!numRic,
    numero_ricevuta: numRic,
    messaggio:       okMsg || "Ricevuta sostitutiva generata",
  };
}

// =============================================================================
// PUNTO 13 — ANOMALIE PORTALE
// =============================================================================

/**
 * Legge le pratiche in anomalia dal Portale Automobilista.
 * URL: /RichiestaPatenti/richiesta/ReadGestAnomalia_initGestAnomalia.action
 *
 * @param {object} client — http client autenticato (jar)
 * @param {object} options — { dataInizio, dataFine }
 * @returns {Promise<Array>} lista anomalie
 */
async function leggiAnomaliePortale(client, options = {}) {
  const { dataInizio, dataFine } = options;
  const di = toPortalDateParam(dataInizio || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const df = toPortalDateParam(dataFine   || new Date().toISOString().slice(0, 10));

  // 1. Pagina di ricerca
  const searchUrl =
    `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestAnomalia_initGestAnomalia.action` +
    `?richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${di}` +
    `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${df}` +
    `&action%3AReadGestAnomalia_pagingGestAnomalia=Ricerca`;

  let html = "";
  try {
    const res = await client.get(searchUrl);
    html = typeof res === "string" ? res : (res?.data || "");
  } catch (e) {
    return [];
  }

  const $ = cheerio.load(html);
  const anomalie = [];

  // Tabella risultati — struttura analoga alle altre pagine Gestione
  $("#listTable > tbody tr, table.list > tbody tr").each(function () {
    const $tds = $(this).find("td");
    if ($tds.length < 3) return;

    // Colonna 0 potrebbe essere un input hidden (marca operativa)
    const marcaOp = $(this).find("input[type='hidden'], input:not([type])").first().val()
      || normalizeText($tds.eq(0).text());
    if (!marcaOp) return;

    anomalie.push({
      marca_operativa:     marcaOp,
      cognome:             normalizeText($tds.eq(1).text()),
      nome:                normalizeText($tds.eq(2).text()),
      tipo_richiesta:      normalizeText($tds.eq(3).text()),
      codice_anomalia:     normalizeText($tds.eq(4).text()),
      descrizione_anomalia:normalizeText($tds.eq(5).text()),
      data_inserimento:    normalizeText($tds.eq(6).text()),
      stato:               normalizeText($tds.eq(7).text()) || "ANOMALIA",
    });
  });

  // Fallback: se la struttura è diversa (es. pagina con parametri diversi),
  // prova a leggere tutti i tag <tr> con almeno 4 celle
  if (anomalie.length === 0) {
    $("table tr").each(function () {
      const $tds = $(this).find("td");
      if ($tds.length < 4) return;
      const marcaOp = normalizeText($tds.eq(0).text());
      if (!marcaOp || /marca|cod|cognome/i.test(marcaOp)) return; // skip header
      anomalie.push({
        marca_operativa:     marcaOp,
        cognome:             normalizeText($tds.eq(1).text()),
        nome:                normalizeText($tds.eq(2).text()),
        tipo_richiesta:      normalizeText($tds.eq(3).text()),
        codice_anomalia:     normalizeText($tds.eq(4).text()),
        descrizione_anomalia:normalizeText($tds.eq(5).text()),
        data_inserimento:    normalizeText($tds.eq(6).text()),
        stato:               "ANOMALIA",
      });
    });
  }

  return anomalie;
}

// =============================================================================
// ARCHIVIO STORICO — Rinnovi patente / medici / CQC (TUTTI gli stati, TUTTI gli anni)
// =============================================================================

/**
 * Scorre un intervallo temporale in finestre di N giorni e invoca `fetcher`
 * per ogni finestra. Accumula i risultati in un array unico (deduplicato per
 * chiave `marca_operativa`).
 *
 * Il portale in genere limita il range di ricerca (es. max 1 anno), quindi
 * l'iterazione a finestre è necessaria per coprire "tutto lo storico".
 *
 * @param {object} opts
 *   dataInizio: "YYYY-MM-DD"  (inclusa)
 *   dataFine:   "YYYY-MM-DD"  (inclusa)
 *   windowDays: numero giorni per finestra (default 180)
 *   fetcher:    async ({dataInizioWin, dataFineWin}) => Array
 *   onProgress: ({fineWindow, totale, raccolti, window: [di, df]}) => void
 *   keyField:   campo di deduplicazione (default "marca_operativa")
 */
async function iterateDateRange({
  dataInizio,
  dataFine,
  windowDays = 30,
  fetcher,
  onProgress = null,
  keyField = "marca_operativa",
}) {
  // SAFETY: il portale accetta max 31 giorni per query sui rinnovi.
  windowDays = Math.min(Math.max(1, Number(windowDays) || 30), 31);
  const parseISO = (s) => {
    if (!s) return null;
    const t = String(s).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00Z`);
    return null;
  };

  const start = parseISO(dataInizio) || new Date(Date.UTC(2000, 0, 1));
  const end   = parseISO(dataFine)   || new Date();

  if (start > end) return [];

  const map = new Map();
  const totalMs = end.getTime() - start.getTime();
  const winMs = windowDays * 86400000;
  const totalWindows = Math.ceil(totalMs / winMs) || 1;
  let winIdx = 0;

  let cursor = new Date(start);
  while (cursor <= end) {
    const winEnd = new Date(Math.min(cursor.getTime() + winMs - 86400000, end.getTime()));
    const di = cursor.toISOString().slice(0, 10);
    const df = winEnd.toISOString().slice(0, 10);

    let rows = [];
    try {
      rows = await fetcher({ dataInizioWin: di, dataFineWin: df }) || [];
    } catch (err) {
      console.warn(`[iterateDateRange] errore finestra ${di}→${df}:`, err.message);
    }

    for (const r of rows) {
      const k = r?.[keyField];
      if (k && !map.has(k)) map.set(k, r);
    }

    winIdx += 1;
    if (typeof onProgress === "function") {
      onProgress({
        fineWindow: df,
        totale: totalWindows,
        raccolti: map.size,
        window: [di, df],
        completate: winIdx,
      });
    }

    // next window
    cursor = new Date(winEnd.getTime() + 86400000);
  }

  return Array.from(map.values());
}

/**
 * Legge TUTTI i rinnovi patente dal Portale Automobilista, per TUTTI gli stati
 * (A/D/R/S/ecc.) e su TUTTO l'intervallo temporale richiesto.
 *
 * Differenze da leggiRinnoviAttivi:
 *   - Non hardcoda codiceStatoRinnAgenzia=A → legge tutti gli stati
 *   - Itera l'intervallo a finestre (default 180 giorni) perché il portale
 *     limita il range di ricerca
 *   - Deduplica per marca_operativa
 *
 * URL portale: ReadGestRinnAgenzia_initGestRinnAgenzia.action
 *
 * @param {object} client
 * @param {object} options
 *   dataInizio:  "YYYY-MM-DD" (default 2000-01-01 → tutto lo storico)
 *   dataFine:    "YYYY-MM-DD" (default oggi)
 *   stati:       array di codici stato da leggere (default ["A","D","R","S",""])
 *                ("" = nessun filtro = tutti gli stati nella stessa chiamata)
 *   windowDays:  finestra temporale in giorni (default 180)
 *   withDettaglio: se true (default true), scarica la scheda dettaglio di ogni rinnovo
 *   onProgress:  callback ({fase, finestra, raccolti, totale})
 *
 * @returns {Array} rinnovi con campi base + dettaglio (se withDettaglio)
 */
async function leggiRinnoviStoriciPatente(client, options = {}) {
  const {
    dataInizio   = "2000-01-01",
    dataFine     = new Date().toISOString().slice(0, 10),
    // NOTA: il portale ammette solo alcuni codici stato; "" (tutti) di solito
    // non è supportato. Iteriamo i codici noti e deduplichiamo per marca_operativa.
    stati        = ["A", "D", "S", "R"],
    // MAX 31 giorni per finestra (limite hardcoded del portale)
    windowDays   = 30,
    withDettaglio = true,
    onProgress   = null,
  } = options;
  const windowDaysClamped = Math.min(Math.max(1, Number(windowDays) || 30), 31);

  const all = new Map(); // key: marca_operativa

  // Per ogni stato richiesto, itera l'intervallo a finestre
  for (const stato of stati) {
    const rinnoviStato = await iterateDateRange({
      dataInizio,
      dataFine,
      windowDays: windowDaysClamped,
      fetcher: async ({ dataInizioWin, dataFineWin }) => {
        const di = toPortalDateParam(dataInizioWin);
        const df = toPortalDateParam(dataFineWin);

        const searchUrl =
          `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action` +
          `?struts.token.name=tokenListGestRinnAgenzia` +
          `&richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
          `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
          `&richiestaView.cognome=` +
          `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
          `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=${encodeURIComponent(stato)}` +
          `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${di}` +
          `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${df}` +
          `&action%3AReadGestRinnAgenzia_pagingGestRinnAgenzia=Ricerca`;

        const res  = await client.get(searchUrl);
        const html = typeof res === "string" ? res : res?.data || "";
        const $    = cheerio.load(html);

        const rows = [];
        $("#listTable > tbody tr").each(function () {
          const $tds = $(this).find("td");
          const marcaOp = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
          if (!marcaOp) return;
          // Colonne effettive: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
          rows.push({
            marca_operativa:  marcaOp,
            protocollo:       normalizeText($tds.eq(1).text()),
            estremo_pagamento: normalizeText($tds.eq(2).text()),
            stato_richiesta:  normalizeText($tds.eq(3).text()),
            data_inserimento: normalizeText($tds.eq(4).text()),
            cognome:          normalizeText($tds.eq(5).text()),
            nome:             normalizeText($tds.eq(6).text()),
            // alias legacy per retro-compatibilità con upsertRinnovoPortale
            stato:            normalizeText($tds.eq(3).text()),
            stato_portale:    stato || null,
            tipo_rinnovo:     "patente",
          });
        });
        return rows;
      },
      onProgress: (p) => {
        if (typeof onProgress === "function") {
          onProgress({ fase: `rinnovi_patente_${stato || "all"}`, ...p });
        }
      },
    });

    for (const r of rinnoviStato) {
      if (!all.has(r.marca_operativa)) all.set(r.marca_operativa, r);
    }
  }

  const rinnovi = Array.from(all.values());

  // Scarica dettaglio se richiesto
  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action`;
    for (let i = 0; i < rinnovi.length; i += 1) {
      const rinnovo = rinnovi[i];
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        const fv = (name) =>
          normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());

        rinnovo.dettaglio = {
          codice_fiscale:      fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale"),
          data_nascita:        fv("richiestaView.dataNascita"),
          sesso:               fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.sesso"),
          comune_nascita:      fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.descrizioneComune"),
          provincia_nascita:   fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.descrizione"),
          comune_residenza:    fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.descrizioneComune"),
          provincia_residenza: fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.theProvincia.descrizione"),
          cap:                 fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.cap"),
          indirizzo:           fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.indirizzo"),
          patente_posseduta:   fv("richiestaView.richiestaRinnAgenziaFrom.thePatentePosseduta.numeroPatenteCompleto"),
          patente_emessa:      fv("richiestaView.richiestaRinnAgenziaFrom.patente"),
          data_inserimento:    fv("richiestaView.richiestaRinnAgenziaFrom.dataInserimento"),
        };
      } catch (_) {
        // ignora errori singoli rinnovo
      }
      if (typeof onProgress === "function" && i % 5 === 0) {
        onProgress({
          fase: "rinnovi_patente_dettaglio",
          completate: i + 1,
          totale: rinnovi.length,
          raccolti: i + 1,
        });
      }
    }
  }

  return rinnovi;
}

/**
 * Legge TUTTI i rinnovi con certificato medico (TT2112) dal portale.
 * URL portale: ReadGestRinnMed_initVerStatoPratHDDG.action
 *   action: ReadGestRinnMed_pagingGestRinnMedHd=Ricerca
 *
 * Replica GeCA connessioneportalenew.cs:12551
 */
async function leggiRinnoviStoriciMedici(client, options = {}) {
  const {
    dataInizio   = "2000-01-01",
    dataFine     = new Date().toISOString().slice(0, 10),
    stati        = ["A", "D", "S", "R"],
    windowDays   = 30,
    withDettaglio = true,
    onProgress   = null,
  } = options;
  const windowDaysClamped = Math.min(Math.max(1, Number(windowDays) || 30), 31);

  const all = new Map();

  for (const stato of stati) {
    const rows = await iterateDateRange({
      dataInizio,
      dataFine,
      windowDays: windowDaysClamped,
      fetcher: async ({ dataInizioWin, dataFineWin }) => {
        const di = toPortalDateParam(dataInizioWin);
        const df = toPortalDateParam(dataFineWin);

        const searchUrl =
          `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_initVerStatoPratHDDG.action` +
          `?richiestaView.richiestaRinnMedFrom.marcaOperativa=` +
          `&richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale=` +
          `&richiestaView.richiestaRinnMedFrom.patentePosseduta=` +
          `&richiestaView.cognome=` +
          `&richiestaView.richiestaRinnMedFrom.codiceStatoRinnMed=${encodeURIComponent(stato)}` +
          `&richiestaView.richiestaRinnMedFrom.dataInserimento=${di}` +
          `&richiestaView.richiestaRinnMedTo.dataInserimento=${df}` +
          `&action%3AReadGestRinnMed_pagingGestRinnMedHd=Ricerca`;

        const res  = await client.get(searchUrl);
        const html = typeof res === "string" ? res : res?.data || "";
        const $    = cheerio.load(html);

        const parsed = [];
        $("#listTable > tbody tr").each(function () {
          const $tds = $(this).find("td");
          const marcaOp = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
          if (!marcaOp) return;
          // Colonne: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
          parsed.push({
            marca_operativa:  marcaOp,
            protocollo:       normalizeText($tds.eq(1).text()),
            estremo_pagamento: normalizeText($tds.eq(2).text()),
            stato_richiesta:  normalizeText($tds.eq(3).text()),
            data_inserimento: normalizeText($tds.eq(4).text()),
            cognome:          normalizeText($tds.eq(5).text()),
            nome:             normalizeText($tds.eq(6).text()),
            stato:            normalizeText($tds.eq(3).text()),
            stato_portale:    stato || null,
            tipo_rinnovo:     "medico",
          });
        });
        return parsed;
      },
      onProgress: (p) => {
        if (typeof onProgress === "function") {
          onProgress({ fase: `rinnovi_medici_${stato || "all"}`, ...p });
        }
      },
    });

    for (const r of rows) if (!all.has(r.marca_operativa)) all.set(r.marca_operativa, r);
  }

  const rinnovi = Array.from(all.values());

  // Dettaglio rinnovo medico (scheda singola)
  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_pagingGestRinnMedHd.action`;
    for (let i = 0; i < rinnovi.length; i += 1) {
      const rinnovo = rinnovi[i];
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnMedFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichRinnMed_viewElementRichRinnMed=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        const fv = (name) =>
          normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());

        rinnovo.dettaglio = {
          codice_fiscale:      fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale"),
          data_nascita:        fv("richiestaView.dataNascita"),
          patente_posseduta:   fv("richiestaView.richiestaRinnMedFrom.thePatentePosseduta.numeroPatenteCompleto"),
          data_inserimento:    fv("richiestaView.richiestaRinnMedFrom.dataInserimento"),
          data_visita_medica:  fv("richiestaView.richiestaRinnMedFrom.dataVisitaMedica"),
          numero_certificato:  fv("richiestaView.richiestaRinnMedFrom.numeroCertificato"),
          medico_codice:       fv("richiestaView.richiestaRinnMedFrom.codiceMedico"),
        };
      } catch (_) { /* ignore */ }
      if (typeof onProgress === "function" && i % 5 === 0) {
        onProgress({
          fase: "rinnovi_medici_dettaglio",
          completate: i + 1,
          totale: rinnovi.length,
          raccolti: i + 1,
        });
      }
    }
  }

  return rinnovi;
}

/**
 * Legge TUTTI i rinnovi/conseguimenti CQC dal portale.
 * URL portale: richiestaCQC/ReadRichPatCqc_initRichPatCqc.action
 *
 * Replica GeCA connessioneportalenew.cs:433
 * (GeCA usa solo pagingRichPatCqc con marca singola → noi aggiungiamo il form
 *  di ricerca lista su periodo).
 */
async function leggiRinnoviStoriciCqc(client, options = {}) {
  const {
    dataInizio   = "2000-01-01",
    dataFine     = new Date().toISOString().slice(0, 10),
    stati        = ["A", "D", "S", "R"],
    windowDays   = 30,
    withDettaglio = true,
    onProgress   = null,
  } = options;
  const windowDaysClamped = Math.min(Math.max(1, Number(windowDays) || 30), 31);

  const all = new Map();

  for (const stato of stati) {
    const rows = await iterateDateRange({
      dataInizio,
      dataFine,
      windowDays: windowDaysClamped,
      fetcher: async ({ dataInizioWin, dataFineWin }) => {
        const di = toPortalDateParam(dataInizioWin);
        const df = toPortalDateParam(dataFineWin);

        // Init action del form CQC
        const searchUrl =
          `${PORTAL_BASE}/RichiestaPatenti/richiestaCQC/ReadRichPatCqc_initRichPatCqc.action` +
          `?richiestaCQCView.richiestaCQCFrom.marcaOperativa=` +
          `&richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale=` +
          `&richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta=` +
          `&richiestaCQCView.cognome=` +
          `&richiestaCQCView.richiestaCQCFrom.theTipoStatoRichiesta.codice=${encodeURIComponent(stato)}` +
          `&richiestaCQCView.richiestaCQCFrom.dataInserimento=${di}` +
          `&richiestaCQCView.richiestaCQCTo.dataInserimento=${df}` +
          `&action%3AReadRichPatCqc_pagingRichPatCqc=Ricerca`;

        let parsed = [];
        try {
          const res  = await client.get(searchUrl);
          const html = typeof res === "string" ? res : res?.data || "";
          const $    = cheerio.load(html);

          $("#listTable > tbody tr").each(function () {
            const $tds = $(this).find("td");
            const marcaOp = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
            if (!marcaOp) return;
            // Colonne: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
            parsed.push({
              marca_operativa:  marcaOp,
              protocollo:       normalizeText($tds.eq(1).text()),
              estremo_pagamento: normalizeText($tds.eq(2).text()),
              stato_richiesta:  normalizeText($tds.eq(3).text()),
              data_inserimento: normalizeText($tds.eq(4).text()),
              cognome:          normalizeText($tds.eq(5).text()),
              nome:             normalizeText($tds.eq(6).text()),
              stato:            normalizeText($tds.eq(3).text()),
              stato_portale:    stato || null,
              tipo_rinnovo:     "cqc",
            });
          });

          // Fallback generico se il #listTable non esiste
          if (parsed.length === 0) {
            $("table tr").each(function () {
              const $tds = $(this).find("td");
              if ($tds.length < 6) return;
              const marcaOp =
                $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
              if (!marcaOp || /marca|cod|cognome/i.test(marcaOp)) return;
              parsed.push({
                marca_operativa:  marcaOp,
                protocollo:       normalizeText($tds.eq(1).text()),
                estremo_pagamento: normalizeText($tds.eq(2).text()),
                stato_richiesta:  normalizeText($tds.eq(3).text()),
                data_inserimento: normalizeText($tds.eq(4).text()),
                cognome:          normalizeText($tds.eq(5).text()),
                nome:             normalizeText($tds.eq(6).text()),
                stato:            normalizeText($tds.eq(3).text()),
                stato_portale:    stato || null,
                tipo_rinnovo:     "cqc",
              });
            });
          }
        } catch (err) {
          console.warn(`[leggiRinnoviStoriciCqc] errore ${di}-${df}:`, err.message);
        }
        return parsed;
      },
      onProgress: (p) => {
        if (typeof onProgress === "function") {
          onProgress({ fase: `rinnovi_cqc_${stato || "all"}`, ...p });
        }
      },
    });

    for (const r of rows) if (!all.has(r.marca_operativa)) all.set(r.marca_operativa, r);
  }

  const rinnovi = Array.from(all.values());

  // Dettaglio CQC (replica GeCA linea 433)
  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiestaCQC/ReadRichPatCqc_pagingRichPatCqc.action`;
    for (let i = 0; i < rinnovi.length; i += 1) {
      const rinnovo = rinnovi[i];
      try {
        const detUrl = `${detailBase}?richiestaCQCView.richiestaCQCFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichPatCqc_viewRichPatCqc=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        const fv = (name) =>
          normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());
        const fvId = (id) =>
          normalizeText($det(`#${id}`).val() || $det(`#${id}`).text());

        rinnovo.dettaglio = {
          codice_fiscale:        fv("richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale"),
          data_nascita:          fv("richiestaCQCView.dataNascita"),
          patente_posseduta:     fv("richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta"),
          numero_documento_cqc:  fvId("noTastoInvio_richiestaCQCView_richiestaCQCFrom_numeroDocumentoCQC"),
          data_rilascio_cqc:     fvId("noTastoInvio_richiestaCQCView_richiestaCQCFrom_dataRilascioDocumentoAbilitazioneGuida"),
          tipo_cqc:              normalizeText(
            $det("select[id*='theTipoCQCEP_selectRowId'] option[selected]").text()
          ),
          motivo_richiesta:      normalizeText(
            $det("select[id*='theTipoMotivoRichiesta_selectRowId'] option[selected]").text()
          ),
          stato_richiesta:       normalizeText(
            $det("select[id*='theTipoStatoRichiesta_selectRowId'] option[selected]").text()
          ),
          cognome:               fvId("noTastoInvio_richiestaCQCView_cognome"),
          nome:                  fvId("noTastoInvio_richiestaCQCView_nome"),
          codice_autoscuola:     fvId("noTastoInvio_richiestaCQCView_richiestaCQCFrom_codiceIdentificativoAutoscuolaAgenzia"),
        };
      } catch (_) { /* ignore */ }
      if (typeof onProgress === "function" && i % 5 === 0) {
        onProgress({
          fase: "rinnovi_cqc_dettaglio",
          completate: i + 1,
          totale: rinnovi.length,
          raccolti: i + 1,
        });
      }
    }
  }

  return rinnovi;
}

// =============================================================================
// STRATEGIA A — Ricerca rinnovi per persona (bypass limite 31 giorni)
// =============================================================================
//
// Il portale accetta ricerche senza filtro data quando si specifica la coppia
// (Cognome-Patente) o (Codice Fiscale-Patente). In questo caso il portale
// restituisce TUTTI i rinnovi storici di quella persona, anche di molti anni fa.
//
// Messaggio esatto del portale quando mancano i filtri:
//   "Per l'operazione richiesta è necessario popolare in alternativa
//    o il Protocollo, o la coppia Cognome-Patente o Codice Fiscale-Patente,
//    o il range di Date e lo Stato"
//
// Caso particolare: se la patente passata è stata sostituita (es. in seguito a
// un rinnovo precedente), il portale risponde con il warning:
//   "La patente digitata è stata sostituita dalla patente numero XXXX"
// Questa funzione gestisce il follow automatico: estrae la patente nuova e
// rifà la ricerca (max 2 hop per evitare loop).
//
// Risposte del portale:
//   1) N≥2 rinnovi: tabella #listTable con righe [Protocollo, EstrPag, Stato, Data, Cogn, Nome]
//   2) N=1 rinnovo:  va dritto al "Dettaglio Rinnovo" (senza listTable)
//   3) N=0 rinnovi:  pagina vuota o messaggio "Nessun elemento trovato"
//
// =============================================================================

/**
 * Cerca i rinnovi patente di una persona specifica, SENZA filtro data.
 * Bypassa il limite 31 giorni del portale perché non filtra per dataInserimento.
 *
 * @param {object} client — axios http client con jar
 * @param {object} opts
 *   codiceFiscale?: string — codice fiscale (alternativa a cognome)
 *   cognome?:       string — cognome (alternativa a codice fiscale)
 *   patente:        string — numero patente (OBBLIGATORIO)
 *   maxFollowHops?: number — max follow di "patente sostituita" (default 2)
 *
 * @returns {Promise<Array>} array di rinnovi con campi base
 *   [{ marca_operativa, protocollo, stato_richiesta, data_inserimento, cognome, nome }]
 *   Se trova un solo rinnovo, l'array contiene 1 elemento estratto dal dettaglio.
 */
async function leggiRinnoviPerPersona(client, {
  codiceFiscale = "",
  cognome = "",
  patente = "",
  maxFollowHops = 2,
} = {}) {
  if (!patente) {
    throw new Error("leggiRinnoviPerPersona: parametro 'patente' obbligatorio");
  }
  if (!codiceFiscale && !cognome) {
    throw new Error("leggiRinnoviPerPersona: serve 'codiceFiscale' oppure 'cognome'");
  }

  const searchUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action`;

  // ─── Step 1: carica token Struts dalla pagina init ───
  async function loadToken() {
    const res = await client.get(searchUrl);
    const $ = cheerio.load(String(res?.data || ""));
    const name = $('input[name="struts.token.name"]').val() || "";
    const value = name ? $(`input[name="${name}"]`).val() || "" : "";
    return { name, value };
  }

  // ─── Step 2: invia la ricerca con filtri persona ───
  async function doSearch(patenteToUse) {
    const { name: tokenName, value: tokenValue } = await loadToken();
    const params = new URLSearchParams();
    if (tokenName && tokenValue) {
      params.set("struts.token.name", tokenName);
      params.set(tokenName, tokenValue);
    }
    params.set("richiestaView.richiestaRinnAgenziaFrom.marcaOperativa", "");
    params.set("richiestaView.richiestaRinnAgenziaFrom.patentePosseduta", patenteToUse);
    params.set("richiestaView.cognome", cognome || "");
    params.set("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale", codiceFiscale || "");
    params.set("richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia", "");
    params.set("richiestaView.richiestaRinnAgenziaFrom.dataInserimento", "");
    params.set("richiestaView.richiestaRinnAgenziaTo.dataInserimento", "");
    params.set("action:ReadGestRinnAgenzia_pagingGestRinnAgenzia", "Ricerca");

    const res = await client.post(searchUrl, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: searchUrl,
      },
      maxRedirects: 10,
    });
    return String(res?.data || "");
  }

  // ─── Step 3: parse risposta ───
  function parsePage(html) {
    const $ = cheerio.load(html);
    const title = ($("title").text() || "").trim();
    const actionError = $(".errorMessage, .actionError").first().text().trim();

    // A) tabella multi-riga
    const rows = [];
    $("#listTable > tbody tr").each(function () {
      const $tds = $(this).find("td");
      const marca = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
      if (!marca) return;
      // Colonne: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
      rows.push({
        marca_operativa:  marca,
        protocollo:       normalizeText($tds.eq(1).text()),
        estremo_pag:      normalizeText($tds.eq(2).text()),
        stato_richiesta:  normalizeText($tds.eq(3).text()),
        data_inserimento: normalizeText($tds.eq(4).text()),
        cognome:          normalizeText($tds.eq(5).text()),
        nome:             normalizeText($tds.eq(6).text()),
        stato:            normalizeText($tds.eq(3).text()),
        tipo_rinnovo:     "patente",
      });
    });

    // B) pagina "Dettaglio Rinnovo" (1 solo risultato → portale va dritto al dettaglio)
    let singolo = null;
    if (rows.length === 0 && /Dettaglio Rinnovo/i.test(title)) {
      const fv = (n) =>
        normalizeText($(`[name='${n}']`).val() || $(`[name='${n}']`).text());
      const marca = fv("richiestaView.richiestaRinnAgenziaFrom.marcaOperativa");
      if (marca) {
        singolo = {
          marca_operativa:  marca,
          protocollo:       marca, // spesso coincidono
          estremo_pag:      fv("richiestaView.richiestaRinnAgenziaFrom.estremoPagamento"),
          stato_richiesta:  normalizeText($("select[id*='StatoRichiesta'] option[selected]").text()),
          data_inserimento: fv("richiestaView.richiestaRinnAgenziaFrom.dataInserimento"),
          cognome:          fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.cognome") ||
                            fv("richiestaView.cognome"),
          nome:             fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.nome"),
          stato:            normalizeText($("select[id*='StatoRichiesta'] option[selected]").text()),
          tipo_rinnovo:     "patente",
        };
      }
    }

    // C) warning "patente sostituita" → nuovo numero
    const substMatch = actionError.match(/sostituit[ao] dalla patente numero\s+(\S+)/i);

    return { title, actionError, rows, singolo, substitutePatente: substMatch?.[1] || null };
  }

  // ─── Step 4: esegui con follow-redirect ───
  let currentPatente = patente;
  const hopsPatents = [];
  for (let hop = 0; hop <= maxFollowHops; hop += 1) {
    hopsPatents.push(currentPatente);
    const html = await doSearch(currentPatente);
    const parsed = parsePage(html);

    // caso A: tabella risultati
    if (parsed.rows.length > 0) return parsed.rows;

    // caso B: dettaglio singolo
    if (parsed.singolo) return [parsed.singolo];

    // caso C: patente sostituita → follow
    if (parsed.substitutePatente && hop < maxFollowHops) {
      // evita loop infinito
      if (hopsPatents.includes(parsed.substitutePatente)) break;
      currentPatente = parsed.substitutePatente;
      continue;
    }

    // nessun risultato utile
    return [];
  }
  return [];
}

/**
 * Strategia A completa: dato un elenco di persone (CF/cognome + patente),
 * itera chiamando `leggiRinnoviPerPersona` per ciascuna e accumula TUTTI
 * i rinnovi trovati, deduplicati per marca_operativa.
 *
 * @param {object} client
 * @param {object} opts
 *   persone: Array<{ codiceFiscale?, cognome?, patente, ... }>
 *   withDettaglio?: boolean — default true (scarica scheda completa di ogni rinnovo)
 *   concurrency?: number — default 1 (sequenziale per non stressare il portale)
 *   delayMs?: number — default 400 (pausa tra chiamate)
 *   onProgress?: fn
 *
 * @returns {Promise<Array>} rinnovi accumulati (stessa struttura di leggiRinnoviStoriciPatente)
 */
async function leggiRinnoviStoriciPerPersone(client, {
  persone = [],
  withDettaglio = true,
  delayMs = 400,
  onProgress = null,
} = {}) {
  const all = new Map(); // marca_operativa → rinnovo
  let processate = 0;
  let errori = 0;

  for (const p of persone) {
    if (!p || !p.patente) { processate += 1; continue; }
    if (!p.codiceFiscale && !p.cognome) { processate += 1; continue; }

    try {
      const rinnovi = await leggiRinnoviPerPersona(client, {
        codiceFiscale: p.codiceFiscale || "",
        cognome:       p.cognome || "",
        patente:       p.patente,
      });
      for (const r of rinnovi) {
        if (r?.marca_operativa && !all.has(r.marca_operativa)) {
          all.set(r.marca_operativa, r);
        }
      }
    } catch (err) {
      errori += 1;
      // non bloccante, logga e vai avanti
      console.warn(`[leggiRinnoviStoriciPerPersone] ${p.cognome || p.codiceFiscale}: ${err.message}`);
    }

    processate += 1;
    if (typeof onProgress === "function" && processate % 5 === 0) {
      onProgress({
        fase: "strategia_a_ricerca_persone",
        completate: processate,
        totale: persone.length,
        raccolti: all.size,
        errori,
      });
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const rinnovi = Array.from(all.values());

  // Scarica dettaglio di ogni rinnovo (stesso pattern di leggiRinnoviStoriciPatente)
  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action`;
    for (let i = 0; i < rinnovi.length; i += 1) {
      const rinnovo = rinnovi[i];
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        const fv = (name) =>
          normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());

        rinnovo.dettaglio = {
          codice_fiscale:      fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale"),
          data_nascita:        fv("richiestaView.dataNascita"),
          sesso:               fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.sesso"),
          comune_nascita:      fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.descrizioneComune"),
          provincia_nascita:   fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.descrizione"),
          comune_residenza:    fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.descrizioneComune"),
          provincia_residenza: fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.theProvincia.descrizione"),
          cap:                 fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.cap"),
          indirizzo:           fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.indirizzo"),
          patente_posseduta:   fv("richiestaView.richiestaRinnAgenziaFrom.thePatentePosseduta.numeroPatenteCompleto"),
          patente_emessa:      fv("richiestaView.richiestaRinnAgenziaFrom.patente"),
          data_inserimento:    fv("richiestaView.richiestaRinnAgenziaFrom.dataInserimento"),
        };
      } catch (_) {
        // ignora errori singolo rinnovo
      }
      if (typeof onProgress === "function" && i % 5 === 0) {
        onProgress({
          fase: "strategia_a_dettaglio",
          completate: i + 1,
          totale: rinnovi.length,
          raccolti: i + 1,
        });
      }
    }
  }

  return rinnovi;
}

// =============================================================================
// STRATEGIA A — Rinnovi MEDICI (TT2112) per persona (bypass limite 31 giorni)
// =============================================================================
//
// Stesso pattern di leggiRinnoviPerPersona ma sull'endpoint rinnovi medici.
// Endpoint: ReadGestRinnMed_initVerStatoPratHDDG.action
// Campi:
//   richiestaView.richiestaRinnMedFrom.marcaOperativa
//   richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale
//   richiestaView.richiestaRinnMedFrom.patentePosseduta
//   richiestaView.cognome
//   richiestaView.richiestaRinnMedFrom.codiceStatoRinnMed
//   richiestaView.richiestaRinnMedFrom.dataInserimento / richiestaView.richiestaRinnMedTo.dataInserimento
// Action di submit: action:ReadGestRinnMed_pagingGestRinnMedHd=Ricerca
// =============================================================================

/**
 * Cerca i rinnovi medici (TT2112) di una persona specifica, SENZA filtro data.
 *
 * @param {object} client — axios http client con jar
 * @param {object} opts
 *   codiceFiscale?: string — codice fiscale (alternativa a cognome)
 *   cognome?:       string — cognome (alternativa a codice fiscale)
 *   patente:        string — numero patente posseduta (OBBLIGATORIO)
 *   maxFollowHops?: number — default 2
 *
 * @returns {Promise<Array>} array di rinnovi medici con campi base
 */
async function leggiRinnoviMediciPerPersona(client, {
  codiceFiscale = "",
  cognome = "",
  patente = "",
  maxFollowHops = 2,
} = {}) {
  if (!patente) {
    throw new Error("leggiRinnoviMediciPerPersona: parametro 'patente' obbligatorio");
  }
  if (!codiceFiscale && !cognome) {
    throw new Error("leggiRinnoviMediciPerPersona: serve 'codiceFiscale' oppure 'cognome'");
  }

  const searchUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_initVerStatoPratHDDG.action`;

  async function loadToken() {
    const res = await client.get(searchUrl);
    const $ = cheerio.load(String(res?.data || ""));
    const name = $('input[name="struts.token.name"]').val() || "";
    const value = name ? $(`input[name="${name}"]`).val() || "" : "";
    return { name, value };
  }

  async function doSearch(patenteToUse) {
    const { name: tokenName, value: tokenValue } = await loadToken();
    const params = new URLSearchParams();
    if (tokenName && tokenValue) {
      params.set("struts.token.name", tokenName);
      params.set(tokenName, tokenValue);
    }
    params.set("richiestaView.richiestaRinnMedFrom.marcaOperativa", "");
    // L'endpoint medici ritorna 0 risultati quando CF e cognome sono ENTRAMBI
    // popolati. Preferiamo CF quando disponibile, altrimenti cognome.
    if (codiceFiscale) {
      params.set("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale", codiceFiscale);
      params.set("richiestaView.cognome", "");
    } else {
      params.set("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale", "");
      params.set("richiestaView.cognome", cognome || "");
    }
    params.set("richiestaView.richiestaRinnMedFrom.patentePosseduta", patenteToUse);
    params.set("richiestaView.richiestaRinnMedFrom.codiceStatoRinnMed", "");
    params.set("richiestaView.richiestaRinnMedFrom.dataInserimento", "");
    params.set("richiestaView.richiestaRinnMedTo.dataInserimento", "");
    params.set("action:ReadGestRinnMed_pagingGestRinnMedHd", "Ricerca");

    try {
      const res = await client.post(searchUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: searchUrl,
        },
        maxRedirects: 10,
      });
      return String(res?.data || "");
    } catch (err) {
      // 500 "servizio non disponibile" = modulo medici non accessibile per l'utente
      if (err.response?.status === 500) {
        const body = String(err.response.data || "");
        if (/non.*disponibile/i.test(body)) {
          throw new Error("SERVIZIO_NON_DISPONIBILE");
        }
      }
      throw err;
    }
  }

  function parsePage(html) {
    const $ = cheerio.load(html);
    const title = ($("title").text() || "").trim();
    const actionError = $(".errorMessage, .actionError").first().text().trim();

    // A) tabella multi-riga
    // Colonne: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
    const rows = [];
    $("#listTable > tbody tr").each(function () {
      const $tds = $(this).find("td");
      const marca = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
      if (!marca) return;
      rows.push({
        marca_operativa:  marca,
        protocollo:       normalizeText($tds.eq(1).text()),
        estremo_pag:      normalizeText($tds.eq(2).text()),
        stato_richiesta:  normalizeText($tds.eq(3).text()),
        data_inserimento: normalizeText($tds.eq(4).text()),
        cognome:          normalizeText($tds.eq(5).text()),
        nome:             normalizeText($tds.eq(6).text()),
        stato:            normalizeText($tds.eq(3).text()),
        tipo_rinnovo:     "medico",
      });
    });

    // B) pagina "Dettaglio" (1 solo risultato → portale va dritto al dettaglio)
    let singolo = null;
    if (rows.length === 0 && /Dettaglio|Rinnovo Medico|RinnMed/i.test(title)) {
      const fv = (n) =>
        normalizeText($(`[name='${n}']`).val() || $(`[name='${n}']`).text());
      const marca = fv("richiestaView.richiestaRinnMedFrom.marcaOperativa");
      if (marca) {
        singolo = {
          marca_operativa:  marca,
          protocollo:       marca,
          cognome:          fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.cognome") ||
                            fv("richiestaView.cognome"),
          nome:             fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.nome"),
          patente:          fv("richiestaView.richiestaRinnMedFrom.thePatentePosseduta.numeroPatenteCompleto") ||
                            fv("richiestaView.richiestaRinnMedFrom.patentePosseduta"),
          data_inserimento: fv("richiestaView.richiestaRinnMedFrom.dataInserimento"),
          stato:            normalizeText($("select[id*='StatoRinnMed'] option[selected]").text()),
          stato_richiesta:  normalizeText($("select[id*='StatoRinnMed'] option[selected]").text()),
          tipo_rinnovo:     "medico",
        };
      }
    }

    // C) warning "patente sostituita"
    const substMatch = actionError.match(/sostituit[ao] dalla patente numero\s+(\S+)/i);

    return { title, actionError, rows, singolo, substitutePatente: substMatch?.[1] || null };
  }

  let currentPatente = patente;
  const hopsPatents = [];
  for (let hop = 0; hop <= maxFollowHops; hop += 1) {
    hopsPatents.push(currentPatente);
    const html = await doSearch(currentPatente);
    const parsed = parsePage(html);

    if (parsed.rows.length > 0) return parsed.rows;
    if (parsed.singolo) return [parsed.singolo];
    if (parsed.substitutePatente && hop < maxFollowHops) {
      if (hopsPatents.includes(parsed.substitutePatente)) break;
      currentPatente = parsed.substitutePatente;
      continue;
    }
    return [];
  }
  return [];
}

/**
 * Strategia A medici: batch dato un elenco di persone.
 * Deduplica per marca_operativa e opzionalmente scarica il dettaglio.
 */
async function leggiRinnoviMediciStoriciPerPersone(client, {
  persone = [],
  withDettaglio = true,
  delayMs = 400,
  onProgress = null,
} = {}) {
  const all = new Map();
  let processate = 0;
  let errori = 0;
  let servizioNonDisponibile = false;

  for (const p of persone) {
    if (!p || !p.patente) { processate += 1; continue; }
    if (!p.codiceFiscale && !p.cognome) { processate += 1; continue; }

    try {
      const rinnovi = await leggiRinnoviMediciPerPersona(client, {
        codiceFiscale: p.codiceFiscale || "",
        cognome:       p.cognome || "",
        patente:       p.patente,
      });
      for (const r of rinnovi) {
        if (r?.marca_operativa && !all.has(r.marca_operativa)) {
          all.set(r.marca_operativa, r);
        }
      }
    } catch (err) {
      if (err.message === "SERVIZIO_NON_DISPONIBILE") {
        servizioNonDisponibile = true;
        console.info(`[leggiRinnoviMediciStoriciPerPersone] modulo rinnovi medici non disponibile, skip`);
        break;
      }
      errori += 1;
      console.warn(`[leggiRinnoviMediciStoriciPerPersone] ${p.cognome || p.codiceFiscale}: ${err.message}`);
    }

    processate += 1;
    if (typeof onProgress === "function" && processate % 5 === 0) {
      onProgress({
        fase: "strategia_a_medici_ricerca_persone",
        completate: processate,
        totale: persone.length,
        raccolti: all.size,
        errori,
      });
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  if (servizioNonDisponibile) {
    const result = [];
    result.servizioNonDisponibile = true;
    return result;
  }

  const rinnovi = Array.from(all.values());

  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_pagingGestRinnMedHd.action`;
    for (let i = 0; i < rinnovi.length; i += 1) {
      const rinnovo = rinnovi[i];
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnMedFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichRinnMed_viewElementRichRinnMed=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        const fv = (name) =>
          normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());

        rinnovo.dettaglio = {
          codice_fiscale:      fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale"),
          data_nascita:        fv("richiestaView.dataNascita"),
          patente_posseduta:   fv("richiestaView.richiestaRinnMedFrom.thePatentePosseduta.numeroPatenteCompleto"),
          data_inserimento:    fv("richiestaView.richiestaRinnMedFrom.dataInserimento"),
          data_visita_medica:  fv("richiestaView.richiestaRinnMedFrom.dataVisitaMedica"),
          numero_certificato:  fv("richiestaView.richiestaRinnMedFrom.numeroCertificato"),
          medico_codice:       fv("richiestaView.richiestaRinnMedFrom.codiceMedico"),
        };
      } catch (_) { /* ignore */ }
      if (typeof onProgress === "function" && i % 5 === 0) {
        onProgress({
          fase: "strategia_a_medici_dettaglio",
          completate: i + 1,
          totale: rinnovi.length,
          raccolti: i + 1,
        });
      }
    }
  }

  return rinnovi;
}

// =============================================================================
// STRATEGIA A — Rinnovi CQC per persona (bypass limite 31 giorni)
// =============================================================================
//
// Endpoint: richiestaCQC/ReadRichPatCqc_initRichPatCqc.action
// Campi:
//   richiestaCQCView.richiestaCQCFrom.marcaOperativa
//   richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale
//   richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta   <-- nome diverso
//   richiestaCQCView.cognome
//   richiestaCQCView.richiestaCQCFrom.theTipoStatoRichiesta.codice
//   richiestaCQCView.richiestaCQCFrom.dataInserimento / To
// Action di submit: action:ReadRichPatCqc_pagingRichPatCqc=Ricerca
// =============================================================================

/**
 * Cerca i rinnovi CQC di una persona specifica, SENZA filtro data.
 *
 * @param {object} client — axios http client con jar
 * @param {object} opts
 *   codiceFiscale?: string
 *   cognome?:       string
 *   patente:        string — patente italiana posseduta (OBBLIGATORIO)
 *   maxFollowHops?: number
 */
async function leggiRinnoviCqcPerPersona(client, {
  codiceFiscale = "",
  cognome = "",
  patente = "",
  maxFollowHops = 2,
} = {}) {
  if (!patente) {
    throw new Error("leggiRinnoviCqcPerPersona: parametro 'patente' obbligatorio");
  }
  if (!codiceFiscale && !cognome) {
    throw new Error("leggiRinnoviCqcPerPersona: serve 'codiceFiscale' oppure 'cognome'");
  }

  const searchUrl = `${PORTAL_BASE}/RichiestaPatenti/richiestaCQC/ReadRichPatCqc_initRichPatCqc.action`;

  async function loadToken() {
    const res = await client.get(searchUrl);
    const $ = cheerio.load(String(res?.data || ""));
    const name = $('input[name="struts.token.name"]').val() || "";
    const value = name ? $(`input[name="${name}"]`).val() || "" : "";
    return { name, value };
  }

  async function loadTokenSafe() {
    try {
      return await loadToken();
    } catch (err) {
      // 500 "servizio non disponibile" sulla pagina init → modulo CQC non accessibile
      if (err.response?.status === 500) {
        throw new Error("SERVIZIO_NON_DISPONIBILE");
      }
      throw err;
    }
  }

  async function doSearch(patenteToUse) {
    const { name: tokenName, value: tokenValue } = await loadTokenSafe();
    const params = new URLSearchParams();
    if (tokenName && tokenValue) {
      params.set("struts.token.name", tokenName);
      params.set(tokenName, tokenValue);
    }
    params.set("richiestaCQCView.richiestaCQCFrom.marcaOperativa", "");
    // Preferiamo CF quando disponibile (stesso comportamento strict di medici)
    if (codiceFiscale) {
      params.set("richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale", codiceFiscale);
      params.set("richiestaCQCView.cognome", "");
    } else {
      params.set("richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale", "");
      params.set("richiestaCQCView.cognome", cognome || "");
    }
    params.set("richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta", patenteToUse);
    params.set("richiestaCQCView.richiestaCQCFrom.theTipoStatoRichiesta.codice", "");
    params.set("richiestaCQCView.richiestaCQCFrom.dataInserimento", "");
    params.set("richiestaCQCView.richiestaCQCTo.dataInserimento", "");
    params.set("action:ReadRichPatCqc_pagingRichPatCqc", "Ricerca");

    try {
      const res = await client.post(searchUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: searchUrl,
        },
        maxRedirects: 10,
      });
      return String(res?.data || "");
    } catch (err) {
      if (err.response?.status === 500) {
        const body = String(err.response.data || "");
        if (/non.*disponibile/i.test(body)) {
          throw new Error("SERVIZIO_NON_DISPONIBILE");
        }
      }
      throw err;
    }
  }

  function parsePage(html) {
    const $ = cheerio.load(html);
    const title = ($("title").text() || "").trim();
    const actionError = $(".errorMessage, .actionError").first().text().trim();

    const rows = [];
    $("#listTable > tbody tr").each(function () {
      const $tds = $(this).find("td");
      const marca = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
      if (!marca) return;
      rows.push({
        marca_operativa:  marca,
        cognome:          normalizeText($tds.eq(1).text()),
        nome:             normalizeText($tds.eq(2).text()),
        patente:          normalizeText($tds.eq(3).text()),
        data_inserimento: normalizeText($tds.eq(4).text()),
        stato:            normalizeText($tds.eq(5).text()),
        stato_richiesta:  normalizeText($tds.eq(5).text()),
        tipo_rinnovo:     "cqc",
      });
    });

    let singolo = null;
    if (rows.length === 0 && /Dettaglio|CQC|RichPatCqc/i.test(title)) {
      const fv = (n) =>
        normalizeText($(`[name='${n}']`).val() || $(`[name='${n}']`).text());
      const fvId = (id) =>
        normalizeText($(`#${id}`).val() || $(`#${id}`).text());
      const marca = fv("richiestaCQCView.richiestaCQCFrom.marcaOperativa");
      if (marca) {
        singolo = {
          marca_operativa:  marca,
          protocollo:       marca,
          cognome:          fvId("noTastoInvio_richiestaCQCView_cognome") ||
                            fv("richiestaCQCView.cognome"),
          nome:             fvId("noTastoInvio_richiestaCQCView_nome"),
          patente:          fv("richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta"),
          data_inserimento: fv("richiestaCQCView.richiestaCQCFrom.dataInserimento"),
          stato:            normalizeText($("select[id*='theTipoStatoRichiesta'] option[selected]").text()),
          stato_richiesta:  normalizeText($("select[id*='theTipoStatoRichiesta'] option[selected]").text()),
          tipo_rinnovo:     "cqc",
        };
      }
    }

    const substMatch = actionError.match(/sostituit[ao] dalla patente numero\s+(\S+)/i);

    return { title, actionError, rows, singolo, substitutePatente: substMatch?.[1] || null };
  }

  let currentPatente = patente;
  const hopsPatents = [];
  for (let hop = 0; hop <= maxFollowHops; hop += 1) {
    hopsPatents.push(currentPatente);
    const html = await doSearch(currentPatente);
    const parsed = parsePage(html);

    if (parsed.rows.length > 0) return parsed.rows;
    if (parsed.singolo) return [parsed.singolo];
    if (parsed.substitutePatente && hop < maxFollowHops) {
      if (hopsPatents.includes(parsed.substitutePatente)) break;
      currentPatente = parsed.substitutePatente;
      continue;
    }
    return [];
  }
  return [];
}

/**
 * Strategia A CQC: batch dato un elenco di persone.
 */
async function leggiRinnoviCqcStoriciPerPersone(client, {
  persone = [],
  withDettaglio = true,
  delayMs = 400,
  onProgress = null,
} = {}) {
  const all = new Map();
  let processate = 0;
  let errori = 0;
  let servizioNonDisponibile = false;

  for (const p of persone) {
    if (!p || !p.patente) { processate += 1; continue; }
    if (!p.codiceFiscale && !p.cognome) { processate += 1; continue; }

    try {
      const rinnovi = await leggiRinnoviCqcPerPersona(client, {
        codiceFiscale: p.codiceFiscale || "",
        cognome:       p.cognome || "",
        patente:       p.patente,
      });
      for (const r of rinnovi) {
        if (r?.marca_operativa && !all.has(r.marca_operativa)) {
          all.set(r.marca_operativa, r);
        }
      }
    } catch (err) {
      if (err.message === "SERVIZIO_NON_DISPONIBILE") {
        // Modulo CQC non accessibile per questo utente/autoscuola → stop
        servizioNonDisponibile = true;
        console.info(`[leggiRinnoviCqcStoriciPerPersone] modulo CQC non disponibile per questa autoscuola, skip`);
        break;
      }
      errori += 1;
      console.warn(`[leggiRinnoviCqcStoriciPerPersone] ${p.cognome || p.codiceFiscale}: ${err.message}`);
    }

    processate += 1;
    if (typeof onProgress === "function" && processate % 5 === 0) {
      onProgress({
        fase: "strategia_a_cqc_ricerca_persone",
        completate: processate,
        totale: persone.length,
        raccolti: all.size,
        errori,
      });
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  // Se il servizio CQC non è disponibile per questa autoscuola, ritorna un array
  // vuoto con flag informativa (il chiamante può usarla per non segnalare errore)
  if (servizioNonDisponibile) {
    const result = [];
    result.servizioNonDisponibile = true;
    return result;
  }

  const rinnovi = Array.from(all.values());

  if (withDettaglio && rinnovi.length > 0) {
    const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiestaCQC/ReadRichPatCqc_pagingRichPatCqc.action`;
    for (let i = 0; i < rinnovi.length; i += 1) {
      const rinnovo = rinnovi[i];
      try {
        const detUrl = `${detailBase}?richiestaCQCView.richiestaCQCFrom.marcaOperativa=${encodeURIComponent(rinnovo.marca_operativa)}&action%3ASelectRichPatCqc_viewRichPatCqc=Visualizza`;
        const detRes  = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const $det    = cheerio.load(detHtml);

        const fv = (name) =>
          normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());
        const fvId = (id) =>
          normalizeText($det(`#${id}`).val() || $det(`#${id}`).text());

        rinnovo.dettaglio = {
          codice_fiscale:        fv("richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale"),
          data_nascita:          fv("richiestaCQCView.dataNascita"),
          patente_posseduta:     fv("richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta"),
          numero_documento_cqc:  fvId("noTastoInvio_richiestaCQCView_richiestaCQCFrom_numeroDocumentoCQC"),
          data_rilascio_cqc:     fvId("noTastoInvio_richiestaCQCView_richiestaCQCFrom_dataRilascioDocumentoAbilitazioneGuida"),
          tipo_cqc:              normalizeText(
            $det("select[id*='theTipoCQCEP_selectRowId'] option[selected]").text()
          ),
          motivo_richiesta:      normalizeText(
            $det("select[id*='theTipoMotivoRichiesta_selectRowId'] option[selected]").text()
          ),
          stato_richiesta:       normalizeText(
            $det("select[id*='theTipoStatoRichiesta_selectRowId'] option[selected]").text()
          ),
          cognome:               fvId("noTastoInvio_richiestaCQCView_cognome"),
          nome:                  fvId("noTastoInvio_richiestaCQCView_nome"),
          codice_autoscuola:     fvId("noTastoInvio_richiestaCQCView_richiestaCQCFrom_codiceIdentificativoAutoscuolaAgenzia"),
        };
      } catch (_) { /* ignore */ }
      if (typeof onProgress === "function" && i % 5 === 0) {
        onProgress({
          fase: "strategia_a_cqc_dettaglio",
          completate: i + 1,
          totale: rinnovi.length,
          raccolti: i + 1,
        });
      }
    }
  }

  return rinnovi;
}

module.exports = {
  getClient,
  leggiDatiPatentePosseduta,
  leggiEsamiSvolti,
  leggiEsamiCandidato,
  leggiRinnoviAttivi,
  leggiRinnoviStoriciPatente, // FASE B2 — tutti gli stati, tutti gli anni (limite 31gg)
  leggiRinnoviStoriciMedici,  // FASE B3 — TT2112 storico
  leggiRinnoviStoriciCqc,     // FASE C  — CQC storico
  leggiRinnoviPerPersona,              // STRATEGIA A patenti — ricerca puntuale bypass 31gg
  leggiRinnoviStoriciPerPersone,       // STRATEGIA A patenti batch
  leggiRinnoviMediciPerPersona,        // STRATEGIA A medici (TT2112) — ricerca puntuale
  leggiRinnoviMediciStoriciPerPersone, // STRATEGIA A medici batch
  leggiRinnoviCqcPerPersona,           // STRATEGIA A CQC — ricerca puntuale
  leggiRinnoviCqcStoriciPerPersone,    // STRATEGIA A CQC batch
  iterateDateRange,           // helper esportato per altri moduli
  leggiRicevutaSostitutiva,
  creaRicevutaSostitutiva,
  leggiAllieviPrenotati,
  leggiCertificatoMedico,
  syncDatiCliente,
  leggiAnomaliePortale,
};
