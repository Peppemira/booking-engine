/**
 * Route REST per documenti / SDC.
 */

const router = require("express").Router();
const { documentiController } = require("../controllers");
const { requireAuth } = require("../server/auth");

router.post("/invia-dc", requireAuth, documentiController.inviaDC);
router.post("/parse-esiti", requireAuth, documentiController.parseEsiti);

module.exports = router;
