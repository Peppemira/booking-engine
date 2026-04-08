/**
 * Route REST per prenotazioni esami (GeCA PrenotatoreService).
 * Montate in due punti:
 *   /api/prenotazioni-api  (legacy alias)
 *   /api/prenotazioni       (principale)
 */

const router = require("express").Router();
const prenotazioniController = require("../controllers/prenotazioniController");
const { requireAuth } = require("../server/auth");

// Originale
router.post("/prenota", requireAuth, prenotazioniController.prenota);

// Endpoint spostati da server.js
router.post("/prenota-esame", requireAuth, prenotazioniController.prenotaEsame);
router.get("/", requireAuth, prenotazioniController.list);
router.delete("/:id", requireAuth, prenotazioniController.remove);
router.put("/:id", requireAuth, prenotazioniController.update);
router.post("/:id/payment-action", requireAuth, prenotazioniController.paymentAction);

module.exports = router;
