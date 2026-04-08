/**
 * Routes notifiche candidati — Punto 21
 */

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/notificheController");
const { requireAuth } = require("../server/auth");

router.get("/templates",       requireAuth, ctrl.listTemplates);
router.post("/invia",          requireAuth, ctrl.invia);
router.post("/invia-bulk",     requireAuth, ctrl.inviaBulk);
router.get("/storico",         requireAuth, ctrl.storicoPerCandidato);
router.get("/storico-globale", requireAuth, ctrl.storicoGlobale);

module.exports = router;
