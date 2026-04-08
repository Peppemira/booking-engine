/**
 * Scheduler Radar Sedute: controllo ogni 30 secondi (08:00–21:00) e auto-prenotazione.
 */

const cron = require("node-cron");
const { autoBook } = require("./autoBookingService");

const CRON_RADAR = "*/30 * * * * *";
const ORA_INIZIO = 8;
const ORA_FINE = 21;

let _started = false;

function startScheduler() {
  if (_started) return;
  _started = true;

  cron.schedule(CRON_RADAR, async () => {
    const ora = new Date().getHours();
    if (ora < ORA_INIZIO || ora > ORA_FINE) return;

    try {
      await autoBook();
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[Radar Scheduler] Errore:", e.message);
      }
    }
  });

  if (process.env.NODE_ENV !== "test") {
    console.log("[Radar Scheduler] Avviato: controllo ogni 30s dalle 08:00 alle 21:00");
  }
}

function stopScheduler() {
  _started = false;
}

module.exports = {
  startScheduler,
  stopScheduler,
};
