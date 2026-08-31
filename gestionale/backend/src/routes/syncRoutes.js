/**
 * Route REST per sync portale → Supabase.
 */

const router = require("express").Router();
const { syncController } = require("../controllers");
const { requireAuth } = require("../server/auth");

router.get("/pratiche", requireAuth, syncController.syncPratiche);
router.post("/pratiche", requireAuth, syncController.syncPratiche);

router.post("/candidati", requireAuth, syncController.syncCandidati);

router.post("/completo", requireAuth, syncController.syncCompleto);

// Sync archivio completo — replica iPatente (tutti i candidati + scheda + foto/firma)
// Supporta sia JSON che SSE (Accept: text/event-stream per progress streaming)
router.post("/archivio-completo", requireAuth, syncController.syncArchivioCompletoHandler);

// Sync archivio STORICO completo — scarica TUTTO lo storico:
//   - candidati da verbali esami (4 combinazioni P/T, Q/T, P/G, Q/G)
//   - rinnovi patente (tutti stati, tutti anni)
//   - rinnovi medici (TT2112)
//   - rinnovi/conseguimento CQC
// Supporta sia JSON che SSE (Accept: text/event-stream per progress streaming)
router.post("/archivio-storico-completo", requireAuth, syncController.syncArchivioStoricoCompletoHandler);

// Log degli ultimi run di sync (dashboard)
router.get("/archivio-log", requireAuth, syncController.getArchivioSyncLogHandler);

// Riepilogo dashboard archivio (conteggi per tipo, ultimo sync, ecc.)
router.get("/archivio-riepilogo", requireAuth, syncController.getArchivioRiepilogoHandler);

// Scheduler backend (sync incrementale tempo reale)
router.get("/archivio-scheduler/status",   requireAuth, syncController.archivioSchedulerStatusHandler);
router.post("/archivio-scheduler/trigger", requireAuth, syncController.archivioSchedulerTriggerHandler);

// Foto e firma per singolo candidato
router.post("/foto-firma", requireAuth, syncController.syncFotoFirmaHandler);

module.exports = router;
