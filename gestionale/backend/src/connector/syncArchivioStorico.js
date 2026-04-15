/**
 * SYNC ARCHIVIO STORICO COMPLETO
 * ================================================================
 * Scarica TUTTO lo storico dal Portale dell'Automobilista:
 *
 *   1. Candidati con verbali esami  (4 combinazioni P/T, Q/T, P/G, Q/G)
 *      → usa syncArchivioCompleto() esistente
 *
 *   2. Rinnovi patente               (ReadGestRinnAgenzia)
 *      → leggiRinnoviStoriciPatente()
 *
 *   3. Rinnovi medici (TT2112)       (ReadGestRinnMed)
 *      → leggiRinnoviStoriciMedici()
 *
 *   4. Rinnovi / Conseguimento CQC   (ReadRichPatCqc)
 *      → leggiRinnoviStoriciCqc()
 *
 * Il tutto viene:
 *   - deduplicato per marca_operativa
 *   - upsertato in:
 *       • public.candidates         (candidati da verbali esami)
 *       • public.rinnovi_portale    (rinnovi pat/med/cqc)
 *   - tracciato in public.archivio_sync_log
 *   - aggiornato in tempo reale con sync_generation e hash_contenuto
 *     per rilevare solo i cambiamenti
 *
 * ENV vars:
 *   PORTAL_USER / PORTAL_PASS / PORTAL_PIN
 *   CODICE_AUTOSCUOLA
 *   PORTAL_UFFICIO_MCTC
 *   ARCHIVIO_SYNC_FROM            (YYYY-MM-DD, default 2000-01-01)
 *   ARCHIVIO_SYNC_TO              (YYYY-MM-DD, default oggi)
 *   ARCHIVIO_SYNC_WINDOW_DAYS     (default 180)
 */

"use strict";

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const { loginDirectHttp } = require("./portalSession");
const { makeHttpClient } = require("./portalHttp");
const {
  leggiRinnoviStoriciPatente,
  leggiRinnoviStoriciMedici,
  leggiRinnoviStoriciCqc,
  leggiRinnoviStoriciPerPersone,       // STRATEGIA A patenti (bypass 31gg)
  leggiRinnoviMediciStoriciPerPersone, // STRATEGIA A medici (TT2112)
  leggiRinnoviCqcStoriciPerPersone,    // STRATEGIA A CQC
} = require("./portalSync");
const { syncArchivioCompleto } = require("./syncArchivioCompleto");
const supabase = require("../database/supabase");

const DEFAULT_DATA_INIZIO   = process.env.ARCHIVIO_SYNC_FROM || "2000-01-01";
const DEFAULT_DATA_FINE     = process.env.ARCHIVIO_SYNC_TO   || new Date().toISOString().slice(0, 10);
// IMPORTANTE: il portale RichiestaPatenti accetta MAX 31 giorni per query.
// Oltre questo limite restituisce l'errore "L'intervallo massimo consentito per
// numero di giorni che possono intercorrere tra le date è di 31 giorni".
// Per bypassare questo limite si usa la STRATEGIA A: ricerca per (cognome+patente)
// o (CF+patente) SENZA filtro data, che il portale accetta e restituisce TUTTI
// i rinnovi storici della persona (vedi leggiRinnoviPerPersona in portalSync.js).
const DEFAULT_WINDOW_DAYS   = Math.min(Number(process.env.ARCHIVIO_SYNC_WINDOW_DAYS || 30), 31);

// STRATEGIA A — abilitata di default per coprire lo storico oltre 31 giorni
const DEFAULT_STRATEGIA_A_ENABLED = String(process.env.ARCHIVIO_STRATEGIA_A || "true").toLowerCase() === "true";
const DEFAULT_STRATEGIA_A_DELAY_MS = Number(process.env.ARCHIVIO_STRATEGIA_A_DELAY_MS || 400);
const DEFAULT_STRATEGIA_A_MAX_PERSONE = Number(process.env.ARCHIVIO_STRATEGIA_A_MAX_PERSONE || 0); // 0 = nessun limite

// ---------------------------------------------------------------------------
// UTILITÀ
// ---------------------------------------------------------------------------

function computeHash(obj) {
  // Stabile: rimuove campi volatili (timestamp, id) prima di hashare
  const clone = { ...obj };
  delete clone.id;
  delete clone.created_at;
  delete clone.updated_at;
  delete clone.last_synced_at;
  delete clone.sync_generation;
  delete clone.hash_contenuto;
  const json = JSON.stringify(clone, Object.keys(clone).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

function normalizeDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function norm(v) {
  return v === undefined || v === null ? null : String(v).trim() || null;
}

// ---------------------------------------------------------------------------
// TENTATIVO DI MATCH con candidato esistente (per popolare candidato_id)
// ---------------------------------------------------------------------------

async function findCandidatoId({ autoscuolaId, codiceFiscale, marcaOperativa, cognome, nome }) {
  // 1) Per marca operativa (il campo più specifico)
  if (marcaOperativa) {
    const { data } = await supabase
      .from("candidates")
      .select("id")
      .eq("marca_operativa", marcaOperativa)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 2) Per codice fiscale + autoscuola
  if (codiceFiscale) {
    let q = supabase
      .from("candidates")
      .select("id")
      .ilike("codice_fiscale", codiceFiscale.trim());
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data } = await q.limit(1).maybeSingle();
    if (data?.id) return data.id;
  }

  // 3) Fallback: cognome + nome + autoscuola (match approssimativo)
  if (cognome && nome && autoscuolaId) {
    const { data } = await supabase
      .from("candidates")
      .select("id")
      .ilike("cognome", cognome.trim())
      .ilike("nome", nome.trim())
      .eq("autoscuola_id", autoscuolaId)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// UPSERT rinnovo_portale (con hash + change detection)
// ---------------------------------------------------------------------------

async function upsertRinnovoPortale(rinnovo, { autoscuolaId }) {
  const dettaglio = rinnovo.dettaglio || {};

  const payload = {
    autoscuola_id: autoscuolaId || null,
    marca_operativa: norm(rinnovo.marca_operativa),
    tipo_rinnovo: rinnovo.tipo_rinnovo || "patente",
    stato_portale: norm(rinnovo.stato_portale),
    stato_descr: norm(rinnovo.stato),

    cognome: norm(rinnovo.cognome),
    nome: norm(rinnovo.nome),
    codice_fiscale: norm(dettaglio.codice_fiscale),
    data_nascita: normalizeDate(dettaglio.data_nascita),
    sesso: norm(dettaglio.sesso),
    comune_nascita: norm(dettaglio.comune_nascita),
    provincia_nascita: norm(dettaglio.provincia_nascita),

    indirizzo: norm(dettaglio.indirizzo),
    cap: norm(dettaglio.cap),
    comune_residenza: norm(dettaglio.comune_residenza),
    provincia_residenza: norm(dettaglio.provincia_residenza),

    patente_posseduta: norm(dettaglio.patente_posseduta || rinnovo.patente),
    patente_emessa: norm(dettaglio.patente_emessa),
    categoria_patente: norm(dettaglio.categoria_patente),
    cqc_categoria: norm(dettaglio.tipo_cqc),

    data_inserimento: normalizeDate(rinnovo.data_inserimento || dettaglio.data_inserimento),
    data_rilascio: normalizeDate(dettaglio.data_rilascio_cqc || dettaglio.data_rilascio),
    data_scadenza: normalizeDate(dettaglio.data_scadenza),
    data_rinnovo: normalizeDate(dettaglio.data_rinnovo),

    dettaglio,
    raw_portale: rinnovo,
  };

  payload.hash_contenuto = computeHash(payload);

  // Match candidato esistente
  payload.candidato_id = await findCandidatoId({
    autoscuolaId,
    codiceFiscale: payload.codice_fiscale,
    marcaOperativa: payload.marca_operativa,
    cognome: payload.cognome,
    nome: payload.nome,
  });

  // Cerca record esistente (stesso tenant + marca + tipo)
  let selectQ = supabase
    .from("rinnovi_portale")
    .select("id, hash_contenuto, sync_generation")
    .eq("marca_operativa", payload.marca_operativa)
    .eq("tipo_rinnovo", payload.tipo_rinnovo);
  if (autoscuolaId) {
    selectQ = selectQ.eq("autoscuola_id", autoscuolaId);
  } else {
    selectQ = selectQ.is("autoscuola_id", null);
  }
  const { data: existing } = await selectQ.maybeSingle();

  const now = new Date().toISOString();

  if (existing?.id) {
    // Se l'hash è invariato, basta aggiornare last_synced_at (sync "tempo reale")
    if (existing.hash_contenuto === payload.hash_contenuto) {
      await supabase
        .from("rinnovi_portale")
        .update({ last_synced_at: now })
        .eq("id", existing.id);
      return { action: "unchanged" };
    }

    // Cambiamenti rilevati → incrementa generation e upsert
    payload.sync_generation = (existing.sync_generation || 1) + 1;
    payload.last_synced_at = now;
    payload.updated_at = now;

    await supabase
      .from("rinnovi_portale")
      .update(payload)
      .eq("id", existing.id);
    return { action: "updated" };
  }

  // Nuovo record
  payload.sync_generation = 1;
  payload.last_synced_at = now;
  const { error } = await supabase.from("rinnovi_portale").insert(payload);
  if (error) throw error;
  return { action: "inserted" };
}

// ---------------------------------------------------------------------------
// LOG RUN (archivio_sync_log)
// ---------------------------------------------------------------------------

async function createSyncLog(opts) {
  const { data, error } = await supabase
    .from("archivio_sync_log")
    .insert({
      autoscuola_id: opts.autoscuolaId || null,
      tipo_sync: opts.tipoSync || "full",
      trigger_source: opts.triggerSource || "manuale",
      include_esami: !!opts.includeEsami,
      include_rinnovi_pat: !!opts.includeRinnoviPat,
      include_rinnovi_med: !!opts.includeRinnoviMed,
      include_rinnovi_cqc: !!opts.includeRinnoviCqc,
      data_inizio: opts.dataInizio || null,
      data_fine: opts.dataFine || null,
      stato: "running",
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[archivio_sync_log] create failed:", error.message);
    return null;
  }
  return data?.id || null;
}

async function updateSyncLog(id, patch) {
  if (!id) return;
  try {
    await supabase.from("archivio_sync_log").update(patch).eq("id", id);
  } catch (e) {
    console.warn("[archivio_sync_log] update failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// STRATEGIA A — Raccolta persone da iterare per la ricerca puntuale
// ---------------------------------------------------------------------------

/**
 * Raccoglie l'elenco di persone da interrogare sul portale per la Strategia A.
 *
 * Unisce due sorgenti:
 *   1. `candidates` (alimentato da syncArchivioCompleto/verbali — ha molti anni)
 *   2. `rinnovi_portale` (già noti — per coprire persone non in candidates)
 *
 * Per ogni riga usa la patente più aggiornata disponibile. Deduplica per
 * codice_fiscale (mantiene il primo record) e poi per (cognome+patente).
 *
 * @param {object} opts
 *   autoscuolaId?: string — se presente, filtra per quel tenant
 *   limit?: number — max persone da ritornare (0 = nessun limite)
 *
 * @returns {Promise<Array<{codiceFiscale, cognome, patente, sorgente}>>}
 */
async function collectPersoneForStrategiaA({ autoscuolaId = null, limit = 0 } = {}) {
  const out = new Map(); // key = codice_fiscale || `${cognome}_${patente}`

  // ── Sorgente 1: candidates ─────────────────────────────────────────────────
  try {
    let q = supabase
      .from("candidates")
      .select("codice_fiscale, patente_numero, cognome, nome")
      .not("patente_numero", "is", null);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data: cands, error: err } = await q;
    if (err) {
      console.warn("[collectPersone] query candidates failed:", err.message);
    } else {
      for (const c of cands || []) {
        const cognome = (c.cognome || "").trim().toUpperCase();
        const patente = (c.patente_numero || "").trim().toUpperCase();
        const cf = (c.codice_fiscale || "").trim().toUpperCase();
        if (!patente) continue;
        if (!cognome && !cf) continue;
        const key = cf || `${cognome}|${patente}`;
        if (!out.has(key)) {
          out.set(key, {
            codiceFiscale: cf,
            cognome,
            patente,
            sorgente: "candidates",
          });
        }
      }
    }
  } catch (e) {
    console.warn("[collectPersone] sorgente candidates:", e.message);
  }

  // ── Sorgente 2: rinnovi_portale già sincronizzati ──────────────────────────
  try {
    let q = supabase
      .from("rinnovi_portale")
      .select("codice_fiscale, patente_posseduta, cognome, nome")
      .eq("tipo_rinnovo", "patente")
      .not("patente_posseduta", "is", null);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data: rinn, error: err } = await q;
    if (err) {
      console.warn("[collectPersone] query rinnovi_portale failed:", err.message);
    } else {
      for (const r of rinn || []) {
        const cognome = (r.cognome || "").trim().toUpperCase();
        const patente = (r.patente_posseduta || "").trim().toUpperCase();
        const cf = (r.codice_fiscale || "").trim().toUpperCase();
        if (!patente) continue;
        if (!cognome && !cf) continue;
        const key = cf || `${cognome}|${patente}`;
        if (!out.has(key)) {
          out.set(key, {
            codiceFiscale: cf,
            cognome,
            patente,
            sorgente: "rinnovi_portale",
          });
        }
      }
    }
  } catch (e) {
    console.warn("[collectPersone] sorgente rinnovi_portale:", e.message);
  }

  const arr = Array.from(out.values());
  return limit > 0 ? arr.slice(0, limit) : arr;
}

// ---------------------------------------------------------------------------
// ORCHESTRATORE PRINCIPALE
// ---------------------------------------------------------------------------

/**
 * Sync archivio storico completo del Portale Automobilista.
 *
 * @param {object} opts
 * @param {string} opts.idAutAg                  Codice meccanografico autoscuola
 * @param {string} opts.codUfficioMctc           Codice ufficio MCTC
 * @param {string} [opts.autoscuolaId]           UUID autoscuola Supabase
 * @param {boolean} [opts.includeEsami=true]     Include sync candidati da verbali esami
 * @param {boolean} [opts.includeRinnoviPat=true] Include rinnovi patente
 * @param {boolean} [opts.includeRinnoviMed=true] Include rinnovi medici TT2112
 * @param {boolean} [opts.includeRinnoviCqc=true] Include rinnovi/conseguimento CQC
 * @param {boolean} [opts.includeStrategiaA=true] STRATEGIA A: ricerca puntuale per persona (bypass 31gg)
 * @param {number}  [opts.strategiaAMaxPersone]   Limite persone da iterare (0 = nessuno)
 * @param {number}  [opts.strategiaADelayMs]      Pausa tra chiamate in ms
 * @param {string}  [opts.dataInizio]            YYYY-MM-DD (default 2000-01-01)
 * @param {string}  [opts.dataFine]              YYYY-MM-DD (default oggi)
 * @param {number}  [opts.windowDays]            Finestra iterazione (default 180)
 * @param {string}  [opts.tipoSync]              'full' | 'incrementale' | 'manuale'
 * @param {string}  [opts.triggerSource]         'manuale' | 'cron' | ...
 * @param {function}[opts.onProgress]            callback({ fase, ...stat })
 *
 * @returns {Promise<object>} statistiche aggregate
 */
async function syncArchivioStoricoCompleto(opts = {}) {
  const {
    idAutAg         = process.env.CODICE_AUTOSCUOLA || "",
    codUfficioMctc  = process.env.PORTAL_UFFICIO_MCTC || "",
    autoscuolaId    = null,
    includeEsami       = true,
    includeRinnoviPat  = true,
    includeRinnoviMed  = true,
    includeRinnoviCqc  = true,
    includeStrategiaA  = DEFAULT_STRATEGIA_A_ENABLED,
    strategiaAMaxPersone = DEFAULT_STRATEGIA_A_MAX_PERSONE,
    strategiaADelayMs    = DEFAULT_STRATEGIA_A_DELAY_MS,
    dataInizio   = DEFAULT_DATA_INIZIO,
    dataFine     = DEFAULT_DATA_FINE,
    windowDays   = DEFAULT_WINDOW_DAYS,
    tipoSync     = "full",
    triggerSource = "manuale",
    onProgress   = null,
  } = opts;

  const started = Date.now();
  const progress = (fase, extra = {}) => {
    if (typeof onProgress === "function") {
      try {
        onProgress({ fase, ...extra });
      } catch (_) { /* swallow */ }
    }
  };

  // Log run
  const logId = await createSyncLog({
    autoscuolaId,
    tipoSync,
    triggerSource,
    includeEsami,
    includeRinnoviPat,
    includeRinnoviMed,
    includeRinnoviCqc,
    dataInizio,
    dataFine,
  });

  const stats = {
    candidati_trovati: 0,
    candidati_inseriti: 0,
    candidati_aggiornati: 0,
    rinnovi_trovati: 0,
    rinnovi_inseriti: 0,
    rinnovi_aggiornati: 0,
    rinnovi_invariati: 0,
    // Strategia A — rinnovi PATENTE
    strategia_a_persone_iterate: 0,
    strategia_a_rinnovi_trovati: 0,
    // Strategia A — rinnovi MEDICI (TT2112)
    strategia_a_medici_persone_iterate: 0,
    strategia_a_medici_rinnovi_trovati: 0,
    strategia_a_medici_servizio_non_disponibile: false,
    // Strategia A — rinnovi CQC
    strategia_a_cqc_persone_iterate: 0,
    strategia_a_cqc_rinnovi_trovati: 0,
    strategia_a_cqc_servizio_non_disponibile: false,
    errori: 0,
    ultimo_errore: null,
  };

  try {
    // ── STEP 0: Login una volta, riuso client per tutte le chiamate ──────────
    progress("login", { message: "Login al portale in corso..." });
    const jar = await loginDirectHttp({
      username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin:      process.env.PORTAL_PIN,
    });
    const client = makeHttpClient(jar);

    // ── STEP 1: Candidati da verbali esami ───────────────────────────────────
    if (includeEsami) {
      progress("fase1_esami_start", { message: "Scarico candidati da verbali esami..." });
      try {
        const esamiResult = await syncArchivioCompleto({
          idAutAg,
          codUfficioMctc,
          autoscuolaId,
          fetchDettaglio: true,
          onProgress: (p) => progress("fase1_esami_progress", p),
        });
        stats.candidati_trovati  = esamiResult.found    || 0;
        stats.candidati_inseriti = esamiResult.inserted || 0;
        stats.errori            += esamiResult.errors   || 0;
        progress("fase1_esami_done", { stats });
      } catch (err) {
        console.error("[syncArchivioStorico] errore fase esami:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase esami: ${err.message}`;
      }
    }

    // ── STEP 2: Rinnovi patente ──────────────────────────────────────────────
    if (includeRinnoviPat) {
      progress("fase2_rinnovi_pat_start", {
        message: `Scarico rinnovi patente (${dataInizio} → ${dataFine})...`,
      });
      try {
        const rinnoviPat = await leggiRinnoviStoriciPatente(client, {
          dataInizio,
          dataFine,
          // NOTA: il portale NON supporta stato vuoto come "tutti". Iteriamo
          // i codici noti e dedupliamo per marca_operativa. ["A","D","S","R"]
          // copre i 4 stati osservati (Approvato, Defunto/Declinato,
          // Sostituito, Respinto/Revocato).
          stati: ["A", "D", "S", "R"],
          windowDays,
          withDettaglio: true,
          onProgress: (p) => progress("fase2_rinnovi_pat_progress", p),
        });
        stats.rinnovi_trovati += rinnoviPat.length;

        for (const rin of rinnoviPat) {
          try {
            const { action } = await upsertRinnovoPortale(rin, { autoscuolaId });
            if (action === "inserted") stats.rinnovi_inseriti += 1;
            else if (action === "updated") stats.rinnovi_aggiornati += 1;
            else stats.rinnovi_invariati += 1;
          } catch (err) {
            stats.errori += 1;
            stats.ultimo_errore = `Upsert rinn patente ${rin.marca_operativa}: ${err.message}`;
          }
        }
        progress("fase2_rinnovi_pat_done", { count: rinnoviPat.length });
      } catch (err) {
        console.error("[syncArchivioStorico] errore fase rinnovi patente:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase rinnovi pat: ${err.message}`;
      }
    }

    // ── STEP 2B: STRATEGIA A — Ricerca puntuale per persona (bypass 31gg) ────
    //
    // La fase 2 (leggiRinnoviStoriciPatente) è soggetta al limite 31 giorni del
    // portale: con un range di 26 anni significano ~310 finestre × 4 stati = oltre
    // 1200 chiamate HTTP, e comunque missa eventuali rinnovi non coperti.
    //
    // La Strategia A aggira il limite usando i filtri (cognome+patente) o
    // (CF+patente) che il portale accetta SENZA date. Per ogni candidato conosciuto
    // nel DB locale (tabella `candidates` popolata da syncArchivioCompleto
    // tramite iterazione verbali esami) facciamo 1 chiamata che ritorna TUTTI
    // i suoi rinnovi di qualsiasi anno. Deduplicazione per marca_operativa.
    //
    // Sorgenti in ordine di priorità:
    //   1. `candidates` già sincronizzati (preferito, contiene molti anni)
    //   2. `rinnovi_portale` già noti (per coprire persone non in candidates)
    //
    // Strategia A patenti: decoupled da `includeRinnoviPat` → si attiva con
    // il solo flag `includeStrategiaA`. Così un utente può richiedere SOLO la
    // Strategia A (più veloce della baseline) senza attivare tutto il resto.
    if (includeStrategiaA) {
      progress("fase2b_strategia_a_start", {
        message: "Strategia A: ricerca puntuale per persona (bypass 31gg)...",
      });
      try {
        const persone = await collectPersoneForStrategiaA({
          autoscuolaId,
          limit: strategiaAMaxPersone,
        });
        progress("fase2b_strategia_a_persone", {
          message: `Trovate ${persone.length} persone da iterare`,
          totale: persone.length,
        });

        if (persone.length === 0) {
          progress("fase2b_strategia_a_done", {
            count: 0,
            message: "Nessuna persona da iterare (tabella candidates vuota?)",
          });
        } else {
          const rinnoviA = await leggiRinnoviStoriciPerPersone(client, {
            persone,
            withDettaglio: true,
            delayMs: strategiaADelayMs,
            onProgress: (p) => progress("fase2b_strategia_a_progress", p),
          });
          stats.rinnovi_trovati += rinnoviA.length;
          stats.strategia_a_persone_iterate = persone.length;
          stats.strategia_a_rinnovi_trovati = rinnoviA.length;

          for (const rin of rinnoviA) {
            try {
              const { action } = await upsertRinnovoPortale(rin, { autoscuolaId });
              if (action === "inserted") stats.rinnovi_inseriti += 1;
              else if (action === "updated") stats.rinnovi_aggiornati += 1;
              else stats.rinnovi_invariati += 1;
            } catch (err) {
              stats.errori += 1;
              stats.ultimo_errore = `Upsert strategia A ${rin.marca_operativa}: ${err.message}`;
            }
          }
          progress("fase2b_strategia_a_done", {
            count: rinnoviA.length,
            persone_iterate: persone.length,
          });
        }
      } catch (err) {
        console.error("[syncArchivioStorico] errore Strategia A:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase Strategia A: ${err.message}`;
      }
    }

    // ── STEP 3: Rinnovi medici (TT2112) ──────────────────────────────────────
    if (includeRinnoviMed) {
      progress("fase3_rinnovi_med_start", {
        message: `Scarico rinnovi medici (${dataInizio} → ${dataFine})...`,
      });
      try {
        const rinnoviMed = await leggiRinnoviStoriciMedici(client, {
          dataInizio,
          dataFine,
          // Il portale non supporta stato vuoto. Iteriamo i 4 codici noti.
          stati: ["A", "D", "S", "R"],
          windowDays,
          withDettaglio: true,
          onProgress: (p) => progress("fase3_rinnovi_med_progress", p),
        });
        stats.rinnovi_trovati += rinnoviMed.length;

        for (const rin of rinnoviMed) {
          try {
            const { action } = await upsertRinnovoPortale(rin, { autoscuolaId });
            if (action === "inserted") stats.rinnovi_inseriti += 1;
            else if (action === "updated") stats.rinnovi_aggiornati += 1;
            else stats.rinnovi_invariati += 1;
          } catch (err) {
            stats.errori += 1;
            stats.ultimo_errore = `Upsert rinn medico ${rin.marca_operativa}: ${err.message}`;
          }
        }
        progress("fase3_rinnovi_med_done", { count: rinnoviMed.length });
      } catch (err) {
        console.error("[syncArchivioStorico] errore fase rinnovi medici:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase rinnovi med: ${err.message}`;
      }
    }

    // ── STEP 3B: STRATEGIA A — Rinnovi MEDICI per persona (bypass 31gg) ──────
    // Decoupled da `includeRinnoviMed` (stesso pattern di fase 2B).
    if (includeStrategiaA) {
      progress("fase3b_strategia_a_medici_start", {
        message: "Strategia A medici: ricerca puntuale per persona (bypass 31gg)...",
      });
      try {
        const persone = await collectPersoneForStrategiaA({
          autoscuolaId,
          limit: strategiaAMaxPersone,
        });
        progress("fase3b_strategia_a_medici_persone", {
          message: `Trovate ${persone.length} persone da iterare per medici`,
          totale: persone.length,
        });

        if (persone.length === 0) {
          progress("fase3b_strategia_a_medici_done", {
            count: 0,
            message: "Nessuna persona da iterare",
          });
        } else {
          const rinnoviMedA = await leggiRinnoviMediciStoriciPerPersone(client, {
            persone,
            withDettaglio: true,
            delayMs: strategiaADelayMs,
            onProgress: (p) => progress("fase3b_strategia_a_medici_progress", p),
          });

          if (rinnoviMedA.servizioNonDisponibile) {
            stats.strategia_a_medici_servizio_non_disponibile = true;
            progress("fase3b_strategia_a_medici_done", {
              count: 0,
              skip: true,
              message: "Modulo rinnovi medici non disponibile per l'autoscuola",
            });
          } else {
            stats.rinnovi_trovati += rinnoviMedA.length;
            stats.strategia_a_medici_persone_iterate = persone.length;
            stats.strategia_a_medici_rinnovi_trovati = rinnoviMedA.length;

            for (const rin of rinnoviMedA) {
              try {
                const { action } = await upsertRinnovoPortale(rin, { autoscuolaId });
                if (action === "inserted") stats.rinnovi_inseriti += 1;
                else if (action === "updated") stats.rinnovi_aggiornati += 1;
                else stats.rinnovi_invariati += 1;
              } catch (err) {
                stats.errori += 1;
                stats.ultimo_errore = `Upsert strategia A medico ${rin.marca_operativa}: ${err.message}`;
              }
            }
            progress("fase3b_strategia_a_medici_done", {
              count: rinnoviMedA.length,
              persone_iterate: persone.length,
            });
          }
        }
      } catch (err) {
        console.error("[syncArchivioStorico] errore Strategia A medici:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase Strategia A medici: ${err.message}`;
      }
    }

    // ── STEP 4: Rinnovi CQC ──────────────────────────────────────────────────
    if (includeRinnoviCqc) {
      progress("fase4_rinnovi_cqc_start", {
        message: `Scarico rinnovi CQC (${dataInizio} → ${dataFine})...`,
      });
      try {
        const rinnoviCqc = await leggiRinnoviStoriciCqc(client, {
          dataInizio,
          dataFine,
          // Il portale non supporta stato vuoto. Iteriamo i 4 codici noti.
          stati: ["A", "D", "S", "R"],
          windowDays,
          withDettaglio: true,
          onProgress: (p) => progress("fase4_rinnovi_cqc_progress", p),
        });
        stats.rinnovi_trovati += rinnoviCqc.length;

        for (const rin of rinnoviCqc) {
          try {
            const { action } = await upsertRinnovoPortale(rin, { autoscuolaId });
            if (action === "inserted") stats.rinnovi_inseriti += 1;
            else if (action === "updated") stats.rinnovi_aggiornati += 1;
            else stats.rinnovi_invariati += 1;
          } catch (err) {
            stats.errori += 1;
            stats.ultimo_errore = `Upsert rinn CQC ${rin.marca_operativa}: ${err.message}`;
          }
        }
        progress("fase4_rinnovi_cqc_done", { count: rinnoviCqc.length });
      } catch (err) {
        console.error("[syncArchivioStorico] errore fase rinnovi CQC:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase rinnovi CQC: ${err.message}`;
      }
    }

    // ── STEP 4B: STRATEGIA A — Rinnovi CQC per persona (bypass 31gg) ─────────
    // Decoupled da `includeRinnoviCqc` (stesso pattern di fase 2B/3B).
    if (includeStrategiaA) {
      progress("fase4b_strategia_a_cqc_start", {
        message: "Strategia A CQC: ricerca puntuale per persona (bypass 31gg)...",
      });
      try {
        const persone = await collectPersoneForStrategiaA({
          autoscuolaId,
          limit: strategiaAMaxPersone,
        });
        progress("fase4b_strategia_a_cqc_persone", {
          message: `Trovate ${persone.length} persone da iterare per CQC`,
          totale: persone.length,
        });

        if (persone.length === 0) {
          progress("fase4b_strategia_a_cqc_done", {
            count: 0,
            message: "Nessuna persona da iterare",
          });
        } else {
          const rinnoviCqcA = await leggiRinnoviCqcStoriciPerPersone(client, {
            persone,
            withDettaglio: true,
            delayMs: strategiaADelayMs,
            onProgress: (p) => progress("fase4b_strategia_a_cqc_progress", p),
          });

          if (rinnoviCqcA.servizioNonDisponibile) {
            stats.strategia_a_cqc_servizio_non_disponibile = true;
            progress("fase4b_strategia_a_cqc_done", {
              count: 0,
              skip: true,
              message: "Modulo CQC non disponibile per l'autoscuola",
            });
          } else {
            stats.rinnovi_trovati += rinnoviCqcA.length;
            stats.strategia_a_cqc_persone_iterate = persone.length;
            stats.strategia_a_cqc_rinnovi_trovati = rinnoviCqcA.length;

            for (const rin of rinnoviCqcA) {
              try {
                const { action } = await upsertRinnovoPortale(rin, { autoscuolaId });
                if (action === "inserted") stats.rinnovi_inseriti += 1;
                else if (action === "updated") stats.rinnovi_aggiornati += 1;
                else stats.rinnovi_invariati += 1;
              } catch (err) {
                stats.errori += 1;
                stats.ultimo_errore = `Upsert strategia A CQC ${rin.marca_operativa}: ${err.message}`;
              }
            }
            progress("fase4b_strategia_a_cqc_done", {
              count: rinnoviCqcA.length,
              persone_iterate: persone.length,
            });
          }
        }
      } catch (err) {
        console.error("[syncArchivioStorico] errore Strategia A CQC:", err.message);
        stats.errori += 1;
        stats.ultimo_errore = `Fase Strategia A CQC: ${err.message}`;
      }
    }

    // ── COMPLETATO ───────────────────────────────────────────────────────────
    const durationMs = Date.now() - started;
    await updateSyncLog(logId, {
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
      stato: stats.errori > 0 && (stats.rinnovi_inseriti + stats.rinnovi_aggiornati + stats.candidati_trovati) === 0
        ? "failed"
        : "success",
      candidati_trovati: stats.candidati_trovati,
      candidati_inseriti: stats.candidati_inseriti,
      candidati_aggiornati: stats.candidati_aggiornati,
      rinnovi_trovati: stats.rinnovi_trovati,
      rinnovi_inseriti: stats.rinnovi_inseriti,
      rinnovi_aggiornati: stats.rinnovi_aggiornati,
      errori: stats.errori,
      ultimo_errore: stats.ultimo_errore,
      log_dettaglio: stats,
    });

    progress("completed", { durationMs, stats });

    return {
      success: true,
      durationMs,
      logId,
      ...stats,
    };
  } catch (err) {
    console.error("[syncArchivioStorico] FATAL:", err);
    await updateSyncLog(logId, {
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      stato: "failed",
      ultimo_errore: err.message,
      log_dettaglio: stats,
    });
    throw err;
  }
}

module.exports = {
  syncArchivioStoricoCompleto,
  upsertRinnovoPortale, // esportato per sync incrementale puntuale
  computeHash,
};
