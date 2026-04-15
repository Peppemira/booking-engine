/**
 * Route REST per Trasmissioni CED (equivalente GeCA frmTrasmiss).
 * Include sia trasmissioni SDC/Agenzia Entrate che trasmissioni Portale Automobilista.
 */

const router = require("express").Router();
const trasmissController = require("../controllers/trasmissController");
const { requireAuth } = require("../server/auth");

// =============================================================================
// TRASMISSIONI SDC / AGENZIA ENTRATE (originali)
// =============================================================================

// Lista pratiche pronte per trasmissione (SDC)
router.get("/pratiche-pronte", requireAuth, trasmissController.pratichePronte);

// Storico trasmissioni (SDC)
router.get("/storico", requireAuth, trasmissController.storico);

// Invio singolo (SDC)
router.post("/invia", requireAuth, trasmissController.invia);

// Invio massivo (SDC)
router.post("/invia-massivo", requireAuth, trasmissController.inviaMassivo);

// Aggiorna stato pratica
router.put("/stato/:id", requireAuth, trasmissController.aggiornaStato);

// =============================================================================
// TRASMISSIONI PORTALE AUTOMOBILISTA (Puppeteer / form portal)
// =============================================================================

// Lista pratiche pronte per trasmissione portale
router.get(
  "/portale/pratiche-pronte",
  requireAuth,
  trasmissController.praticheProntePortale
);

// Verifica rinnovabilità patente (check preventivo rinnovo)
router.post(
  "/portale/rinnovabilita",
  requireAuth,
  trasmissController.rinnovabilitaHandler
);

// Conseguimento patente (A/B/C/D/AM)
router.post(
  "/portale/conseguimento",
  requireAuth,
  trasmissController.conseguimentoHandler
);

// Conseguimento CQC
router.post(
  "/portale/cqc",
  requireAuth,
  trasmissController.cqcHandler
);

// Rinnovo CQC (tipoMotivo=R)
router.post(
  "/portale/rinnovo-cqc",
  requireAuth,
  trasmissController.rinnCqcHandler
);

// Prima fase (AM/A1/A2/A)
router.post(
  "/portale/prima-fase",
  requireAuth,
  trasmissController.primaFaseHandler
);

// Rinnovo patente completo
router.post(
  "/portale/rinnovo",
  requireAuth,
  trasmissController.rinnovoHandler
);

// Rinnovo con certificato medico TT2112
router.post(
  "/portale/rinnovo-medico",
  requireAuth,
  trasmissController.rinnovoMedicoHandler
);

// Pratica Altro (duplicato / smarrimento / deterioramento)
router.post(
  "/portale/altro",
  requireAuth,
  trasmissController.altroHandler
);

// Esercitazioni di guida — trasmissione ore sul portale
router.post(
  "/portale/guide",
  requireAuth,
  trasmissController.guideHandler
);

// Stampa attestato guide
router.post(
  "/portale/stampa-attestato",
  requireAuth,
  trasmissController.stampaAttestatoHandler
);

// =============================================================================
// SESSIONI ESAME PROGRAMMATO (SGOS/SQI)
// =============================================================================

// Cerca sessioni disponibili (query: data_da, data_a, tipo_sessione, username, password, pin)
router.get(
  "/portale/sessioni-esame",
  requireAuth,
  trasmissController.sessioniEsameHandler
);

// Prenota candidato in una sessione
router.post(
  "/portale/prenota-esame",
  requireAuth,
  trasmissController.prenotaEsameHandler
);

// =============================================================================
// CANDIDATI-CENTRIC (replica GeCA Trasmiss.cs — invio da iscrizione candidato)
// =============================================================================

// Lista candidati pronti per trasmissione raggruppati per sigla/operazione
// Query: sigla?, tipo?, includi_trasmessi?
router.get(
  "/candidati-pronti",
  requireAuth,
  trasmissController.candidatiPronti
);

// Trasmette un candidato al portale: crea (se serve) la pratica_patente e
// chiama il giusto handler di trasmissione in base alla sigla tipo_iscrizione
// Body: { candidato_id, sigla?, credenziali?, bollettini?, fotoBase64?, firmaBase64?, extra? }
router.post(
  "/trasmetti-candidato",
  requireAuth,
  trasmissController.trasmettiCandidato
);

// Ritorna la mappa sigla→operazione (usata dal frontend per filtri/etichette)
router.get(
  "/candidato-operazioni",
  requireAuth,
  trasmissController.candidatoOperazioni
);

module.exports = router;
