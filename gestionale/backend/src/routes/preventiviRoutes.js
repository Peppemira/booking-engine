const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/preventiviController");

router.get("/statistiche",     ctrl.statistiche);
router.get("/prossimo-numero", ctrl.prossimoNumero);
router.get("/",                ctrl.list);
router.get("/:id",             ctrl.getById);
router.post("/",               ctrl.create);
router.put("/:id",             ctrl.update);
router.patch("/:id/stato",     ctrl.cambiaStato);
router.delete("/:id",          ctrl.remove);

module.exports = router;
