/**
 * Route REST per sedute guide.
 * Equivalente GeCA: newguide, guiobb, newcontguiall, conguist, valutazioni.
 * Base path: /api/guide
 */

const router = require("express").Router();
const guideController = require("../controllers/guideController");
const { requireAuth } = require("../server/auth");

router.get("/conteggio",                  requireAuth, guideController.conteggio);
router.get("/accompagnate",               requireAuth, guideController.listAccompagnate);  // Punto 23
router.get("/esercitazioni",              requireAuth, guideController.listEsercitazioni);
router.post("/esercitazioni",             requireAuth, guideController.createEsercitazione);
router.delete("/esercitazioni/:id",       requireAuth, guideController.deleteEsercitazione);
router.get("/",                           requireAuth, guideController.list);
router.get("/:id",                        requireAuth, guideController.getById);
router.get("/:id/foglio-rosa",            requireAuth, guideController.foglioRosa);        // Punto 23
router.post("/",                          requireAuth, guideController.create);
router.put("/:id",                        requireAuth, guideController.update);
router.delete("/:id",                     requireAuth, guideController.remove);

module.exports = router;
