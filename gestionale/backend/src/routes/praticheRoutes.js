/**
 * Route REST per pratiche_patente.
 * Base path: /api/pratiche
 */

const router = require("express").Router();
const ctrl   = require("../controllers/praticheController");
const { requireAuth } = require("../server/auth");

router.get("/",       requireAuth, ctrl.list);
router.get("/:id",    requireAuth, ctrl.getById);
router.post("/",      requireAuth, ctrl.create);
router.put("/:id",    requireAuth, ctrl.update);
router.delete("/:id", requireAuth, ctrl.remove);

module.exports = router;
