/**
 * Routes operatori per sede — Punto 24
 */

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/operatoriController");
const { requireAuth } = require("../server/auth");

// Login operatore (pubblico)
router.post("/login", ctrl.loginOperatore);

// CRUD (protetto)
router.get("/",    requireAuth, ctrl.list);
router.get("/:id", requireAuth, ctrl.getById);
router.post("/",   requireAuth, ctrl.create);
router.put("/:id", requireAuth, ctrl.update);
router.delete("/:id", requireAuth, ctrl.remove);

module.exports = router;
