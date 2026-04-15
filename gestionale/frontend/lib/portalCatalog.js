/**
 * Catalogo funzioni del Portale dell'Automobilista mappate dal connettore Chrome.
 *
 * Struttura:
 *   - 3 categorie: pratiche-patenti, esami-verbali, pagopa
 *   - Ogni categoria ha gruppi (sotto-sezioni)
 *   - Ogni gruppo ha funzioni con slug, label, URL action del portale, campi form, stato implementazione
 *
 * Ogni funzione ha:
 *   - slug          : identificativo URL-safe (unico dentro la categoria)
 *   - label         : titolo visualizzato
 *   - desc          : descrizione breve
 *   - portalUrl     : URL action Struts2 del portale (relativo)
 *   - fields        : array di campi previsti sul form del portale
 *   - implemented   : true se la funzione e' operativa lato gestionale
 *   - backendHint   : descrizione del wiring backend
 *
 * Modalita' di wiring (in ordine di priorita'):
 *   1. tabType      : usa endpoint /api/portal/ricerca-generica con tutti i
 *                     filtri (date, stato, tipo esame). Richiede entry in
 *                     PORTAL_TAB_CONFIG su portalSession.js.
 *   2. endpoint     : chiama endpoint custom dedicato (es. /api/portal/credito-residuo)
 *   3. pageViewUrl  : usa endpoint /api/portal/page-view che carica qualsiasi
 *                     URL del portale e ne parsa la tabella risultante.
 */

export const PORTAL_CATALOG = {
  "pratiche-patenti": {
    slug: "pratiche-patenti",
    label: "Pratiche Patenti",
    icon: "📝",
    desc: "Modulo /RichiestaPatenti del portale — prenotazioni, richieste esame, certificati, fogli rosa, rinnovi, permessi provvisori.",
    color: "from-indigo-500 to-violet-600",
    groups: [
      {
        label: "Prenotazione Quiz",
        items: [
          {
            slug: "prenotazione-inserimento",
            label: "Inserimento Prenotazione",
            desc: "Nuova prenotazione esame quiz informatizzato dalla procedura di inserimento del portale.",
            portalUrl: "/RichiestaPatenti/prenotazionePatente/Read_initAction.action?pageStatus=NEW",
            fields: ["Patente", "Codice Fiscale", "Cognome", "Nome", "Data Nascita"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/prenotazionePatente/Read_initAction.action?pageStatus=NEW",
            backendHint: "/api/portal/page-view (form NEW)",
          },
          {
            slug: "prenotazione-gestione",
            label: "Gestione Prenotazioni",
            desc: "Elenco prenotazioni gia' inserite con ricerca, modifica e stampa.",
            portalUrl: "/RichiestaPatenti/prenotazionePatente/Read_initAction.action?pageStatus=SEARCH",
            fields: ["Protocollo", "Patente", "Codice Fiscale", "Data Inserimento (da/a)", "Stato"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/prenotazionePatente/Read_initAction.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view (form SEARCH)",
          },
        ],
      },
      {
        label: "Richiesta Esame",
        items: [
          {
            slug: "richiesta-esame-inserimento",
            label: "Inserimento Richiesta",
            desc: "Nuova richiesta esame (teoria/pratica) dalla procedura del portale.",
            portalUrl: "/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=NEW",
            fields: ["Patente", "Codice Fiscale", "Tipo Esame"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=NEW",
            backendHint: "/api/portal/page-view + /api/portal/nuova-iscrizione-esame",
          },
          {
            slug: "richiesta-esame-gestione",
            label: "Gestione Richieste",
            desc: "Ricerca e gestione delle richieste esame inserite.",
            portalUrl: "/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=SEARCH",
            fields: ["Protocollo", "Patente", "Codice Fiscale", "Range Date", "Stato"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view + /api/portal/cerca-richieste-esame",
          },
          {
            slug: "esercitazioni-guida",
            label: "Esercitazioni di Guida",
            desc: "Gestione delle esercitazioni di guida per i candidati.",
            portalUrl: "/RichiestaPatenti/richiestaEsame/Read_initEsercitazioniGuida.action",
            fields: ["Patente", "Codice Fiscale", "Data"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiestaEsame/Read_initEsercitazioniGuida.action",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "cambio-codice-autoscuola",
            label: "Cambio Codice Autoscuola/78",
            desc: "Procedura cambio codice autoscuola art.78 CDS.",
            portalUrl: "/RichiestaPatenti/richiestaEsame/ReadCambioCodAut_initActionCambioCodAut.action",
            fields: ["Patente", "Codice Fiscale", "Nuovo Codice"],
            implemented: true,
            endpoint: "/api/portal/cambio-codice-autoscuola",
            pageViewUrl: "/RichiestaPatenti/richiestaEsame/ReadCambioCodAut_initActionCambioCodAut.action",
            backendHint: "/api/portal/cambio-codice-autoscuola (endpoint dedicato)",
          },
        ],
      },
      {
        label: "Certificato Medico",
        items: [
          {
            slug: "certificato-medico-prima-fase",
            label: "Acquisizione Prima Fase",
            desc: "Acquisizione richiesta certificato medico - prima fase.",
            portalUrl: "/RichiestaPatenti/richiestaCertificatoMedico/ReadAcqCertificatoPrimaFase_initAcqCertificatoPrimaFase.action",
            fields: ["Patente", "Codice Fiscale", "Cognome", "Nome"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiestaCertificatoMedico/ReadAcqCertificatoPrimaFase_initAcqCertificatoPrimaFase.action",
            backendHint: "/api/portal/page-view + /api/portal/cerca-candidato-medico",
          },
          {
            slug: "certificato-medico-gestione",
            label: "Gestione Certificati",
            desc: "Ricerca e gestione certificati medici gia' richiesti.",
            portalUrl: "/RichiestaPatenti/richiestaCertificatoMedico/ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia.action",
            fields: ["Protocollo", "Codice Fiscale", "Range Date", "Stato"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiestaCertificatoMedico/ReadGestCertificatoAgenzia_initGestCertificatoFromAgenzia.action",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
      {
        label: "Foglio Rosa",
        items: [
          {
            slug: "foglio-rosa-stampa",
            label: "Stampa Foglio Rosa",
            desc: "Prima stampa del foglio rosa.",
            portalUrl: "/RichiestaPatenti/foglioRosa/Read_initActionStampa.action?pageStatus=SEARCH",
            fields: ["Patente", "Codice Fiscale", "Protocollo"],
            implemented: true,
            endpoint: "/api/portal/foglio-rosa",
            pageViewUrl: "/RichiestaPatenti/foglioRosa/Read_initActionStampa.action?pageStatus=SEARCH",
            backendHint: "/api/portal/foglio-rosa (endpoint dedicato)",
          },
          {
            slug: "foglio-rosa-ristampa",
            label: "Ristampa Foglio Rosa",
            desc: "Ristampa foglio rosa gia' emesso.",
            portalUrl: "/RichiestaPatenti/foglioRosa/Read_initActionRistampa.action?pageStatus=SEARCH&menu=Ristampa",
            fields: ["Patente", "Codice Fiscale", "Numero Foglio Rosa"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/foglioRosa/Read_initActionRistampa.action?pageStatus=SEARCH&menu=Ristampa",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
      {
        label: "CQC / Patenti CQC",
        items: [
          {
            slug: "cqc-prenotazione",
            label: "CQC - Prenotazione",
            desc: "Prenotazione esami CQC (Carta Qualificazione Conducente).",
            portalUrl: "/RichiestaPatenti/prenotazioneCqc/ReadAgenzia_initAction.action?pageStatus=LIST_AGENZIA",
            fields: ["Patente", "Codice Fiscale", "Tipo CQC"],
            implemented: true,
            endpoint: "/api/portal/cerca-cqc",
            pageViewUrl: "/RichiestaPatenti/prenotazioneCqc/ReadAgenzia_initAction.action?pageStatus=LIST_AGENZIA",
            backendHint: "/api/portal/cerca-cqc (endpoint dedicato)",
          },
          {
            slug: "patenti-cqc-prenotazione",
            label: "Patenti CQC - Prenotazione",
            desc: "Prenotazione combinata patente italiana + CQC.",
            portalUrl: "/RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_initActionPatItaCqc.action",
            fields: ["Patente", "Codice Fiscale"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_initActionPatItaCqc.action",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
      {
        label: "Gestione Foto",
        items: [
          {
            slug: "foto-cqc",
            label: "Acquisizione Foto CQC",
            desc: "Upload foto per pratiche CQC.",
            portalUrl: "/RichiestaPatenti/richiestaCQC/ReadGestFotoCqc_initGestFotoCqc.action",
            fields: ["Patente", "Codice Fiscale", "File Foto"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiestaCQC/ReadGestFotoCqc_initGestFotoCqc.action",
            backendHint: "/api/portal/page-view (upload manuale via portale)",
          },
          {
            slug: "foto-cig",
            label: "Acquisizione Foto CIG",
            desc: "Upload foto per pratiche CIG.",
            portalUrl: "/RichiestaPatenti/richiesta/Read_initActionFotoCigAg.action",
            fields: ["Patente", "Codice Fiscale", "File Foto"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiesta/Read_initActionFotoCigAg.action",
            backendHint: "/api/portal/page-view (upload manuale via portale)",
          },
        ],
      },
      {
        label: "Rinnovo Patente",
        items: [
          {
            slug: "rinnovo-acquisizione",
            label: "Acquisizione Rinnovo",
            desc: "Nuova acquisizione rinnovo patente prima fase.",
            portalUrl: "/RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_initAcqRinnAgenzia.action",
            fields: ["Patente", "Codice Fiscale", "Cognome", "Nome"],
            implemented: true,
            endpoint: "/api/portal/rinnovo-patente",
            pageViewUrl: "/RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_initAcqRinnAgenzia.action",
            backendHint: "/api/portal/rinnovo-patente (endpoint dedicato)",
          },
          {
            slug: "rinnovo-gestione",
            label: "Gestione Rinnovi",
            desc: "Ricerca rinnovi in corso con filtri multipli.",
            portalUrl: "/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action",
            fields: ["Protocollo", "Patente", "Cognome", "Codice Fiscale", "Stato", "Data Inserimento (da/a)"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "rinnovo-stampa-elenco",
            label: "Stampa Elenco Rinnovi",
            desc: "Stampa elenco rinnovi per intervallo di date.",
            portalUrl: "/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initStampaRinnAgenzia.action",
            fields: ["Data Inserimento (da)", "Data Inserimento (a)"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initStampaRinnAgenzia.action",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "rinnovo-completa-hd",
            label: "Completa Pratiche Help Desk",
            desc: "Completamento pratiche rinnovo in stato Help Desk.",
            portalUrl: "/RichiestaPatenti/richiesta/ReadGestRinnAgenziaHD_initGestRinnAgenziaHD.action",
            fields: ["Data Inserimento (da)", "Data Inserimento (a)"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/richiesta/ReadGestRinnAgenziaHD_initGestRinnAgenziaHD.action",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
      {
        label: "Permesso Guida Provvisorio",
        items: [
          {
            slug: "permesso-provvisorio-inserimento",
            label: "Inserimento Permesso",
            desc: "Nuova acquisizione permesso provvisorio di guida.",
            portalUrl: "/RichiestaPatenti/permessoProvvisorioGuida/ReadAcqPermessoProvvisorio_initAcqPermessoProvvisorio.action",
            fields: ["Patente", "Codice Fiscale"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/permessoProvvisorioGuida/ReadAcqPermessoProvvisorio_initAcqPermessoProvvisorio.action",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "permesso-provvisorio-gestione",
            label: "Gestione Permessi",
            desc: "Ricerca permessi provvisori. Stati: ANNULLATA, ANNULLATA DA UP, INSERITA, PAGAMENTO DA RIPETERE.",
            portalUrl: "/RichiestaPatenti/permessoProvvisorioGuida/ReadGestPermessoProvvisorio_initGestPermessoProvvisorio.action",
            fields: ["Protocollo", "Patente+CF", "Codice Fiscale", "Range Date", "Stato"],
            implemented: true,
            pageViewUrl: "/RichiestaPatenti/permessoProvvisorioGuida/ReadGestPermessoProvvisorio_initGestPermessoProvvisorio.action",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
    ],
  },

  "esami-verbali": {
    slug: "esami-verbali",
    label: "Esami & Verbali",
    icon: "📅",
    desc: "Modulo /prenotazione del portale — sessioni quiz, sessioni guide, verbali, spostamento candidati. 21 funzioni totali.",
    color: "from-emerald-500 to-teal-600",
    groups: [
      {
        label: "Generale",
        items: [
          {
            slug: "situazione-candidati",
            label: "Situazione Candidati",
            desc: "Situazione dei candidati prenotati/da prenotare (gia' integrato).",
            portalUrl: "/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH",
            fields: ["Cognome", "Nome", "Codice Fiscale", "Patente", "Marca Operativa"],
            implemented: true,
            backendHint: "readSituazioneCandidatiListViaBrowser / readSituazioneCandidatiDettaglioViaBrowser",
          },
          {
            slug: "prenotazione-da-candidato",
            label: "Prenotazione Esame da Candidato",
            desc: "Ricerca le prenotazioni esame di un candidato specifico.",
            portalUrl: "/prenotazione/prenotazioneCandidatoEP/Read_initAction.action?pageStatus=SEARCH",
            fields: ["Codice Fiscale", "Patente", "Cognome", "Nome"],
            implemented: true,
            pageViewUrl: "/prenotazione/prenotazioneCandidatoEP/Read_initAction.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
      {
        label: "Conseguimento Patente",
        items: [
          {
            slug: "sessioni-quiz-interne",
            label: "Sessioni Quiz Interne",
            desc: "Gestione sessioni di esami a quiz informatizzato interne (gia' integrato - flusso principale).",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Stato", "Ufficio Provinciale"],
            implemented: true,
            tabType: "SQI",
            backendHint: "readSessioniQuizInterneViaBrowser / /api/portal/ricerca-generica",
          },
          {
            slug: "sessioni-guide-orali-scritti",
            label: "Sessioni Guide / Orali / Scritti",
            desc: "Gestione sessioni di esami orali, guida e scritti.",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniGuideOrali.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Stato", "Ufficio Provinciale", "Tipo Esame"],
            implemented: true,
            tabType: "SGOS",
            backendHint: "readPortalSearchViaBrowser (SGOS) / /api/portal/ricerca-generica",
          },
          {
            slug: "sessioni-approvate-cons",
            label: "Sessioni Approvate - Conseguimento",
            desc: "Sessioni approvate per il conseguimento di una nuova patente.",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "SQA",
            backendHint: "readPortalSearchViaBrowser (SQA) / /api/portal/ricerca-generica",
          },
          {
            slug: "sposta-sessione-cons",
            label: "Sposta Candidati - Conseguimento",
            desc: "Sposta candidati da una sessione di esami a un'altra.",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessione.action?pageStatus=SEARCH",
            fields: ["Sessione Origine", "Sessione Destinazione"],
            implemented: true,
            pageViewUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessione.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view (operazione manuale via portale)",
          },
          {
            slug: "verbali-aperti-cons",
            label: "Verbali Aperti - Conseguimento",
            desc: "Gestione verbali aperti di esami per conseguimento nuova patente.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiConseguimento.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VAC",
            backendHint: "readPortalSearchViaBrowser (VAC) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-svolti-cons",
            label: "Verbali Svolti - Conseguimento",
            desc: "Gestione verbali svolti di esami per conseguimento nuova patente.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VSC",
            backendHint: "readPortalSearchViaBrowser (VSC) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-annullati-cons",
            label: "Verbali Annullati - Conseguimento",
            desc: "Visualizzazione verbali annullati per conseguimento nuova patente.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiConseguimento.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VANC",
            backendHint: "readPortalSearchViaBrowser (VANC) / /api/portal/ricerca-generica",
          },
          {
            slug: "sposta-verbali-cons",
            label: "Sposta da Verbali Annullati - Cons.",
            desc: "Sposta candidati da verbale annullato a nuova sessione.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliConseguimento.action?pageStatus=SEARCH",
            fields: ["Verbale Origine", "Sessione Destinazione"],
            implemented: true,
            pageViewUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliConseguimento.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view (operazione manuale)",
          },
        ],
      },
      {
        label: "Conseguimento CQC",
        items: [
          {
            slug: "sessioni-cqc",
            label: "Sessioni CQC",
            desc: "Gestione sessioni di esami per conseguimento CQC.",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqc.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "SCQC",
            backendHint: "readPortalSearchViaBrowser (SCQC) / /api/portal/ricerca-generica",
          },
          {
            slug: "sessioni-approvate-cqc",
            label: "Sessioni Approvate - CQC",
            desc: "Sessioni approvate di esami CQC.",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqcApprovate.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "SCQCA",
            backendHint: "readPortalSearchViaBrowser (SCQCA) / /api/portal/ricerca-generica",
          },
          {
            slug: "sposta-sessione-cqc",
            label: "Sposta Candidati - CQC",
            desc: "Sposta candidati da una sessione CQC ad un'altra.",
            portalUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessioneCqc.action?pageStatus=SEARCH",
            fields: ["Sessione Origine", "Sessione Destinazione"],
            implemented: true,
            pageViewUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessioneCqc.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view (operazione manuale)",
          },
          {
            slug: "verbali-aperti-cqc",
            label: "Verbali Aperti - CQC",
            desc: "Gestione verbali aperti esami CQC.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiCqc.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VAQ",
            backendHint: "readPortalSearchViaBrowser (VAQ) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-svolti-cqc",
            label: "Verbali Svolti - CQC",
            desc: "Gestione verbali svolti esami CQC.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqc.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VSQ",
            backendHint: "readPortalSearchViaBrowser (VSQ) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-annullati-cqc",
            label: "Verbali Annullati - CQC",
            desc: "Visualizzazione verbali annullati CQC.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiCqc.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VANQ",
            backendHint: "readPortalSearchViaBrowser (VANQ) / /api/portal/ricerca-generica",
          },
          {
            slug: "sposta-verbali-cqc",
            label: "Sposta da Verbali Annullati - CQC",
            desc: "Sposta candidati da verbale CQC annullato a nuova sessione.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliCqc.action?pageStatus=SEARCH",
            fields: ["Verbale Origine", "Sessione Destinazione"],
            implemented: true,
            pageViewUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliCqc.action?pageStatus=SEARCH",
            backendHint: "/api/portal/page-view (operazione manuale)",
          },
        ],
      },
      {
        label: "Revisione",
        items: [
          {
            slug: "verbali-svolti-revisione",
            label: "Verbali Svolti - Rev. Patente",
            desc: "Verbali svolti per revisione patente.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiRevisione.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VSR",
            backendHint: "readPortalSearchViaBrowser (VSR) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-annullati-revisione",
            label: "Verbali Annullati - Rev. Patente",
            desc: "Verbali annullati per revisione patente.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiRevisione.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VAR",
            backendHint: "readPortalSearchViaBrowser (VAR) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-svolti-revisione-cqc",
            label: "Verbali Svolti - Rev. CQC",
            desc: "Verbali svolti per revisione CQC.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqcRev.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VSRCQC",
            backendHint: "readPortalSearchViaBrowser (VSRCQC) / /api/portal/ricerca-generica",
          },
          {
            slug: "verbali-annullati-revisione-cqc",
            label: "Verbali Annullati - Rev. CQC",
            desc: "Verbali annullati per revisione CQC.",
            portalUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiRevisioneCqc.action?pageStatus=SEARCH",
            fields: ["Data (da/a)", "Ufficio Provinciale"],
            implemented: true,
            tabType: "VARCQC",
            backendHint: "readPortalSearchViaBrowser (VARCQC) / /api/portal/ricerca-generica",
          },
        ],
      },
    ],
  },

  "pagopa": {
    slug: "pagopa",
    label: "PagoPA",
    icon: "💳",
    desc: "Modulo /sistema-pagamenti del portale — pagamenti pratiche, bollettini, tariffario, credito residuo.",
    color: "from-amber-500 to-orange-600",
    groups: [
      {
        label: "Pagamenti",
        items: [
          {
            slug: "nuovo-pagamento",
            label: "Nuovo Pagamento",
            desc: "Inserimento nuova pratica di pagamento.",
            portalUrl: "/sistema-pagamenti/pratica/nuova",
            fields: ["Codice Tariffa", "Importo", "Beneficiario"],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/pratica/nuova",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "miei-pagamenti",
            label: "I Miei Pagamenti",
            desc: "Elenco richieste di pagamento del cassetto.",
            portalUrl: "/sistema-pagamenti/cassetto/visualizzaRichieste",
            fields: ["Range Date", "Stato", "Codice Tariffa"],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/cassetto/visualizzaRichieste",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "iuv-disaggregati",
            label: "IUV Disaggregati",
            desc: "Gestione IUV disaggregati per pagamenti multipli.",
            portalUrl: "/sistema-pagamenti/iuvDisaggregati",
            fields: ["IUV", "Range Date"],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/iuvDisaggregati",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "bollettini",
            label: "Bollettini",
            desc: "Consultazione bollettini di pagamento.",
            portalUrl: "/sistema-pagamenti/consultaBollettini",
            fields: ["Numero Bollettino", "Range Date"],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/consultaBollettini",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
      {
        label: "Verifiche",
        items: [
          {
            slug: "verifica-tariffe",
            label: "Verifica Corrispondenza Tariffe",
            desc: "Verifica la corrispondenza delle tariffe sulle pratiche inserite.",
            portalUrl: "/sistema-pagamenti/verificaPratiche",
            fields: ["Protocollo", "Codice Tariffa"],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/verificaPratiche",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "credito-residuo",
            label: "Credito Residuo",
            desc: "Visualizza il credito residuo disponibile nel cassetto (tabella per territorio/tariffa).",
            portalUrl: "/sistema-pagamenti/creditoResiduo/Read_initAction.action",
            fields: [],
            implemented: true,
            endpoint: "/api/portal/credito-residuo",
            backendHint: "readPortalPageViaBrowser / /api/portal/credito-residuo",
          },
        ],
      },
      {
        label: "Utility",
        items: [
          {
            slug: "riscatto-voucher",
            label: "Riscatto Voucher",
            desc: "Riscatto voucher / rimborsi.",
            portalUrl: "/sistema-pagamenti/rimborsi",
            fields: ["Codice Voucher"],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/rimborsi",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "carrello",
            label: "Carrello",
            desc: "Carrello dei pagamenti in corso.",
            portalUrl: "/sistema-pagamenti/carrello",
            fields: [],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/carrello",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "pagatore",
            label: "Pagatore",
            desc: "Gestione pagatore / tipologia inserimento.",
            portalUrl: "/sistema-pagamenti/tipologiainserimento",
            fields: [],
            implemented: true,
            pageViewUrl: "/sistema-pagamenti/tipologiainserimento",
            backendHint: "/api/portal/page-view",
          },
          {
            slug: "tariffario",
            label: "Tariffario",
            desc: "Consultazione tariffario pagamenti.",
            portalUrl: "/noauthspa/pagamenti/tariffario",
            fields: [],
            implemented: true,
            pageViewUrl: "/noauthspa/pagamenti/tariffario",
            backendHint: "/api/portal/page-view",
          },
        ],
      },
    ],
  },
};

/**
 * Lista piatta di tutte le categorie per il menu hub.
 */
export function listCategories() {
  return Object.values(PORTAL_CATALOG).map(c => ({
    slug: c.slug,
    label: c.label,
    icon: c.icon,
    desc: c.desc,
    color: c.color,
    totalItems: c.groups.reduce((acc, g) => acc + g.items.length, 0),
    implementedItems: c.groups.reduce(
      (acc, g) => acc + g.items.filter(it => it.implemented).length,
      0
    ),
  }));
}

/**
 * Ottiene una categoria per slug.
 */
export function getCategory(slug) {
  return PORTAL_CATALOG[slug] || null;
}

/**
 * Ottiene una singola funzione dato categoria + slug.
 */
export function getFunction(categoria, funzione) {
  const cat = getCategory(categoria);
  if (!cat) return null;
  for (const group of cat.groups) {
    const item = group.items.find(it => it.slug === funzione);
    if (item) return { ...item, group: group.label, categoria: cat.label, categoriaSlug: cat.slug };
  }
  return null;
}

/**
 * Ottiene la lista completa di tutte le funzioni del catalogo, con path di navigazione.
 */
export function getAllFunctions() {
  const out = [];
  for (const cat of Object.values(PORTAL_CATALOG)) {
    for (const group of cat.groups) {
      for (const item of group.items) {
        out.push({
          ...item,
          categoriaSlug: cat.slug,
          categoria: cat.label,
          group: group.label,
          path: `/portale/funzioni/${cat.slug}/${item.slug}`,
        });
      }
    }
  }
  return out;
}
