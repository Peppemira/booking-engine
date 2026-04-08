/**
 * Route REST per Portal Sync (lettura dati dal Portale Automobilista).
 * Base path: /api/portal-sync
 */

const router = require("express").Router();
const ctrl   = require("../controllers/portalSyncController");
const { requireAuth } = require("../server/auth");

// Punto 9 — Dati patente posseduta
router.get("/patente-posseduta", requireAuth, ctrl.getPatenteHandler);

// Punto 10 — Esiti esami svolti (quiz / guida / scritto)
router.get("/esami-svolti", requireAuth, ctrl.getEsamiSvoltiHandler);

// Punto 10 — Salva esiti esame su Supabase
router.post("/salva-esiti-esame", requireAuth, ctrl.salvaEsitiEsameHandler);

// Punto 11 — Esami prenotati per candidato
router.get("/esami-candidato", requireAuth, ctrl.getEsamiCandidatoHandler);

// Punto 12 — Rinnovi attivi
router.get("/rinnovi-attivi", requireAuth, ctrl.getRinnoviAttiviHandler);

// Punto 7 — Ricevuta sostitutiva (lettura)
router.get("/ricevuta-sostitutiva", requireAuth, ctrl.getRicevutaSostitutivaHandler);

// Punto 7 — Ricevuta sostitutiva (generazione)
router.post("/ricevuta-sostitutiva", requireAuth, ctrl.postRicevutaSostitutivaHandler);

// Punto 14 — Allievi prenotati (quiz + guida per autoscuola)
router.get("/allievi-prenotati", requireAuth, ctrl.getAllieviPrenotatiHandler);

// Punto 8 — Certificato medico TT2112
router.get("/certificato-medico", requireAuth, ctrl.getCertificatoMedicoHandler);

// Punto 13 — Sync bidirezionale dati candidato dal portale
router.get("/sync-candidato", requireAuth, ctrl.syncCandidatoHandler);

// Punto 13 — Anomalie portale (pratiche bloccate / con problemi)
router.get("/anomalie", requireAuth, ctrl.getAnomalieHandler);

module.exports = router;
