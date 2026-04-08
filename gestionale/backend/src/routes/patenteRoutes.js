/**
 * Route REST per pratiche patente.
 */

const router = require("express").Router();
const { patenteController } = require("../controllers");
const { requireAuth } = require("../server/auth");

router.get("/", requireAuth, patenteController.list);
router.get("/:id", requireAuth, patenteController.getById);
router.post("/", requireAuth, patenteController.create);
router.put("/:id", requireAuth, patenteController.update);

module.exports = router;
