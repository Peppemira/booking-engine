/**
 * Route REST per dashboard Radar Sedute.
 */

const router = require("express").Router();
const { radarController } = require("../controllers");
const { requireAuth } = require("../server/auth");

router.get("/dashboard", requireAuth, radarController.getDashboard);

module.exports = router;
