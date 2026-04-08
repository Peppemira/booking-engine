"use strict";
const router = require("express").Router();
const { requireAuth } = require("../server/auth");
const ctrl = require("../controllers/committentiController");

router.get("/",      requireAuth, ctrl.list);
router.get("/:id",   requireAuth, ctrl.getById);
router.post("/",     requireAuth, ctrl.create);
router.put("/:id",   requireAuth, ctrl.update);
router.delete("/:id",requireAuth, ctrl.remove);

module.exports = router;
