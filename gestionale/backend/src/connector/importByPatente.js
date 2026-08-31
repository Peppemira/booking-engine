const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const supabase = require("../database/supabase");

const {
  loginAndGetJar,
  runManualSessionFlowViaBrowser,
} = require("./portalSession");

const {
  makeHttpClient,
  loadMenu,
  readSituazioneCandidati,
} = require("./portalHttp");

const { parseSearchResults } = require("../parser/searchResultsParser");
const { parsePortalCandidates } = require("../parser/candidateParser");

const PORTAL_BASE_URL = "https://www.ilportaledellautomobilista.it";

/* =========================
   UTILITY
========================= */

function pickFirst(fields, keys, fallback = null) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function sanitizeKey(name) {
  return String(name || "")
    .replace(/[\[\]]/g, "_")
    .replace(/\.+/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

function extractFormFields(html) {
  const $ = cheerio.load(html || "");
  const mapped = {};

  $("input, select, textarea").each((_, element) => {
    const el = $(element);
    const keyRaw = el.attr("name") || el.attr("id");
    if (!keyRaw) return;

    const key = sanitizeKey(keyRaw);
    if (!key) return;

    let value = "";
    const tag = String(element.tagName || "").toLowerCase();

    if (tag === "select") {
      value =
        el.find("option:selected").val() ||
        el.find("option").first().val() ||
        "";
    } else {
      value = el.val() || "";
    }

    const normalized = String(value || "").trim();
    if (normalized) mapped[key] = normalized;
  });

  return {
    ...mapped,
    nome: pickFirst(mapped, ["nome"]),
    cognome: pickFirst(mapped, ["cognome"]),
    codiceFiscale: pickFirst(mapped, ["codiceFiscale", "cf"]),
    numeroPatente: pickFirst(mapped, ["numeroPatente"]),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================
   LOGIN + HTTP CLIENT
========================= */

async function createPortalHttpClient(credentials = null) {
  const creds = {
    username: credentials?.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: credentials?.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: credentials?.pin || process.env.PORTAL_PIN,
  };

  if (!creds.username || !creds.password) {
    throw new Error("Credenziali mancanti");
  }

  const jar = await loginAndGetJar(creds);
  const http = makeHttpClient(jar);

  await loadMenu(http);

  return { http, jar };
}

/* =========================
   BROWSER FLOW (PUPPETEER)
========================= */

async function extractCandidatesViaBrowser(input = {}) {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.goto(
      "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action",
      { waitUntil: "domcontentloaded" }
    );

    await page.type('input[type="text"]', input.username);
    await page.type('input[type="password"]', input.password);

    await Promise.all([
      page.waitForNavigation(),
      page.click('input[type="submit"]'),
    ]);

    // PIN
    if (input.pin) {
      await delay(1000);
      const pinInput = await page.$('input[name="loginView.pin"]');
      if (pinInput) {
        await page.type('input[name="loginView.pin"]', input.pin);
        await Promise.all([
          page.waitForNavigation(),
          page.click('input[type="submit"]'),
        ]);
      }
    }

    // Vai alla pagina candidati
    await page.goto(
      "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action",
      { waitUntil: "domcontentloaded" }
    );

    await delay(2000);

    const html = await page.content();

    return parsePortalCandidates(html);
  } finally {
    await browser.close();
  }
}

/* =========================
   SITUAZIONE CANDIDATI HTTP
   (equivalente GeCA: creaarchivio / sistArchivi)
========================= */

/**
 * Recupera la pagina "Situazione Candidati" con filtri opzionali.
 * Equivalente alla chiamata HTTP che GeCA fa per l'archivio candidati.
 */
async function readSituazioneCandidatiWithParams(http, options = {}) {
  const baseUrl =
    "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action";

  const params = new URLSearchParams();
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreTipoSessione",
    "C"
  );
  if (options.codiceAutoscuola) {
    params.set(
      "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceIdentificativoAutoscuolaAgenzia",
      String(options.codiceAutoscuola).trim()
    );
  }
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.dataFrom",
    options.dataFrom || ""
  );
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.dataTo",
    options.dataTo || ""
  );
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreStatoRichiesta",
    "A"
  );
  params.set(
    "action:ReadSituazioneCandidati_pagingSituazioneCandidati",
    "Ricerca"
  );

  const url = `${baseUrl}?${params.toString()}`;
  const { data: html } = await http.get(url, {
    headers: {
      Referer:
        "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    },
  });
  return html || "";
}

/**
 * Cerca un valore nei columns del portale (searchResultsParser) con match parziale.
 */
function pickColumn(columns = {}, keys = []) {
  if (!columns || typeof columns !== "object") return null;
  for (const key of keys) {
    const found = Object.entries(columns).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
    if (found && found[1] && String(found[1]).trim()) return String(found[1]).trim();
  }
  return null;
}

function toDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  // Formato italiano gg/mm/aaaa → aaaa-mm-gg
  const itMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (itMatch) return `${itMatch[3]}-${itMatch[2].padStart(2,'0')}-${itMatch[1].padStart(2,'0')}`;
  // ISO già ok
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/**
 * Upsert di un singolo candidato su Supabase.
 * Usa codice_fiscale come chiave di conflict; fallback su patente_numero.
 * Mappa tutti i campi del portale alle colonne DB corrispondenti.
 */
/**
 * Segnaposto per il codice fiscale quando il Portale non l'ha ancora dato
 * (scheda individuale non letta). DEVE essere DETERMINISTICO: prima si usava
 * `PORTAL-${Date.now()}-${random}`, che cambiava ad OGNI giro — e siccome la
 * dedup avviene sul codice fiscale, ogni scarico reinseriva tutti da capo
 * (29/08/2026: 88 persone diventate 264 righe in tre giri). Derivandolo
 * dall'identificativo stabile del Portale, un riscarico AGGIORNA la stessa riga.
 */
function segnapostoCf({ marca_operativa, patente, cognome, nome }) {
  const pulisci = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const marca = pulisci(marca_operativa);
  // Formato TEMP_<marca>: è quello che il gestionale sa già sciogliere da solo
  // (SupabaseReadService.RecuperaCodiciFiscaliAsync) sostituendolo col codice
  // fiscale vero appena la scheda individuale diventa leggibile.
  if (marca) return `TEMP_${marca}`;
  const patenteP = pulisci(patente);
  if (patenteP) return `TEMP_PAT${patenteP}`;
  // Senza NESSUN elemento identificativo non si inventa nulla di stabile:
  // meglio una riga in errore che un duplicato silenzioso ad ogni giro.
  return null;
}

async function upsertCandidateToDB(candidate, autoscuolaId) {
  const cf = String(candidate.codice_fiscale || "").trim();
  const patente = String(candidate.patente_numero || candidate.numeroPatente || "").trim();
  const cols = candidate.columns || {};  // da searchResultsParser

  // Campi standard
  const nome    = String(candidate.nome    || "").trim() || null;
  const cognome = String(candidate.cognome || "").trim() || null;

  // Categoria patente: da campo diretto o da columns portale
  const categoriaBruta = candidate.categoria_patente
    || pickColumn(cols, ["categoria", "cat."])
    || "B";
  const categoria_patente = String(categoriaBruta).trim() || "B";

  // Marca operativa (es. "AM27")
  const marca_operativa = candidate.marca_operativa
    || candidate.marcaOperativa
    || pickColumn(cols, ["marca operativa", "marca oper", "marca"])
    || null;

  // Statino / codice statino
  const codice_statino = candidate.codice_statino
    || pickColumn(cols, ["statino", "codice statino"])
    || null;

  // Data iscrizione al portale
  const data_iscrizione = toDate(
    candidate.data_iscrizione
    || pickColumn(cols, ["data iscrizione", "data iscriz", "iscrizione"])
  );

  // Dati anagrafici aggiuntivi
  const data_nascita     = toDate(candidate.data_nascita     || pickColumn(cols, ["data nascita", "nascita"]));
  const comune_nascita   = candidate.comune_nascita   || pickColumn(cols, ["comune nascita", "luogo nascita"]) || null;
  const provincia_nascita = candidate.provincia_nascita || pickColumn(cols, ["provincia nascita", "prov. nasc"]) || null;
  const sesso            = candidate.sesso            || pickColumn(cols, ["sesso"]) || null;
  const telefono         = candidate.telefono         || pickColumn(cols, ["telefono", "cell", "tel."]) || null;
  const email            = candidate.email            || pickColumn(cols, ["email", "e-mail", "mail"]) || null;
  const indirizzo        = candidate.indirizzo        || pickColumn(cols, ["indirizzo", "via", "via/piazza"]) || null;
  const cap              = candidate.cap              || pickColumn(cols, ["cap"]) || null;
  const comune           = candidate.comune           || pickColumn(cols, ["comune res", "comune di res"]) || null;
  const provincia        = candidate.provincia        || pickColumn(cols, ["provincia res", "prov. res"]) || null;
  const cittadinanza     = candidate.cittadinanza     || pickColumn(cols, ["cittadinanza", "nazionalit"]) || null;

  // Scadenze
  const ppg_data_scadenza  = toDate(candidate.ppg_data_scadenza  || pickColumn(cols, ["scad", "scadenza ppg", "foglio rosa", "ppg"]));
  const scade_il_documento = toDate(candidate.scade_il_documento || pickColumn(cols, ["scad. doc", "scadenza doc", "documento"]));
  const scade_il_patente   = toDate(candidate.scade_il_patente   || pickColumn(cols, ["scad. pat", "scadenza pat"]));

  // Campi portale specifici (da candidateParser)
  const codice_candidato = candidate.codice_candidato || null;
  const turno_prefer     = candidate.turno_prefer     || null;
  const lingua           = candidate.lingua           || null;
  const supporto_audio   = candidate.supporto_audio
    ? (typeof candidate.supporto_audio === "boolean"
        ? candidate.supporto_audio
        : /si|yes|s|1|true/i.test(String(candidate.supporto_audio)))
    : false;

  // Numero tentativi quiz
  const tentativi_quiz = Number.isFinite(candidate.tentativi_quiz)
    ? candidate.tentativi_quiz
    : parseInt(pickColumn(cols, ["tentativ", "quiz"]) || "0", 10) || 0;

  const raw_portale = {
    ...(candidate.raw_portale || {}),
    anagrafica: {
      ...(candidate.raw_portale?.anagrafica || {}),
      portal_numero_patente: patente || null,
      portal_cognome: cognome,
      portal_columns: Object.keys(cols).length ? cols : undefined,
    },
  };

  // Foglio rosa
  const codice_foglio_rosa = candidate.codice_foglio_rosa || null;

  const payload = {
    nome,
    cognome,
    codice_fiscale: cf || segnapostoCf({ marca_operativa, patente, cognome, nome }),
    categoria_patente,
    patente_numero: patente || null,
    tentativi_quiz,
    stato: candidate.stato || "attivo",
    stato_iscrizione: candidate.stato_iscrizione || "attivo",
    raw_portale,
    // Anagrafica completa
    data_nascita,
    comune_nascita,
    provincia_nascita,
    sesso,
    cittadinanza,
    indirizzo,
    cap,
    comune,
    provincia,
    telefono,
    email,
    // Dati pratiche
    marca_operativa,
    codice_statino,
    data_iscrizione,
    // Foglio rosa
    codice_foglio_rosa,
    // Scadenze
    ppg_data_scadenza,
    scade_il_documento,
    scade_il_patente,
    // Campi portale
    codice_candidato,
    turno_prefer,
    lingua,
    supporto_audio,
    // Timestamp aggiornamento
    updated_at: new Date().toISOString(),
  };

  // Rimuovi le chiavi con valore null per non sovrascrivere dati esistenti con null
  // (solo per campi opzionali — nome/cognome/cf restano sempre)
  const optionalNullable = [
    "data_nascita","comune_nascita","provincia_nascita","sesso","cittadinanza",
    "indirizzo","cap","comune","provincia","telefono","email",
    "marca_operativa","codice_statino","data_iscrizione",
    "codice_foglio_rosa",
    "ppg_data_scadenza","scade_il_documento","scade_il_patente",
    "codice_candidato","turno_prefer","lingua",
  ];
  for (const k of optionalNullable) {
    if (payload[k] === null) delete payload[k];
  }

  if (autoscuolaId) payload.autoscuola_id = autoscuolaId;

  const RITORNO = "id,nome,cognome,codice_fiscale,patente_numero,categoria_patente,raw_portale,marca_operativa,data_iscrizione";

  // IDENTITÀ: la marca operativa è l'identificativo STABILE del Portale, il
  // codice fiscale può ancora mancare (scheda non letta). Si cerca prima per
  // marca — dentro il proprio tenant — e si AGGIORNA la riga trovata: è ciò
  // che impedisce a un secondo scarico di ricreare la stessa persona.
  // .limit(1) e non .maybeSingle(): con duplicati già in tabella maybeSingle
  // fallisce e si ricadrebbe in INSERT, aggiungendo un ennesimo doppione.
  if (payload.marca_operativa) {
    let q = supabase.from("candidates").select("id")
      .eq("marca_operativa", payload.marca_operativa);
    q = autoscuolaId ? q.eq("autoscuola_id", autoscuolaId) : q.is("autoscuola_id", null);
    const { data: esistenti } = await q.order("created_at", { ascending: true }).limit(1);
    const gia = esistenti && esistenti[0];
    if (gia) {
      // Il segnaposto non sovrascrive MAI un codice fiscale vero già acquisito.
      const aggiorna = { ...payload };
      if (!cf) delete aggiorna.codice_fiscale;
      const { data: row, error } = await supabase.from("candidates")
        .update(aggiorna).eq("id", gia.id).select(RITORNO).single();
      if (error) throw new Error(`Aggiornamento fallito per marca ${payload.marca_operativa}: ${error.message}`);
      return row;
    }
  }

  // Senza marca (o prima volta) si resta sulla chiave del codice fiscale.
  if (!payload.codice_fiscale) {
    throw new Error("Candidato senza codice fiscale né marca operativa: non identificabile, riga non scritta.");
  }
  const { data: row, error } = await supabase
    .from("candidates")
    .upsert([payload], { onConflict: "codice_fiscale" })
    .select(RITORNO)
    .single();

  if (error) throw new Error(`Upsert fallito per ${payload.cognome} ${payload.nome}: ${error.message}`);
  return row;
}

/**
 * Applica filtri client-side ai risultati del portale.
 */
function applyPortalFilters(candidates, filters = {}) {
  return candidates.filter((c) => {
    if (filters.cognome) {
      const fc = String(filters.cognome).toLowerCase().trim();
      if (!String(c.cognome || "").toLowerCase().includes(fc)) return false;
    }
    if (filters.numeroPatente) {
      const fp = String(filters.numeroPatente).toLowerCase().trim();
      const pat = String(c.patente_numero || c.numeroPatente || "").toLowerCase();
      if (!pat.includes(fp)) return false;
    }
    if (filters.codiceFiscale) {
      const fcf = String(filters.codiceFiscale).toLowerCase().trim();
      if (!String(c.codice_fiscale || "").toLowerCase().includes(fcf)) return false;
    }
    if (filters.marcaOperativa) {
      const fm = String(filters.marcaOperativa).toLowerCase().trim();
      const col = String(c.raw_portale?.marca_operativa || c.marcaOperativa || "").toLowerCase();
      if (!col.includes(fm)) return false;
    }
    if (filters.statoFiltro && filters.statoFiltro !== "tutti") {
      const fs = String(filters.statoFiltro).toLowerCase().trim();
      const stato = String(c.stato || "").toLowerCase();
      if (fs === "attivi" && stato !== "attivo") return false;
      if (fs === "passati" && stato !== "passato") return false;
    }
    return true;
  });
}

/* =========================
   FUNZIONI PRINCIPALI
   (GeCA: creaarchivio, sistArchivi)
========================= */

/**
 * Ricerca candidati sul portale senza salvare nel DB.
 * Equivalente alla ricerca in GeCA prima dell'import.
 */
async function searchCandidates(payload = {}) {
  const {
    portalCredentials,
    codiceAutoscuola,
    cognome,
    numeroPatente,
    protocolloCertificatoMedico,
    marcaOperativa,
    codiceFiscale,
    statoFiltro,
  } = payload;

  const { http } = await createPortalHttpClient(portalCredentials);

  // Recupera situazione candidati (con codice autoscuola se disponibile)
  const html = await readSituazioneCandidatiWithParams(http, { codiceAutoscuola });

  // Parsa con entrambi i parser per massimizzare i dati estratti
  const fromCandidateParser = parsePortalCandidates(html);
  const fromSearchParser = parseSearchResults(html);

  // Merge: usa searchParser come base (ha patente), arricchisce con candidateParser
  const merged = [];
  const seen = new Set();

  for (const sr of fromSearchParser) {
    const key = `${String(sr.cognome || "").toLowerCase()}_${String(sr.nome || "").toLowerCase()}_${sr.numeroPatente || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      cognome: sr.cognome,
      nome: sr.nome,
      patente_numero: sr.numeroPatente || null,
      numeroPatente: sr.numeroPatente || null,
      stato: sr.stato || "attivo",
      codice_fiscale: null,
      categoria_patente: "B",
    });
  }

  for (const cp of fromCandidateParser) {
    const key = `${String(cp.cognome || "").toLowerCase()}_${String(cp.nome || "").toLowerCase()}_`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      cognome: cp.cognome,
      nome: cp.nome,
      patente_numero: null,
      numeroPatente: null,
      stato: cp.stato || "attivo",
      codice_fiscale: cp.codice_fiscale || null,
      categoria_patente: cp.categoria_patente || "B",
    });
  }

  const results = applyPortalFilters(merged, {
    cognome,
    numeroPatente,
    codiceFiscale,
    marcaOperativa,
    statoFiltro,
  });

  return { results };
}

/**
 * Import massivo: recupera tutti i candidati dal portale e li salva nel DB.
 * Equivalente a GeCA creaarchivio / sistArchivi – "Scarica tutti dal portale".
 */
async function importMassivo(payload = {}) {
  const { autoscuolaId, candidates: candidatesToImport, portalCredentials } = payload;

  const { results } = await searchCandidates(payload);

  // Se passati candidati specifici, filtra solo quelli richiesti
  const toImport =
    Array.isArray(candidatesToImport) && candidatesToImport.length > 0
      ? results.filter((r) =>
          candidatesToImport.some(
            (c) =>
              (c.numeroPatente && c.numeroPatente === r.numeroPatente) ||
              (c.cognome &&
                String(c.cognome).toLowerCase() === String(r.cognome || "").toLowerCase())
          )
        )
      : results;

  const imported = [];
  const errors = [];

  for (const candidate of toImport) {
    try {
      const row = await upsertCandidateToDB(candidate, autoscuolaId);
      imported.push(row);
    } catch (err) {
      errors.push({ candidate, error: String(err.message || err) });
    }
  }

  return {
    parsed: results.length,
    selected: toImport.length,
    imported,
    errors,
  };
}

/**
 * Import singolo candidato tramite criteri generici.
 * Equivalente GeCA import da dettaglio candidato.
 */
async function importCandidate(payload = {}) {
  const { cognome, numeroPatente, codiceFiscale, autoscuolaId } = payload;

  const { results } = await searchCandidates(payload);

  // Trova il candidato più corrispondente
  let match = null;
  if (numeroPatente) {
    match = results.find(
      (r) => String(r.numeroPatente || r.patente_numero || "").toLowerCase() === String(numeroPatente).toLowerCase()
    );
  }
  if (!match && codiceFiscale) {
    match = results.find(
      (r) => String(r.codice_fiscale || "").toLowerCase() === String(codiceFiscale).toLowerCase()
    );
  }
  if (!match && cognome) {
    match = results.find(
      (r) => String(r.cognome || "").toLowerCase().includes(String(cognome).toLowerCase())
    );
  }
  if (!match && results.length > 0) {
    match = results[0];
  }

  if (!match) throw new Error("Candidato non trovato sul portale con i criteri forniti");

  const row = await upsertCandidateToDB(match, autoscuolaId);
  return row;
}

/**
 * Import singolo per numero patente.
 * Equivalente GeCA: ricerca per numero patente e import.
 */
async function importByPatente(options = {}) {
  const { cognome, numeroPatente, autoscuolaId } = options;
  if (!numeroPatente) throw new Error("numeroPatente obbligatorio");

  const result = await importCandidate({ ...options, cognome, numeroPatente, autoscuolaId });
  return result;
}

module.exports = {
  extractCandidatesViaBrowser,
  searchCandidates,
  importMassivo,
  importCandidate,
  importByPatente,
  upsertCandidateToDB,
};
