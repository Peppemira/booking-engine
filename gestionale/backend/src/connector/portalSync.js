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

module.exports = {
  getClient,
  leggiDatiPatentePosseduta,
  leggiEsamiSvolti,
  leggiEsamiCandidato,
  leggiRinnoviAttivi,
  leggiRicevutaSostitutiva,
  creaRicevutaSostitutiva,
  leggiAllieviPrenotati,
  leggiCertificatoMedico,
  syncDatiCliente,
  leggiAnomaliePortale,
};
