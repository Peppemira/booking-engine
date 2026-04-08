/**
 * SNIPER ENGINE — Prenotazione istantanea lista di attesa
 * =========================================================
 * Monitora le sedute del portale con polling aggressivo (default 10s).
 * Appena trova posti liberi, prenota immediatamente tutti i candidati
 * in attesa usando `prenotazioneDirectUrl` (visualizzaCaptcha=false) +
 * login diretto HTTP (< 300ms, nessun Puppeteer).
 *
 * Architettura:
 *  - Singleton EventEmitter: emette 'tick', 'booking', 'booked', 'error', 'status'
 *  - Sessione portale condivisa e mantenuta viva (refresh proattivo a 18 min)
 *  - Booking atomico via Supabase: lock ottimistico su waitlist.status
 *  - SSE-ready: server.js sottoscrive gli eventi e li inoltra ai client
 *
 * Variabili .env rilevanti:
 *   SNIPER_INTERVAL_MS   Intervallo polling in ms (default 10000)
 *   SNIPER_ENABLED       "true" per avviare automaticamente (default false)
 *   SNIPER_MAX_SEATS     Max candidati prenotati per ciclo (default 6)
 *   PORTAL_SESSION_TTL_MS TTL sessione (default 1200000 = 20 min)
 */

require("dotenv").config({ quiet: true });

const EventEmitter = require("events");
const supabase     = require("./database/supabase");
const { getOrLoginJarFast, loginDirectHttp } = require("./connector/portalSession");
const { makeHttpClient, readSessioniQuizInterne } = require("./connector/portalHttp");
const { parseSessioni } = require("./parser/sessionParser");
const { prenotazioneDirectUrl } = require("./connector/booking");
const { sendTelegram } = require("./telegram");
const { saveEngineStatus } = require("./server/engineStatus");
const { getSearchSettings, isWithinSearchWindow } = require("./server/searchSettings");

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------
const DEFAULT_INTERVAL_MS = 10_000;   // 10 secondi
const SESSION_REFRESH_MS  = 18 * 60 * 1000; // 18 minuti (prima dei 20 min TTL)
const MAX_SEATS_PER_CYCLE = 6;

// ---------------------------------------------------------------------------
// Stato interno (singleton)
// ---------------------------------------------------------------------------
let _running       = false;
let _intervalHandle = null;
let _sessionJar    = null;
let _sessionCreatedAt = 0;
let _cycleCount    = 0;
let _lastStatus    = { running: false, lastAt: null, message: "Non avviato", result: "idle" };

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emit(event, data) {
  emitter.emit(event, { at: new Date().toISOString(), ...data });
  emitter.emit("*", { event, at: new Date().toISOString(), ...data });
}

function setStatus(running, result, message, extra = {}) {
  _lastStatus = { running, result, message, lastAt: new Date().toISOString(), ...extra };
  emit("status", _lastStatus);
}

function log(msg, ...args) {
  console.log(`[sniper] ${msg}`, ...args);
}

/** Recupera la sessione portale (usa cache + refresh proattivo) */
async function getSession() {
  const now = Date.now();
  if (_sessionJar && now - _sessionCreatedAt < SESSION_REFRESH_MS) {
    return _sessionJar;
  }
  log("Avvio login diretto HTTP...");
  const t0 = Date.now();
  _sessionJar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      process.env.PORTAL_PIN,
  });
  _sessionCreatedAt = Date.now();
  log(`Login completato in ${Date.now() - t0}ms`);
  return _sessionJar;
}

/** Invalida la sessione attuale (richiederà nuovo login al prossimo ciclo) */
function invalidateSession() {
  _sessionJar = null;
  _sessionCreatedAt = 0;
}

/** Estrae il selectRowId dai campi nascosti della sessione */
function extractSelectRowId(sessione) {
  const hf = sessione?.hiddenFields || {};
  // Cerca il campo che contiene "selectRowId"
  for (const [key, value] of Object.entries(hf)) {
    if (key.toLowerCase().includes("selectrowid") && value && String(value).trim()) {
      return String(value).trim();
    }
  }
  // Fallback: il sessionId della sessione
  return String(sessione?.sessionId || "").trim();
}

/** Conta posti disponibili da stringa portale */
function parsePosti(postiStr) {
  const n = Number.parseInt(String(postiStr || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Carica i candidati pending dalla waitlist con i dati necessari */
async function loadCandidatiPending(limit = MAX_SEATS_PER_CYCLE) {
  const { data, error } = await supabase
    .from("waitlist")
    .select(
      "id, candidate_id, priority, created_at, " +
      "candidates(id, nome, cognome, codice_fiscale, codice_foglio_rosa, raw_portale)"
    )
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error("Supabase waitlist: " + error.message);
  return data || [];
}

/** Esegue il lock ottimistico sulla riga waitlist (pending → in_progress) */
async function lockCandidato(id) {
  const { data, error } = await supabase
    .from("waitlist")
    .update({ status: "in_progress", last_attempt_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")   // solo se ancora pending (lock ottimistico)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Errore lock: " + error.message);
  return !!data; // true se il lock ha avuto successo
}

/** Segna come prenotato con successo */
async function markPrenotato(id) {
  await supabase.from("waitlist").update({
    status:    "prenotato",
    last_error: null,
    last_attempt_at: new Date().toISOString(),
  }).eq("id", id);
}

/** Ritorna a pending dopo fallimento */
async function markPending(id, errMsg) {
  await supabase.from("waitlist").update({
    status:    "pending",
    last_error: String(errMsg || "").slice(0, 500),
    last_attempt_at: new Date().toISOString(),
  }).eq("id", id);
}

// ---------------------------------------------------------------------------
// CICLO PRINCIPALE
// ---------------------------------------------------------------------------

async function runCycle() {
  if (!_running) return;
  _cycleCount++;

  // Controlla finestra operatore
  try {
    const settings = await getSearchSettings();
    const forceRun = String(process.env.ENGINE_FORCE_RUN || "false").toLowerCase() === "true";
    if (!isWithinSearchWindow(settings) && !forceRun) {
      setStatus(true, "paused", "Fuori finestra operatore");
      return;
    }
  } catch (_) { /* ignora errori settings */ }

  // Carica candidati in attesa
  let candidati;
  try {
    candidati = await loadCandidatiPending();
  } catch (err) {
    log("Errore caricamento waitlist:", err.message);
    setStatus(true, "error", "Errore DB: " + err.message);
    return;
  }

  if (!candidati.length) {
    setStatus(true, "idle", "Nessun candidato in attesa");
    emit("tick", { cycle: _cycleCount, pending: 0, sessioni: 0 });
    return;
  }

  // Sessione portale
  let jar, client, sessioni;
  try {
    jar    = await getSession();
    client = makeHttpClient(jar);

    const t0  = Date.now();
    const html = await readSessioniQuizInterne(client, {});
    sessioni   = parseSessioni(html);
    log(`Ciclo #${_cycleCount}: ${sessioni.length} sedute in ${Date.now() - t0}ms`);
    emit("tick", { cycle: _cycleCount, pending: candidati.length, sessioni: sessioni.length });
  } catch (err) {
    log("Errore lettura sedute:", err.message);
    invalidateSession(); // forza nuovo login al prossimo ciclo
    setStatus(true, "error", "Errore lettura portale: " + err.message);
    return;
  }

  // Filtra sessioni con posti disponibili
  const sessioniConPosti = sessioni.filter(s => parsePosti(s.posti) > 0);
  if (!sessioniConPosti.length) {
    setStatus(true, "watching", `Nessun posto disponibile (${sessioni.length} sedute)`);
    return;
  }

  log(`✅ ${sessioniConPosti.length} seduta/e con posti liberi! Avvio prenotazioni...`);
  setStatus(true, "booking", `${sessioniConPosti.length} seduta/e con posti`);

  // Prendi la prima seduta con posti
  const seduta     = sessioniConPosti[0];
  const idVerbale  = extractSelectRowId(seduta);
  const postiDisp  = parsePosti(seduta.posti);

  if (!idVerbale) {
    log("❌ selectRowId non trovato nella seduta:", seduta);
    setStatus(true, "error", "selectRowId non trovato");
    return;
  }

  // Prenota candidati (fino a min(postiDisp, candidati.length) per ciclo)
  const toBook = candidati.slice(0, Math.min(postiDisp, MAX_SEATS_PER_CYCLE));
  let prenotati = 0;

  for (const row of toBook) {
    const cand = row?.candidates;
    if (!cand) { log("Dati candidato mancanti per riga", row.id); continue; }

    const codiceFoglioRosa = String(cand.codice_foglio_rosa || cand.raw_portale?.codice_foglio_rosa || "").trim();
    const cognome          = String(cand.cognome || "").trim();
    const turnoEsaminatore = String(cand.raw_portale?.turno_esaminatore || cand.raw_portale?.turno || "1").trim();
    const lingua           = String(cand.raw_portale?.lingua || cand.raw_portale?.codice_lingua || "IT").trim();
    const audio            = String(cand.raw_portale?.supporto_audio || "N").trim();

    if (!codiceFoglioRosa || !cognome) {
      log(`Dati incompleti per candidato ${row.candidate_id}: foglio=${codiceFoglioRosa}, cognome=${cognome}`);
      await markPending(row.id, "codiceFoglioRosa o cognome mancanti");
      continue;
    }

    // Lock ottimistico
    const locked = await lockCandidato(row.id);
    if (!locked) {
      log(`Candidato ${row.id} già preso da altro processo`);
      continue;
    }

    try {
      emit("booking", {
        candidatoId: row.candidate_id,
        nome: `${cand.nome || ""} ${cand.cognome || ""}`.trim(),
        idVerbale,
        turno: turnoEsaminatore,
      });

      const t0 = Date.now();
      const resultHtml = await prenotazioneDirectUrl(client, {
        idVerbale,
        tipoSessione:     "SQI",
        codiceFoglioRosa,
        cognome,
        turnoEsaminatore,
        lingua,
        audio,
      });
      const elapsed = Date.now() - t0;

      const normalized    = String(resultHtml || "").toLowerCase();
      const success       = /prenotat[oa] con successo|candidato e' stato prenotato con successo|conferma prenotazione/.test(normalized);
      const noSeats       = /non ci sono posti disponibili|posti terminati|posti autoscuole raggiunto|limite posti/.test(normalized);
      const alreadyBooked = /già in prenotazione|gia' in prenotazione/.test(normalized);

      if (success || alreadyBooked) {
        await markPrenotato(row.id);
        prenotati++;
        log(`✅ Prenotato ${cand.nome} ${cand.cognome} in ${elapsed}ms`);
        emit("booked", {
          candidatoId: row.candidate_id,
          nome:  `${cand.nome || ""} ${cand.cognome || ""}`.trim(),
          idVerbale,
          elapsed,
          alreadyBooked,
        });
        await sendTelegram(
          `✅ Prenotazione ISTANTANEA completata!\nCandidato: ${cand.nome} ${cand.cognome}\nSeduta ID: ${idVerbale}\nTempo: ${elapsed}ms`
        ).catch(() => {});
      } else if (noSeats) {
        await markPending(row.id, "Nessun posto disponibile al momento del booking");
        log(`⚠️ Nessun posto al momento della prenotazione per ${cand.cognome}`);
        break; // Non provare altri candidati su questa seduta
      } else {
        // Risposta ambigua — ritorna pending per riprova
        await markPending(row.id, "Risposta ambigua portale");
        log(`⚠️ Risposta ambigua per ${cand.cognome}`);
      }
    } catch (bookErr) {
      log(`❌ Errore prenotazione ${cand.cognome}:`, bookErr.message);
      await markPending(row.id, bookErr.message);
      if (bookErr.message?.includes("sessione") || bookErr.message?.includes("login") || bookErr.message?.includes("403")) {
        invalidateSession();
        break; // Sessione scaduta, riprova al prossimo ciclo
      }
    }
  }

  if (prenotati > 0) {
    setStatus(true, "ok", `${prenotati} candidato/i prenotato/i`);
    await saveEngineStatus({
      running: true,
      lastFinishedAt: new Date().toISOString(),
      lastResult: "ok",
      lastMessage: `Sniper: ${prenotati} prenotazione/i effettuate`,
      pid: process.pid,
      trigger: "sniper",
    }).catch(() => {});
  } else {
    setStatus(true, "watching", `Seduta rilevata ma nessuna prenotazione completata`);
  }
}

// ---------------------------------------------------------------------------
// API PUBBLICA
// ---------------------------------------------------------------------------

/**
 * Avvia il motore sniper.
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] - Intervallo polling in ms (default SNIPER_INTERVAL_MS)
 */
function start(opts = {}) {
  if (_running) {
    log("Già in esecuzione");
    return;
  }

  const intervalMs = opts.intervalMs
    || Number(process.env.SNIPER_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  _running     = true;
  _cycleCount  = 0;
  log(`Avviato — polling ogni ${intervalMs / 1000}s`);
  setStatus(true, "starting", `Avviato — polling ogni ${intervalMs / 1000}s`, { intervalMs });

  // Prima esecuzione immediata
  runCycle().catch(err => log("Errore ciclo:", err.message));

  _intervalHandle = setInterval(() => {
    runCycle().catch(err => log("Errore ciclo:", err.message));
  }, intervalMs);
}

/**
 * Ferma il motore.
 */
function stop() {
  if (!_running) return;
  _running = false;
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  invalidateSession();
  log("Fermato");
  setStatus(false, "stopped", "Sniper fermato");
}

/**
 * Esegue un ciclo singolo manuale (senza avviare il loop).
 */
async function forceRun() {
  log("Esecuzione forzata singola");
  await runCycle();
}

/**
 * Restituisce lo stato corrente.
 */
function getStatus() {
  return {
    ..._lastStatus,
    running:    _running,
    cycleCount: _cycleCount,
    sessionActive: !!_sessionJar && Date.now() - _sessionCreatedAt < SESSION_REFRESH_MS,
  };
}

/**
 * Registra un listener su tutti gli eventi sniper.
 * @param {function} fn - callback({ event, at, ...data })
 * @returns {function} deregistra il listener
 */
function subscribe(fn) {
  emitter.on("*", fn);
  return () => emitter.off("*", fn);
}

// Auto-avvio se configurato
if (String(process.env.SNIPER_ENABLED || "false").toLowerCase() === "true") {
  start();
}

module.exports = {
  start,
  stop,
  forceRun,
  getStatus,
  subscribe,
  emitter,
};
