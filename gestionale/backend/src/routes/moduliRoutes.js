/**
 * moduliRoutes.js
 * Endpoint generazione PDF moduli (TT2112, comunicazioni, schede candidato).
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { requireAuth } = require("../server/auth");
const moduliController = require("../controllers/moduliController");

// POST /api/moduli/genera        → genera PDF e lo restituisce come application/pdf
router.post("/genera", requireAuth, moduliController.genera);

// POST /api/moduli/anteprima-html → restituisce l'HTML grezzo (anteprima in iframe)
router.post("/anteprima-html", requireAuth, moduliController.anteprimaHtml);

module.exports = router;
