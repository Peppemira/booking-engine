/**
 * Montaggio centralizzato route REST (equivalenti GeCA).
 */

const express = require("express");
const candidatiRoutes = require("./candidatiRoutes");
const waitlistRoutes = require("./waitlistRoutes");
const patenteRoutes = require("./patenteRoutes");
const prenotazioniRoutes = require("./prenotazioniRoutes");
const documentiRoutes = require("./documentiRoutes");
const pagamentiRoutes = require("./pagamentiRoutes");
const portaleRoutes = require("./portaleRoutes");
const syncRoutes = require("./syncRoutes");
const radarRoutes = require("./radarRoutes");
const calendarRoutes = require("./calendarRoutes");
const guideRoutes = require("./guideRoutes");
const corsiRoutes = require("./corsiRoutes");
const trasmissRoutes   = require("./trasmissRoutes");
const portalSyncRoutes = require("./portalSyncRoutes");
const moduliRoutes     = require("./moduliRoutes");
const veicoliRoutes    = require("./veicoliRoutes");
const committentiRoutes= require("./committentiRoutes");
const listinoRoutes    = require("./listinoRoutes");
const impegniRoutes    = require("./impegniRoutes");
const praticheRoutes    = require("./praticheRoutes");
const istruttoriRoutes  = require("./istruttoriRoutes");  // Punto 20
const notificheRoutes   = require("./notificheRoutes");   // Punto 21
const operatoriRoutes   = require("./operatoriRoutes");   // Punto 24
const verbaliSvoltiRoutes = require("./verbaliSvoltiRoutes"); // archivio storico verbali

const router = express.Router();

// API REST equivalenti al gestionale GeCA
router.use("/radar", radarRoutes);
router.use("/calendar", calendarRoutes);
router.use("/sync", syncRoutes);
router.use("/candidati-api", candidatiRoutes);
router.use("/candidates", candidatiRoutes);        // alias per /api/candidates/sposta-archivio
router.use("/waitlist", waitlistRoutes);
router.use("/patente", patenteRoutes);
router.use("/prenotazioni-api", prenotazioniRoutes);
router.use("/prenotazioni", prenotazioniRoutes);   // path principale /api/prenotazioni
router.use("/documenti", documentiRoutes);
router.use("/pagamenti", pagamentiRoutes);
router.use("/guide", guideRoutes);
router.use("/corsi", corsiRoutes);
router.use("/trasmiss", trasmissRoutes);
router.use("/portal-sync", portalSyncRoutes);   // lettura dati dal portale (punti 7,9,10,11,12,14)
router.use("/portale-api", portaleRoutes);
router.use("/portal", portaleRoutes);              // alias usato dal frontend (/api/portal/...)
router.use("/moduli", moduliRoutes);               // generazione PDF moduli (TT2112, comunicazioni, ecc.)
router.use("/veicoli", veicoliRoutes);             // parco veicoli (iPatenteCloud Cap 5)
router.use("/committenti", committentiRoutes);     // committenti terzi (iPatenteCloud Cap 11)
router.use("/listino", listinoRoutes);             // listino prezzi servizi (iPatenteCloud Cap 6)
router.use("/impegni", impegniRoutes);             // impegni e scadenze (iPatenteCloud Cap 15)
router.use("/pratiche", praticheRoutes);           // pratiche_patente CRUD (wizard nuova pratica)
router.use("/istruttori", istruttoriRoutes);       // gestione istruttori (Punto 20)
router.use("/notifiche", notificheRoutes);         // notifiche candidati (Punto 21)
router.use("/operatori", operatoriRoutes);         // operatori per sede con ruoli (Punto 24)
router.use("/verbali-svolti", verbaliSvoltiRoutes); // archivio storico verbali con filtri avanzati
// NOTA: /api/auth/login, /api/auth/me, /api/auth/logout sono montati in server.js (loginAutoscuola/meAutoscuola)

module.exports = router;
