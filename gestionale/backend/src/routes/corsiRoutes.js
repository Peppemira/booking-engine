/**
 * Route REST per corsi (GeCorsi, PRESENZECORSI, auleLezioni, gestAule).
 * Base path: /api/corsi
 *
 * Corsi (iscrizioni candidato):
 *   GET    /api/corsi                          - lista corsi
 *   GET    /api/corsi/conteggio                - conteggio/riepilogo
 *   GET    /api/corsi/:id                      - singolo corso
 *   POST   /api/corsi                          - crea iscrizione corso
 *   PUT    /api/corsi/:id                      - aggiorna corso
 *   DELETE /api/corsi/:id                      - elimina corso
 *
 * Presenze lezioni (legate a corsi_session):
 *   GET    /api/corsi/:corsiSessionId/presenze        - lista presenze corso
 *   POST   /api/corsi/:corsiSessionId/presenze        - aggiungi presenza
 *   PUT    /api/corsi/:corsiSessionId/presenze/:id    - modifica presenza
 *   DELETE /api/corsi/:corsiSessionId/presenze/:id    - elimina presenza
 */

const router = require("express").Router();
const corsiController = require("../controllers/corsiController");
const { requireAuth } = require("../server/auth");

// Corsi – ordine importante: /conteggio prima di /:id
router.get("/conteggio", requireAuth, corsiController.conteggio);
router.get("/", requireAuth, corsiController.list);
router.get("/:id", requireAuth, corsiController.getById);
router.post("/", requireAuth, corsiController.create);
router.put("/:id", requireAuth, corsiController.update);
router.delete("/:id", requireAuth, corsiController.remove);

// Presenze lezioni
router.get("/:corsiSessionId/presenze", requireAuth, corsiController.listPresenze);
router.post("/:corsiSessionId/presenze", requireAuth, corsiController.createPresenza);
router.put("/:corsiSessionId/presenze/:id", requireAuth, corsiController.updatePresenza);
router.delete("/:corsiSessionId/presenze/:id", requireAuth, corsiController.removePresenza);

module.exports = router;
