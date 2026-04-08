/**
 * VerbaliSvoltiService — Sincronizzazione storica e ricerca locale verbali svolti.
 *
 * Strategia per superare il limite 7 giorni del portale:
 * 1. syncVerbaliRange(from, to) — divide il range in chunk da 7 giorni,
 *    chiama il portale per ogni chunk, fa upsert nel DB locale.
 * 2. search(filters) — ricerca locale nel DB senza limiti di data.
 * 3. getSyncStatus / updateSyncStatus — traccia lo stato di sincronizzazione
 *    per evitare di risincronizzare periodi già scaricati.
 * 4. autoSync — sincronizza automaticamente solo i periodi mancanti.
 */

const supabase = require("../database/supabase");

const TABLE = "verbali_svolti";
const SYNC_TABLE = "verbali_sync_status";

// Anno minimo: il portale dell'automobilista ha dati dal ~2006
const ANNO_INIZIO_PORTALE = 2006;

// Colonne da selezionare (esclude raw_html per performance)
const SEARCH_COLUMNS = "id,autoscuola_id,data_verbale,tipo_esame,tipo_esame_codice,fascia_oraria,numero_verbale,candidati_prenotati,stato_verbale,ufficio_provinciale,codice_localita,aula,desc_localita,indirizzo,cod_esaminatore,nome_esaminatore,anno_verbale,tipo_verbale,sync_batch_id,synced_at,created_at,updated_at";

/**
 * Retry helper: riprova una funzione async fino a maxRetries volte con delay tra tentativi.
 * Gestisce errori transitori come "TypeError: fetch failed" dal client Supabase.
 */
async function withRetry(fn, { maxRetries = 3, delayMs = 600, label = "query" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTransient = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(String(err?.message || ""));
      if (!isTransient || attempt >= maxRetries) throw err;
      console.warn(`[verbaliSvolti] ${label} tentativo ${attempt}/${maxRetries} fallito: ${err.message}. Riprovo tra ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastError;
}

// ─── PARSE: da array celle portale a record DB ────────────────────────────────

/**
 * Converte una riga del portale (array di celle) in un record per il DB.
 * Intestazioni tipiche: Sel., Data Verb., Esame, F.O, Verb., Cand. Pren.,
 *   Stato Verb., Uff. Prov., Loc., Aula, Desc. Località, Indirizzo
 */
function parseRigaPortale(celle, intestazioni) {
  const idx = {};
  (intestazioni || []).forEach((h, i) => {
    const norm = h.replace(/[.\s]+/g, "_").toLowerCase();
    idx[norm] = i;
  });

  const get = (keys) => {
    for (const k of keys) {
      const i = idx[k];
      if (i !== undefined && celle[i] !== undefined) return String(celle[i]).trim();
    }
    return "";
  };

  const dataVerbStr = get(["data_verb_", "data_verb", "dataverb"]) || (celle[1] || "").trim();
  const esameStr = get(["esame"]) || (celle[2] || "").trim();
  const fo = get(["f_o", "fo"]) || (celle[3] || "").trim();
  const verb = get(["verb_", "verb"]) || (celle[4] || "").trim();
  const candPren = get(["cand__pren_", "cand_pren", "candpren"]) || (celle[5] || "").trim();
  const statoVerb = get(["stato_verb_", "stato_verb", "statoverb"]) || (celle[6] || "").trim();
  const uffProv = get(["uff__prov_", "uff_prov", "uffprov"]) || (celle[7] || "").trim();
  const loc = get(["loc_", "loc"]) || (celle[8] || "").trim();
  const aula = get(["aula"]) || (celle[9] || "").trim();
  const descLocalita = get(["desc__localit", "desc_localita", "desclocalita", "desc__località"]) || (celle[10] || "").trim();
  const indirizzo = get(["indirizzo"]) || (celle[11] || "").trim();

  // Converti data DD/MM/YYYY → YYYY-MM-DD
  let dataVerbale = null;
  const dm = dataVerbStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dm) dataVerbale = `${dm[3]}-${dm[2]}-${dm[1]}`;

  // Tipo esame codice
  let tipoEsameCodice = null;
  if (/QUIZ/i.test(esameStr)) tipoEsameCodice = "I";
  else if (/GUIDA/i.test(esameStr)) tipoEsameCodice = "G";
  else if (/ORALE/i.test(esameStr)) tipoEsameCodice = "O";
  else if (/SCRITTO/i.test(esameStr)) tipoEsameCodice = "S";

  return {
    data_verbale: dataVerbale,
    tipo_esame: esameStr || null,
    tipo_esame_codice: tipoEsameCodice,
    fascia_oraria: fo || null,
    numero_verbale: verb ? parseInt(verb, 10) || null : null,
    candidati_prenotati: candPren ? parseInt(candPren, 10) || null : null,
    stato_verbale: statoVerb || null,
    ufficio_provinciale: uffProv || null,
    codice_localita: loc ? parseInt(loc, 10) || null : null,
    aula: aula ? parseInt(aula, 10) || null : null,
    desc_localita: descLocalita || null,
    indirizzo: indirizzo || null,
    anno_verbale: dataVerbale ? parseInt(dataVerbale.slice(0, 4), 10) : null,
  };
}

// ─── UPSERT: salva verbali nel DB ─────────────────────────────────────────────

async function upsertVerbali(autoscuolaId, righe, intestazioni, batchId, tipoVerbale = "VSC") {
  const records = [];
  for (const celle of righe) {
    const rec = parseRigaPortale(celle, intestazioni);
    if (!rec.data_verbale || rec.numero_verbale == null) continue;

    records.push({
      autoscuola_id: autoscuolaId,
      ...rec,
      tipo_verbale: tipoVerbale,
      sync_batch_id: batchId || null,
      synced_at: new Date().toISOString(),
    });
  }

  if (!records.length) return { inserted: 0, skipped: 0 };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(records, {
      onConflict: "autoscuola_id,data_verbale,numero_verbale,ufficio_provinciale,tipo_esame_codice,tipo_verbale",
      ignoreDuplicates: false,
    })
    .select("id");

  if (error) throw new Error(`Upsert verbali: ${error.message}`);
  return { inserted: (data || []).length, total: records.length };
}

// ─── RICERCA LOCALE: con tutti i filtri ───────────────────────────────────────

async function search(filters = {}) {
  const {
    autoscuolaId,
    tipoVerbale,
    dataFrom,
    dataTo,
    tipoEsame,
    fasciaOraria,
    numeroVerbale,
    ufficioProv,
    codiceLocalita,
    codEsaminatore,
    annoVerbale,
    statoVerbale,
    limit = 500,
    offset = 0,
    orderBy = "data_verbale",
    orderDir = "desc",
  } = filters;

  return withRetry(async () => {
    let q = supabase
      .from(TABLE)
      .select(SEARCH_COLUMNS, { count: "exact" })
      .order(orderBy, { ascending: orderDir === "asc" })
      .range(offset, offset + limit - 1);

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (tipoVerbale) q = q.eq("tipo_verbale", tipoVerbale);
    if (dataFrom) q = q.gte("data_verbale", dataFrom);
    if (dataTo) q = q.lte("data_verbale", dataTo);
    if (tipoEsame) q = q.eq("tipo_esame_codice", tipoEsame);
    if (fasciaOraria) q = q.eq("fascia_oraria", fasciaOraria);
    if (numeroVerbale) q = q.eq("numero_verbale", parseInt(numeroVerbale, 10));
    if (ufficioProv) q = q.eq("ufficio_provinciale", ufficioProv);
    if (codiceLocalita) q = q.eq("codice_localita", parseInt(codiceLocalita, 10));
    if (codEsaminatore) q = q.eq("cod_esaminatore", codEsaminatore);
    if (annoVerbale) q = q.eq("anno_verbale", parseInt(annoVerbale, 10));
    if (statoVerbale) q = q.ilike("stato_verbale", `%${statoVerbale}%`);

    const { data, error, count } = await q;
    if (error) throw new Error(`Ricerca verbali: ${error.message}`);
    return { data: data || [], total: count || 0 };
  }, { label: "search", maxRetries: 3, delayMs: 500 });
}

// ─── STATISTICHE ──────────────────────────────────────────────────────────────

async function stats(autoscuolaId, tipoVerbale) {
  return withRetry(async () => {
    let q = supabase
      .from(TABLE)
      .select("anno_verbale, tipo_esame_codice")
      .eq("autoscuola_id", autoscuolaId);
    if (tipoVerbale) q = q.eq("tipo_verbale", tipoVerbale);
    const { data, error } = await q;

    if (error) throw new Error(error.message);

    const anniSet = new Set();
    const perAnno = {};
    for (const r of (data || [])) {
      const anno = r.anno_verbale || "sconosciuto";
      anniSet.add(anno);
      if (!perAnno[anno]) perAnno[anno] = { totale: 0, quiz: 0, guida: 0, orale: 0, scritto: 0 };
      perAnno[anno].totale++;
      if (r.tipo_esame_codice === "I") perAnno[anno].quiz++;
      else if (r.tipo_esame_codice === "G") perAnno[anno].guida++;
      else if (r.tipo_esame_codice === "O") perAnno[anno].orale++;
      else if (r.tipo_esame_codice === "S") perAnno[anno].scritto++;
    }

    return {
      totaleVerbali: (data || []).length,
      anni: Array.from(anniSet).sort((a, b) => b - a),
      perAnno,
    };
  }, { label: "stats", maxRetries: 2 });
}

// ─── SYNC STATUS: traccia lo stato di sincronizzazione ───────────────────────

async function getSyncStatus(autoscuolaId, tipoVerbale = "VSC") {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from(SYNC_TABLE)
      .select("*")
      .eq("autoscuola_id", autoscuolaId)
      .eq("tipo_verbale", tipoVerbale)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }, { label: "getSyncStatus", maxRetries: 2 });
}

async function updateSyncStatus(autoscuolaId, tipoVerbale, updates) {
  const now = new Date().toISOString();

  // Prova update, se non esiste fa insert
  const { data: existing } = await supabase
    .from(SYNC_TABLE)
    .select("id")
    .eq("autoscuola_id", autoscuolaId)
    .eq("tipo_verbale", tipoVerbale)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from(SYNC_TABLE)
      .update({ ...updates, updated_at: now })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from(SYNC_TABLE)
      .insert({
        autoscuola_id: autoscuolaId,
        tipo_verbale: tipoVerbale,
        ...updates,
        created_at: now,
        updated_at: now,
      });
    if (error) throw new Error(error.message);
  }
}

/**
 * Calcola i range di date che devono ancora essere sincronizzati.
 * Confronta il range totale richiesto (globalFrom → globalTo)
 * con i range già sincronizzati (synced_ranges in DB).
 * Ritorna array di { from, to } ancora da scaricare.
 */
function computeMissingRanges(globalFrom, globalTo, syncedRanges = []) {
  // Converti tutto in giorni dal 1970 per semplificare
  const toDay = (s) => Math.floor(new Date(s + "T00:00:00Z").getTime() / 86400000);
  const fromDay = (d) => new Date(d * 86400000).toISOString().slice(0, 10);

  const startDay = toDay(globalFrom);
  const endDay = toDay(globalTo);

  // Segna i giorni già sincronizzati
  const synced = new Set();
  for (const r of syncedRanges) {
    if (!r.from || !r.to) continue;
    const f = toDay(r.from);
    const t = toDay(r.to);
    for (let d = f; d <= t; d++) synced.add(d);
  }

  // Trova intervalli non sincronizzati
  const missing = [];
  let rangeStart = null;
  for (let d = startDay; d <= endDay; d++) {
    if (!synced.has(d)) {
      if (rangeStart === null) rangeStart = d;
    } else {
      if (rangeStart !== null) {
        missing.push({ from: fromDay(rangeStart), to: fromDay(d - 1) });
        rangeStart = null;
      }
    }
  }
  if (rangeStart !== null) {
    missing.push({ from: fromDay(rangeStart), to: fromDay(endDay) });
  }

  return missing;
}

/**
 * Aggiunge un range sincronizzato alla lista (e compatta i range contigui).
 */
function addSyncedRange(syncedRanges, newFrom, newTo) {
  const ranges = [...(syncedRanges || []), { from: newFrom, to: newTo }];

  // Ordina per from
  ranges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  // Compatta range contigui/sovrapposti
  const compacted = [];
  for (const r of ranges) {
    if (!compacted.length) {
      compacted.push({ ...r });
      continue;
    }
    const last = compacted[compacted.length - 1];
    // Contiguo o sovrapposto: il giorno dopo last.to >= r.from
    const lastToNext = new Date(last.to + "T00:00:00Z");
    lastToNext.setUTCDate(lastToNext.getUTCDate() + 1);
    if (lastToNext.toISOString().slice(0, 10) >= r.from) {
      // Estendi
      if (r.to > last.to) last.to = r.to;
    } else {
      compacted.push({ ...r });
    }
  }

  return compacted;
}

// ─── FIND: cerca un verbale specifico nel DB locale ─────────────────────────

/**
 * Cerca un verbale specifico per data, numero verbale e ufficio provinciale.
 * Usato dal frontend "Dettaglio" per mostrare dati arricchiti dal DB locale
 * quando l'utente seleziona una riga dalla vista portale.
 */
async function findVerbale(autoscuolaId, { dataVerbale, numeroVerbale, ufficioProv, tipoEsameCodice }) {
  return withRetry(async () => {
    let q = supabase
      .from(TABLE)
      .select(SEARCH_COLUMNS)
      .eq("autoscuola_id", autoscuolaId);

    if (dataVerbale) q = q.eq("data_verbale", dataVerbale);
    if (numeroVerbale) q = q.eq("numero_verbale", parseInt(numeroVerbale, 10));
    if (ufficioProv) q = q.eq("ufficio_provinciale", ufficioProv);
    if (tipoEsameCodice) q = q.eq("tipo_esame_codice", tipoEsameCodice);

    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }, { label: "findVerbale", maxRetries: 2 });
}

module.exports = {
  parseRigaPortale,
  upsertVerbali,
  search,
  stats,
  getSyncStatus,
  updateSyncStatus,
  computeMissingRanges,
  addSyncedRange,
  findVerbale,
  ANNO_INIZIO_PORTALE,
};
