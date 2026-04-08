"use strict";
const router = require("express").Router();
const { requireAuth } = require("../server/auth");
const ctrl = require("../controllers/impegniController");

router.get("/in-scadenza",     requireAuth, ctrl.inScadenza);
router.get("/",                requireAuth, ctrl.list);
router.get("/:id",             requireAuth, ctrl.getById);
router.post("/",               requireAuth, ctrl.create);
router.put("/:id",             requireAuth, ctrl.update);
router.patch("/:id/stato",     requireAuth, ctrl.cambiaStato);
router.delete("/:id",          requireAuth, ctrl.remove);

module.exports = router;
