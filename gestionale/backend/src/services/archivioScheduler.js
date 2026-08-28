/**
 * ARCHIVIO SCHEDULER
 * ====================================================================
 * Esegue automaticamente sync incrementali dell'archivio storico Portale
 * per mantenere il database allineato in "tempo reale".
 *
 * Strategia:
 *   - Ogni ARCHIVIO_SYNC_INCREMENTAL_MIN minuti (default 5) esegue un sync
 *     incrementale degli ultimi 7 giorni SOLO per i rinnovi (no esami, troppo
 *     lenti per chiamarsi con questa cadenza).
 *
 *   - Ogni ARCHIVIO_SYNC_DAILY_HOUR ora (default 03) esegue un sync più
 *     largo (ultimi 90 giorni) di tutto: esami + rinnovi pat/med/cqc.
 *
 *   - Ogni domenica ARCHIVIO_SYNC_WEEKLY_HOUR (default 02) esegue un sync
 *     completo storico (tutti gli anni) come fallback per recuperare eventuali
 *     pratiche molto vecchie mancanti.
 *
 * Cosa viene aggiornato:
 *   - public.rinnovi_portale  (con hash_contenuto → upsert intelligente)
 *   - public.candidates       (via syncArchivioCompleto esistente)
 *   - public.archivio_sync_log (ogni run lascia traccia)
 *
 * ENV vars:
 *   ARCHIVIO_SCHEDULER_ENABLED     "true" per abilitare (default "false")
 *   ARCHIVIO_SYNC_INCREMENTAL_MIN  Periodicità sync incrementale in minuti (default 5)
 *   ARCHIVIO_SYNC_DAILY_HOUR       Ora del sync giornaliero 0-23 (default 3)
 *   ARCHIVIO_SYNC_WEEKLY_HOUR      Ora del sync settimanale 0-23 (default 2)
 *   ARCHIVIO_SYNC_WINDOW_DAYS      Finestra iterazione (default 180)
 *   CODICE_AUTOSCUOLA              Codice meccanografico da sincronizzare
 *   PORTAL_UFFICIO_MCTC            Codice ufficio MCTC
 */

"use strict";

const cron = require("node-cron");
const supabase = require("../database/supabase");
const { syncArchivioStoricoCompleto } = require("../connector/syncArchivioStorico");

let _started = false;
let _incrementalRunning = false;
let _dailyRunning = false;
let _weeklyRunning = false;

const ENABLED = String(process.env.ARCHIVIO_SCHEDULER_ENABLED || "false").toLowerCase() === "true";
const INCREMENTAL_MIN  = Number(process.env.ARCHIVIO_SYNC_INCREMENTAL_MIN || 5);
const DAILY_HOUR       = Number(process.env.ARCHIVIO_SYNC_DAILY_HOUR || 3);
const WEEKLY_HOUR      = Number(process.env.ARCHIVIO_SYNC_WEEKLY_HOUR || 2);
const WINDOW_DAYS      = Number(process.env.ARCHIVIO_SYNC_WINDOW_DAYS || 180);

// ---------------------------------------------------------------------------
// Risolvi tutte le autoscuole da sincronizzare automaticamente
// ---------------------------------------------------------------------------

async function getAutoscuoleAttive() {
  // Se c'è una singola autoscuola configurata via ENV, usa quella
  const envCodice = process.env.CODICE_AUTOSCUOLA;
  if (envCodice) {
    const { data } = await supabase
      .from("autoscuole")
      .select("id, codice_meccanografico, ufficio_mctc, portal_user, portal_pass, portal_pin")
      .eq("codice_meccanografico", envCodice)
      .maybeSingle();
    if (data) return [data];
  }

  // Altrimenti prendi TUTTE le autoscuole che hanno credenziali portale
  const { data } = await supabase
    .from("autoscuole")
    .select("id, codice_meccanografico, ufficio_mctc, portal_user, portal_pass, portal_pin")
    .not("portal_user", "is", null);
  return data || [];
}

/** Credenziali portale dal record autoscuola (null se incomplete → login con le env). */
function credenzialiDaAutoscuola(aut) {
  if (aut?.portal_user && aut?.portal_pass) {
    return { username: aut.portal_user, password: aut.portal_pass, pin: aut.portal_pin || process.env.PORTAL_PIN || null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sync incrementale (ultimi 7 giorni, solo rinnovi)
// ---------------------------------------------------------------------------

async function runIncremental() {
  if (_incrementalRunning) {
    console.log("[archivioScheduler] Incremental: run precedente ancora in corso, skip");
    return;
  }
  _incrementalRunning = true;

  const started = Date.now();
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const dataInizio = weekAgo.toISOString().slice(0, 10);
    const dataFine = new Date().toISOString().slice(0, 10);

    const autoscuole = await getAutoscuoleAttive();
    if (!autoscuole.length) {
      console.log("[archivioScheduler] Incremental: nessuna autoscuola attiva, skip");
      return;
    }

    for (const aut of autoscuole) {
      try {
        await syncArchivioStoricoCompleto({
          idAutAg: aut.codice_meccanografico || "",
          codUfficioMctc: aut.ufficio_mctc || process.env.PORTAL_UFFICIO_MCTC || "",
          autoscuolaId: aut.id,
          credenziali: credenzialiDaAutoscuola(aut),
          includeEsami: false,     // esami esclusi dall'incrementale (troppo lenti)
          includeRinnoviPat: true,
          includeRinnoviMed: true,
          includeRinnoviCqc: true,
          dataInizio,
          dataFine,
          windowDays: 30,
          tipoSync: "incrementale",
          triggerSource: "cron-incrementale",
        });
      } catch (err) {
        console.warn(`[archivioScheduler] Incremental ${aut.codice_meccanografico}:`, err.message);
      }
    }

    console.log(`[archivioScheduler] Incremental completato in ${Date.now() - started}ms`);
  } catch (err) {
    console.error("[archivioScheduler] Incremental errore:", err.message);
  } finally {
    _incrementalRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Sync giornaliero (ultimi 90 giorni, tutto)
// ---------------------------------------------------------------------------

async function runDaily() {
  if (_dailyRunning) {
    console.log("[archivioScheduler] Daily: run precedente ancora in corso, skip");
    return;
  }
  _dailyRunning = true;

  const started = Date.now();
  try {
    const ninetyAgo = new Date();
    ninetyAgo.setDate(ninetyAgo.getDate() - 90);
    const dataInizio = ninetyAgo.toISOString().slice(0, 10);
    const dataFine = new Date().toISOString().slice(0, 10);

    const autoscuole = await getAutoscuoleAttive();
    for (const aut of autoscuole) {
      try {
        await syncArchivioStoricoCompleto({
          idAutAg: aut.codice_meccanografico || "",
          codUfficioMctc: aut.ufficio_mctc || process.env.PORTAL_UFFICIO_MCTC || "",
          autoscuolaId: aut.id,
          credenziali: credenzialiDaAutoscuola(aut),
          includeEsami: true,
          includeRinnoviPat: true,
          includeRinnoviMed: true,
          includeRinnoviCqc: true,
          dataInizio,
          dataFine,
          windowDays: WINDOW_DAYS,
          tipoSync: "incrementale",
          triggerSource: "cron-daily",
        });
      } catch (err) {
        console.warn(`[archivioScheduler] Daily ${aut.codice_meccanografico}:`, err.message);
      }
    }
    console.log(`[archivioScheduler] Daily completato in ${Date.now() - started}ms`);
  } catch (err) {
    console.error("[archivioScheduler] Daily errore:", err.message);
  } finally {
    _dailyRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Sync settimanale (tutto lo storico)
// ---------------------------------------------------------------------------

async function runWeekly() {
  if (_weeklyRunning) {
    console.log("[archivioScheduler] Weekly: run precedente ancora in corso, skip");
    return;
  }
  _weeklyRunning = true;

  const started = Date.now();
  try {
    const autoscuole = await getAutoscuoleAttive();
    for (const aut of autoscuole) {
      try {
        await syncArchivioStoricoCompleto({
          idAutAg: aut.codice_meccanografico || "",
          codUfficioMctc: aut.ufficio_mctc || process.env.PORTAL_UFFICIO_MCTC || "",
          autoscuolaId: aut.id,
          credenziali: credenzialiDaAutoscuola(aut),
          includeEsami: true,
          includeRinnoviPat: true,
          includeRinnoviMed: true,
          includeRinnoviCqc: true,
          dataInizio: "2000-01-01",
          dataFine: new Date().toISOString().slice(0, 10),
          windowDays: WINDOW_DAYS,
          tipoSync: "full",
          triggerSource: "cron-weekly",
        });
      } catch (err) {
        console.warn(`[archivioScheduler] Weekly ${aut.codice_meccanografico}:`, err.message);
      }
    }
    console.log(`[archivioScheduler] Weekly completato in ${Date.now() - started}ms`);
  } catch (err) {
    console.error("[archivioScheduler] Weekly errore:", err.message);
  } finally {
    _weeklyRunning = false;
  }
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

function startArchivioScheduler() {
  if (_started) return;
  if (!ENABLED) {
    console.log("[archivioScheduler] disabilitato (ARCHIVIO_SCHEDULER_ENABLED != true)");
    return;
  }
  _started = true;

  // Sync incrementale: ogni N minuti
  const incrementalExpr = `*/${Math.max(1, INCREMENTAL_MIN)} * * * *`;
  cron.schedule(incrementalExpr, () => {
    runIncremental().catch((err) =>
      console.error("[archivioScheduler] runIncremental error:", err.message)
    );
  });

  // Sync giornaliero: ogni giorno alle DAILY_HOUR:15
  const dailyExpr = `15 ${DAILY_HOUR} * * *`;
  cron.schedule(dailyExpr, () => {
    runDaily().catch((err) =>
      console.error("[archivioScheduler] runDaily error:", err.message)
    );
  });

  // Sync settimanale: ogni domenica alle WEEKLY_HOUR:30
  const weeklyExpr = `30 ${WEEKLY_HOUR} * * 0`;
  cron.schedule(weeklyExpr, () => {
    runWeekly().catch((err) =>
      console.error("[archivioScheduler] runWeekly error:", err.message)
    );
  });

  console.log(
    `[archivioScheduler] Avviato: incrementale ogni ${INCREMENTAL_MIN}m, daily ${DAILY_HOUR}:15, weekly dom ${WEEKLY_HOUR}:30`
  );
}

function stopArchivioScheduler() {
  _started = false;
  // Nota: node-cron non ha API per fermare task specifiche senza mantenere
  // i riferimenti. Il flag _started previene re-start; i cron esistenti restano
  // ma con i guard _*_Running si evitano run sovrapposti.
}

function isArchivioSchedulerRunning() {
  return _started;
}

/**
 * Trigger manuale (usato da endpoint di amministrazione).
 */
async function triggerManual(type = "incremental") {
  switch (type) {
    case "incremental": return runIncremental();
    case "daily":       return runDaily();
    case "weekly":      return runWeekly();
    default: throw new Error(`tipo sconosciuto: ${type}`);
  }
}

module.exports = {
  startArchivioScheduler,
  stopArchivioScheduler,
  isArchivioSchedulerRunning,
  triggerManual,
  runIncremental,
  runDaily,
  runWeekly,
};
