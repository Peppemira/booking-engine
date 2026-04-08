/**
 * Route REST per portale (punti patente, login, PIN, import, RichiestaPatenti).
 */

const router = require("express").Router();
const { portaleController } = require("../controllers");
const { requireAuth } = require("../server/auth");

// --- Originali ---
router.post("/punti-patente",               requireAuth, portaleController.puntiPatente);
router.post("/login",                                    portaleController.login);
router.post("/validate-pin",                             portaleController.validatePin);

// --- Import pagina /import (GeCA: creaarchivio / sistArchivi) ---
router.post("/search-results",              requireAuth, portaleController.searchResults);
router.post("/import-massivo",              requireAuth, portaleController.importMassivo);
router.post("/import-archivio",             requireAuth, portaleController.importArchivio);
router.post("/import-candidates",           requireAuth, portaleController.importCandidates);

// --- RichiestaPatenti (replica GeCA) ---
router.post("/cerca-candidato-patente",     requireAuth, portaleController.cercaCandidatoPatente);
router.post("/cerca-candidato-medico",      requireAuth, portaleController.cercaCandidatoMedico);
router.post("/cerca-per-marca",             requireAuth, portaleController.cercaPerMarca);
router.post("/cerca-richieste-esame",       requireAuth, portaleController.cercaRichiesteEsame);
router.post("/nuova-iscrizione-esame",      requireAuth, portaleController.nuovaIscrizioneEsame);
router.post("/foglio-rosa",                 requireAuth, portaleController.foglioRosa);
router.post("/rinnovo-patente",             requireAuth, portaleController.rinnovoPatente);
router.post("/cerca-cqc",                   requireAuth, portaleController.cercaCQC);
router.post("/cambio-codice-autoscuola",    requireAuth, portaleController.cambioCodiceAutoscuola);

module.exports = router;
