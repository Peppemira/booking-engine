/**
 * Routes istruttori — base path: /api/istruttori
 * Punto 20.
 */
const router = require("express").Router();
const ctrl   = require("../controllers/istruttoriController");
const { requireAuth } = require("../server/auth");

router.get("/",             requireAuth, ctrl.list);
router.get("/:id",          requireAuth, ctrl.getById);
router.post("/",            requireAuth, ctrl.create);
router.put("/:id",          requireAuth, ctrl.update);
router.delete("/:id",       requireAuth, ctrl.remove);
router.get("/:id/guide",    requireAuth, ctrl.guideIstruttore);

module.exports = router;
