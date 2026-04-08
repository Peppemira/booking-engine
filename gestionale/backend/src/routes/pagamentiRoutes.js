/**
 * Route REST per pagamenti.
 */

const router = require("express").Router();
const { pagamentiController } = require("../controllers");
const { requireAuth } = require("../server/auth");

router.get("/rendiconto", requireAuth, pagamentiController.rendiconto); // Punto 22 — prima di /:id
router.get("/", requireAuth, pagamentiController.list);
router.get("/:id", requireAuth, pagamentiController.getById);
router.post("/", requireAuth, pagamentiController.registra);
router.post("/pagoPA", requireAuth, pagamentiController.avviaPagoPA);
router.post("/satispay", requireAuth, pagamentiController.avviaSatispay);

module.exports = router;
