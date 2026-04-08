/**
 * Route REST per anagrafica candidati.
 * Base path: /api/candidati-api (per non sovrascrivere le esistenti /api/candidates)
 */

const router = require("express").Router();
const { candidatiController } = require("../controllers");
const { requireAuth } = require("../server/auth");

router.get("/", requireAuth, candidatiController.list);
router.post("/sync-portale", requireAuth, candidatiController.syncFromPortale);
router.post("/omonimi", requireAuth, candidatiController.omonimi);
router.patch("/sposta-archivio", requireAuth, candidatiController.spostaArchivio);
router.get("/scadenze",    requireAuth, candidatiController.scadenze);
router.get("/foglio-rosa", requireAuth, candidatiController.listConFoglioRosa);
router.get("/:id/storia",       requireAuth, candidatiController.storia);
router.get("/:id/storico-quiz", requireAuth, candidatiController.storicoQuiz);
router.get("/:id", requireAuth, candidatiController.getById);
router.post("/", requireAuth, candidatiController.create);
router.put("/:id", requireAuth, candidatiController.update);
router.delete("/:id", requireAuth, candidatiController.remove);

module.exports = router;
