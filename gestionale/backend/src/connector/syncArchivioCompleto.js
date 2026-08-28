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
// STEP 1 — Lista verbali (sessions) da SituazioneCandidati
// ---------------------------------------------------------------------------

/**
 * Recupera la lista dei verbali/sedute da Read_initActionSituazioneCandidati.action.
 * Returns array di { id_verbale, data, tipo, ... }
 */
async function fetchVerbaliList(client, { codiceAutoscuola, codUfficio, tipo = "P", tipoProva = "T" }) {
  const baseUrl =
    `${BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action`;

  const params = new URLSearchParams();
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreTipoSessione", "C");
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreConseguimentoEsame", tipo);
  if (codUfficio) {
    params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.theDisponibilitaEsaminatoreEP.codUfficioMCTC", codUfficio);
  }
  if (codiceAutoscuola) {
    params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceIdentificativoAutoscuolaAgenzia", codiceAutoscuola);
  }
  // Stato vuoto = tutti (attivi + storici)
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreStatoCandidati", "");
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreTipoProvaEsame", "");
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreStatoRichiesta", "");
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreTipoProvaEsameDaPrenotare", tipoProva);
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.dataFrom", "");
  params.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.dataTo", "");
  params.set("action:ReadSituazioneCandidati_pagingSituazioneCandidati", "Ricerca");

  const url = `${baseUrl}?${serializePayloadRaw(params)}`;
  const { data: html } = await client.get(url);

  return parseVerbaliFromHtml(html);
}

function parseVerbaliFromHtml(html) {
  const $ = cheerio.load(html || "");
  const verbali = [];

  // Il portale usa #listTable per la lista dei verbali
  const table = $("#listTable > tbody, table tbody").first();
  table.find("tr").each((_, tr) => {
    const $tr = $(tr);
    // L'id_verbale è in un input nascosto nella prima cella
    const idVerbale = $tr.find("td input[type='hidden'], td > input").first().val();
    if (!idVerbale) return;

    const cells = $tr.find("td").map((__, td) => norm($(td).text())).get();
    verbali.push({
      id_verbale: idVerbale,
      data:       cells[1] || cells[0] || "",
      tipo:       cells[2] || "",
      sede:       cells[3] || "",
      raw:        cells,
    });
  });

  return verbali;
}

// ---------------------------------------------------------------------------
// STEP 2 — Candidati in una seduta (verbale)
// ---------------------------------------------------------------------------

/**
 * Per ogni verbale, ottiene la lista dei candidati prenotati.
 * Richiede il POST al form ReadSituazioneCandidati_searchSituazioneCandidati.
 */
async function fetchCandidatiInVerbale(client, { idVerbale, token = "" }) {
  const url =
    `${BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/ReadSituazioneCandidati_searchSituazioneCandidati.action`;

  const payload = new URLSearchParams();
  if (token) {
    payload.set("struts.token.name", "tokenListRicercaSituazioneCandidati");
    payload.set("tokenListRicercaSituazioneCandidati", token);
  }
  payload.set("richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.selectRowId", idVerbale);
  payload.set("action:SelectSituazioneCandidati_viewElementSituazioneCandidati", "Dettaglio");

  const { data: html } = await client.post(url, serializePayloadRaw(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action`,
    },
  });

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
}) {
  const useEstesa = marcaOperativa && !String(marcaOperativa).startsWith("98");

  const params = new URLSearchParams({
    "richiestaPerEsameView.richiestaFrom.idAutAg":                                       String(idAutAg || ""),
    "richiestaPerEsameView.richiestaFrom.theUfficioMctcOperativo.codiceUffOperativo":    String(codUfficioMctc || ""),
    "richiestaPerEsameView.richiestaFrom.marcaOperativa":                                String(marcaOperativa || ""),
    "richiestaPerEsameView.richiestaFrom.patente":                                       "",
    "richiestaPerEsameView.richiestaFrom.theAnagrafica.codiceFiscale":                   String(codiceFiscale || ""),
    "richiestaPerEsameView.cognome":                                                     "",
    "richiestaPerEsameView.nome":                                                        "",
    "richiestaPerEsameView.dataNascita":                                                 "",
    "richiestaPerEsameView.richiestaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.selectRowId": "",
    "richiestaPerEsameView.richiestaFrom.theAnagrafica.theComuneNascita.selectRowId":    "",
    "richiestaPerEsameView.richiestaFrom.theAnagrafica.theStatoEstero.selectRowId":      "",
    "richiestaPerEsameView.richiestaFrom.theTipoStatoRichiesta.codiceStatoRichiesta":    "",
    "action:Read_paging":                                                                "Ricerca",
  });

  if (useEstesa) {
    params.set("richiestaPerEsameView.richiestaFrom.indicatoreRicercaEstesa", "S");
  }

  const url = `${BASE_URL}/RichiestaPatenti/richiestaEsame/Read_initAction.action?${serializePayloadRaw(params)}`;
  const { data: html } = await client.get(url);

  return parseSchedaCandidatoHtml(html);
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

    let verbali = [];
    try {
      verbali = await fetchVerbaliList(client, {
        codiceAutoscuola: idAutAg,
        codUfficio: codUfficioMctc,
        tipo:      comb.tipo,
        tipoProva: comb.tipoProva,
      });
      console.log(`[syncArchivio] ${comb.desc}: ${verbali.length} verbali`);
    } catch (err) {
      console.warn(`[syncArchivio] Errore verbali ${comb.desc}:`, err.message);
      continue;
    }

    // Per ogni verbale, recupera candidati
    for (const verbale of verbali) {
      if (!verbale.id_verbale) continue;
      try {
        const cands = await fetchCandidatiInVerbale(client, {
          idVerbale: verbale.id_verbale,
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

  const scheda = await fetchSchedaCandidato(client, { idAutAg, codUfficioMctc, marcaOperativa });
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
