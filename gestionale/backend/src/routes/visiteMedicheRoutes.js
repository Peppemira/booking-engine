const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/visiteMedicheController");

router.get("/prossime",     ctrl.prossime);
router.get("/statistiche",  ctrl.statistiche);
router.get("/",             ctrl.list);
router.get("/:id",          ctrl.getById);
router.post("/",            ctrl.create);
router.put("/:id",          ctrl.update);
router.delete("/:id",       ctrl.remove);

module.exports = router;
