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

// Foto e firma per singolo candidato
router.post("/foto-firma", requireAuth, syncController.syncFotoFirmaHandler);

module.exports = router;
