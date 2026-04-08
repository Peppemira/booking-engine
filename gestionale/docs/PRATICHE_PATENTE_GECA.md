# Pratiche Patente – Riferimento GeCA (funzioni e percorsi)

Analisi dei moduli GeCA per **Pratiche Patente**: form iscrizioni specializzate e **Trasmiss** (trasmissione pratiche al CED/portale). Percorsi e funzioni principali.

---

## 1. Form iscrizioni (pratiche per tipo)

Ogni form gestisce un tipo di pratica/richiesta; tutti espongono `codicecandidato` e condividono pattern: caricamento dati (Load), conferma/salvataggio, stampe, note, **trasmissione** (apertura Trasmiss).

| Form GeCA | Titolo | Uso |
|-----------|--------|-----|
| **iscrEsame** | Conseguimento per Esame | Pratica conseguimento patente (esame teoria/guida) |
| **iscrCerMed** | Gestione Richieste Certificato Medico | Richiesta certificato medico, IUV/pagoPA medico |
| **iscrNaut** | Patente Nautica | Pratica patente nautica |
| **iscrdup** | Rilascio per Duplicato / Conversione | Duplicato patente, rilascio per conversione |
| **iscrPATCQC** | Richiesta Patente C.Q.C. / CQC Card | Patente CQC, CQC Card |
| **iscrRinnovo** | Gestione Richieste Rinnovo Patente | Conferma validità / rinnovo patente |
| **iscrGUIACC** | Guida Accompagnata | Autorizzazione guida accompagnata |
| **iscrAltro** | Nuova Iscrizione | Esercitazione guide (EG), Archivio dati (AD), Permesso internazionale (PI), Permesso provvisorio (PP) |
| **iscrCorso** | Corso | Recupero punti (RP), Corso CQC (CQ), Corso CAP (CK), Corso ADR (CA) |

### 1.1 Percorso di apertura

- Da **anagrafe** (Gestione Anagrafica): doppio click su riga o pulsante Modifica → in base a **eleTipoIscrizione** si apre il form corrispondente (vedi ANAGRAFICA_ISCRIZIONI_GECA.md).
- Da **nuovaiscr** (Registra Nuova Iscrizione): scelta tipo → apertura del form iscr con titolo "... - Registra Nuova Iscrizione".

### 1.2 Funzioni comuni (pattern nei form iscr)

- **iscrizione_Load** (o Load specifico): caricamento dati candidato e pratica (interno, statini, visite, certificati, ecc.) da DB; binding campi.
- **btmconf_Click** / **btmconf**: conferma / salvataggio pratica (inserimento o aggiornamento record).
- **btmStampe_Click**: apertura form **Stampe** (opzioni e modelli di stampa).
- **btmNote_Click**: gestione note iscritto.
- **btmTrasm_Click**: apertura form **Trasmiss** (Trasmissione Pratiche) per invio pratica al CED/portale. Usato in iscrEsame, iscrdup (e in altri dove presente).
- **BTMRECU** / **BTMRECU_Click**: recupero dati da portale/CED (candidato, pratica); pulsante "Recupera" dati.
- **Button6_Click** / **Button3_Click_1**: annulla / indietro.
- **btmAggiorna_Click**: ricarica dati da DB.
- **foto_Click**, **delfoto_Click**, **delfirma_Click**: gestione foto e firma.
- **BtnRicProt_Click**, **BtnRicCre_Click**, **RitPagRinn_Click**: ricerche protocollo, crediti, ritorno pagamento rinnovo (dove applicabile).
- **iscrCerMed** in più: **btnGenIUVmedico**, **btnDettIUV** (generazione/dettaglio IUV certificato medico), **btnVediAnnot_Click**, **btnTS_Click**.
- **iscrEsame** in più: **BtmConfStatino_Click_1**, **btmModstatino_Click**, **cmAggStato_Click**, **cmRitPag_Click**, **btnMFF_Click**, **btnRCM_Click**, **btnVCM_Click** (stati, statini, pagamenti, modulistica).

---

## 2. Trasmiss (Trasmissione Pratiche)

- **Titolo form:** `Trasmissione Pratiche`
- **File:** Trasmiss.cs, Trasmiss.Designer.cs
- **Apertura:** da **iscrEsame** (btmTrasm_Click) e **iscrdup** (btmTrasm_Click); in altri form iscr può essere presente un pulsante analogo "Trasmissione" che apre Trasmiss.

### 2.1 Struttura e controlli

- **GroupInterno** – "Operazione Richiesta": scelta operazione di trasmissione per pratiche **interno** (conseguimento, duplicato, ecc.): CheckBox e PictureBox per tipo operazione.
- **GroupRinnovo** – "Operazione Richiesta": operazioni per **rinnovo** patente (CheckBox, PictureBox).
- **stampe** – opzioni stampa (CheckBox).
- **StampRinnovi** – stampe rinnovi.
- **GroupCertMed** – "Operazione Richiesta": operazioni **certificato medico** (CheckBox, PictureBox).
- **GroupStampCerMed** – "Opzioni Stampa" certificato medico.
- **Panbase** / **Panwebvis**: pannello con **WebBrowser** per visualizzazione risposta/portale.
- **rispostaced**: RichTextBox (sola lettura) che mostra la **risposta del CED** (testo impostato da modulo.cs dopo invio SOAP/HTTP: rispostaced.BackColor, rispostaced.Text).
- **invio** (Button): esegue l’invio della pratica (invio_Click).
- **annulla** (Button): chiude (annulla_Click).

### 2.2 Funzioni principali

- **Trasmiss_Load**: caricamento iniziale; preparazione elenchi operazioni e stampe (GroupInterno, GroupRinnovo, GroupCertMed, stampe, StampRinnovi) in base al tipo di pratica/candidato da cui si è aperto Trasmiss.
- **Trasmiss_Activated**: aggiornamento interfaccia quando il form diventa attivo (stato check, PictureBox, ecc.).
- **invio_Click**: invio della richiesta al CED/portale (chiamate SOAP/HTTP gestite in **modulo.cs**); alla risposta, **modulo** imposta `MyProject.Forms.Trasmiss.rispostaced.Text` e `rispostaced.BackColor` (es. PaleGreen per esito positivo, Yellow per avviso).
- **annulla_Click**: chiusura form.
- **picoperaz1_Click**, **picstam1_Click**, **picOprinn5_Click**, **picstamrinn1_Click**, **picopmed1_Click**: gestione click su PictureBox per selezionare operazione o stampa (interna, rinnovo, certificato medico).

### 2.3 Integrazione con modulo.cs

- Il flusso di **invio** (SOAP/XML verso CED) e la gestione della **risposta** sono implementati in **modulo.cs** (e connessione portale/connessioneportalenew dove previsto).
- Dopo la risposta del CED, modulo imposta:
  - `Trasmiss.rispostaced.BackColor = Color.PaleGreen` (o Yellow)
  - `Trasmiss.rispostaced.Text = <messaggio risposta>`
- In questo modo l’operatore vede l’esito della trasmissione nella RichTextBox.

---

## 3. Percorsi nel progetto (flusso tipico)

1. **Anagrafica** → seleziona iscritto → **Modifica** (o doppio click) → apre form iscr in base a **eleTipoIscrizione** (iscrEsame, iscrdup, iscrCerMed, iscrCorso, …).
2. **Form iscr** → compila/aggiorna dati → **Conferma** (btmconf) → salvataggio su DB (interno, statini, certificati, ecc.).
3. **Form iscr** → **Trasmissione** (btmTrasm) → apre **Trasmiss**.
4. **Trasmiss** → seleziona operazione richiesta (e opzioni stampa se previste) → **Invio** (invio_Click) → modulo invia al CED → risposta mostrata in **rispostaced**.
5. **Form iscr** → **Recupera** (BTMRECU) dove presente: recupero dati da portale/CED.
6. **Form iscr** → **Stampe** (btmStampe): apertura form Stampe Ge.C.A. per stampa documenti.

---

## 4. Riepilogo percorsi file GeCA

| Modulo | File principale | Apertura da |
|--------|-----------------|-------------|
| iscrEsame | iscrEsame.cs, iscrEsame.Designer.cs | anagrafe (IN, PR, RE), nuovaiscr (Conseguimento) |
| iscrCerMed | iscrCerMed.cs, iscrCerMed.Designer.cs | anagrafe (CM), nuovaiscr (Certificato medico) |
| iscrNaut | iscrNaut.cs, iscrNaut.Designer.cs | anagrafe (PN), nuovaiscr (Patente nautica) |
| iscrdup | iscrdup.cs, iscrdup.Designer.cs | anagrafe (D|, Y|, L|, S|, R|, M|, E|), nuovaiscr (Duplicato, Conversione) |
| iscrPATCQC | iscrPATCQC.cs, iscrPATCQC.Designer.cs | anagrafe (PC, CC), nuovaiscr (Patente CQC, CQC Card) |
| iscrRinnovo | iscrRinnovo.cs, iscrRinnovo.Designer.cs | anagrafe (CV), nuovaiscr (Rinnovo) |
| iscrGUIACC | iscrGUIACC.cs, iscrGUIACC.Designer.cs | anagrafe (GA), nuovaiscr (Guida accompagnata) |
| iscrAltro | iscrAltro.cs, iscrAltro.Designer.cs | anagrafe (EG, AD, PI, PP), nuovaiscr (Altro) |
| iscrCorso | iscrCorso.cs, iscrCorso.Designer.cs | anagrafe (RP, CQ, CK, CA), nuovaiscr (Recupero punti, Corso CQC, ADR) |
| Trasmiss | Trasmiss.cs, Trasmiss.Designer.cs | iscrEsame (btmTrasm), iscrdup (btmTrasm), eventualmente altri iscr con pulsante Trasmissione |

---

## 5. Nel gestionale web

- **Pratiche** (`/pratiche`): hub che elenca i moduli GeCA (iscrEsame, iscrCerMed, iscrNaut, iscrdup, iscrPATCQC, iscrRinnovo, iscrGUIACC, iscrAltro, iscrCorso, Trasmiss) e collega alla documentazione.
- **Backend**: `pratiche_patente` (tabella), `PratichePatenteService` (list, getById, create, update), route API per pratiche; integrazione con portale/trasmissione in evoluzione.
- **Anagrafica / Candidati**: elenco candidati e dettaglio; le “pratiche” per tipo (conseguimento, rinnovo, certificato medico, duplicato, corsi, ecc.) saranno mappate su tipi pratica e su flussi web equivalenti a iscr* + Trasmiss.

---

## 6. Rinnovo Patente (iscrRinnovo) – funzioni e percorsi

Form GeCA: **Gestione Richieste Rinnovo Patente** (Conferma di Validità). Titolo in modifica: *"Modifica Dati Iscrizione - Conferma di Validità (Rinnovo Patente)"*.

### 6.1 Apertura

- **Da Anagrafica (anagrafe):** tipo iscrizione **CV** (Conferma Validità) → `iscrRinnovo.codicecandidato` impostato, `iscrRinnovo.Text = "Modifica Dati Iscrizione - Conferma di Validità (Rinnovo Patente)"` → `iscrRinnovo.ShowDialog()`.
- **Da Nuova Iscrizione (nuovaiscr):** scelta **"Conferma di Validità (Rinnovo Patente)"** (RadRINNOVO) → apertura iscrRinnovo in modalità nuova iscrizione.

### 6.2 Eventi principali

| Evento | Funzione | Descrizione |
|--------|----------|-------------|
| Load | `iscrizione_Load` | Caricamento dati candidato e pratica da DB (iscritti, interno, patenti, visite, documenti, recapiti, prezzi); binding schede e combo (province, tipi doc, codautos, AbiPoss, matrprestecn). |
| Shown | `iscrizione_Shown` | Se codice candidato presente, chiama **BtnRecuperadati** (Button3_Click_1) per precompilare da anagrafe. |
| Activated | `iscrRinnovo_Activated` | Aggiornamento stato controlli e visibilità in base a dati correnti. |

### 6.3 Pulsanti e funzioni

| Pulsante / controllo | Handler | Descrizione |
|---------------------|---------|-------------|
| **Conferma** | `btmconf_Click` | Controlli (controlli()), registro, importi; salvataggio su MySQL (iscritti, interno, patenti, visite, documenti, recapiti, costi). Transazione unica. |
| **Trasmissione** | `btmTrasm_Click` | Verifica codautos; apre **Trasmiss** in ShowDialog (owner = iscrRinnovo). In Trasmiss: GroupRinnovo e StampRinnovi per operazioni/stampe rinnovo. |
| **Recupera dati** | `Button3_Click_1` (BtnRecuperadati) | Recupero da anagrafe locale: ricerca omonimi (ricercaOmoni) → frmOmoni; poi caricamento da iscritti/interno/fotodb/recapititel nel form. |
| **Cerca in anagrafe** | `BTMRECU_Click` | Stesso flusso: omonimi + caricamento dati (cogn, nom, datan, residenza, contatti, foto, firma) da DB. |
| **Stampe** | `btmStampe_Click` | Apertura form **Stampe** Ge.C.A. (opzioni e modelli stampa). |
| **Note** | `btmNote_Click` | Gestione note iscritto. |
| **Indietro** | `Button6_Click` (btmback) | Chiude form. |
| **Aggiorna** | `btmAggiorna_Click` | Ricarica dati da DB (RIEMPICAMPI). |
| **Annulla** | `btnAnnulla_Click` | Annulla modifiche / chiude. |
| **Ricerca protocollo** | `BtnRicProt_Click` | Ricerca per protocollo (portale/ced). |
| **Ricerca crediti** | `BtnRicCre_Click` | Ricerca crediti (recupero credito rinnovo). |
| **Ritorno pagamento rinnovo** | `RitPagRinn_Click` | Ritorno pagamento rinnovo. |
| **Genera IUV** | `btnGenIUV_Click` | Generazione IUV per pagamento (pagoPA). |
| **Conferma modifica (dup)** | `btmconfmoddup_Click` | Conferma in modalità duplicato/modifica. |
| **Mostra registri** | `MostraRegistri_Click` | Apertura VisRegistro (registri iscrizioni). |
| **Importo prezzi** | `btnImpPrezzi_Click` | Import prezzi/listino. |
| **Vedi annotazioni** | `btnVediAnnot_Click` | Visualizza annotazioni. |
| **Foto / Firma** | `foto_DoubleClick`, `delfoto_Click`, `delfirma_Click` | Gestione foto e firma. |

### 6.4 Campi principali (per portale/CED in modulo.cs)

- **Anagrafica:** cog, Nom, datn, Codf, Locn, PROVN, Loce, STAEST, SiglaEst, SESSO, Indr, Locr, Capr, PROVR, Topr, NCIVR, Ntel1, Ntel2, Dtel1, Dtel2, INDIEMAIL, Cittadi, diacritico.
- **Patente / richiesta:** propat (protocollo), npatposs (numero patente), AbiPoss (abilità possedute), emiss (data emissione), newscad (nuova scadenza), statopat/statopatCod.
- **Documento:** tipdoc, Ndoc, rildoc, luogodoc, scaddoc, datvis (visita medica).
- **Spedizione:** LocSped, ProvSped, topoSped, indiSped, ncivSped, CapSped; Locv, provv (visita).
- **Pagamento:** TIPPAG (tipo: contanti, pagoPA, recupero credito…), pagopa (IUV o estremo pagamento), protrecucre (protocollo recupero credito).
- **Prestazioni/matricole:** matrprestecn (lista ComboBox), txtvelocita, txtdistanza (per CQC/ADR dove previsto).
- **Altro:** codautos (codice autoscuola), codicecandidato, nreg, datreg, cost11, moti11; foto, firma.

### 6.5 Trasmiss per rinnovo

- **GroupRinnovo** (Trasmiss): “Operazione Richiesta” – CheckBox Oprinn1 … Oprinn12 e PictureBox picOprinn1 … picOprinn12 (click → picOprinn5_Click) per selezionare il tipo di operazione di trasmissione rinnovo.
- **StampRinnovi**: “Opzioni Stampa” – stamrinn1, stamrinn2, stamrinn3 e picstamrinn1, picstamrinn2, picstamrinn3 per opzioni stampa rinnovi.
- **invio** (Trasmiss): invio_Click → in modulo.cs costruzione XML e chiamate WS (leggiWsRinnovo, ecc.); risposta in Trasmiss.rispostaced.

### 6.6 Servizi portale (modulo.cs) per rinnovo

- **dettaglioRinnovoPatente** – `/services/dettaglioRinnovoPatente`: dettaglio richiesta rinnovo (stato, dati).
- **inserimentoRichiestaNonRinnovabile** – richiesta non rinnovabile (controlli età C/D, indirizzo spedizione, abilità, documenti, visita, ecc.).
- **inserimentoRinnovoPagoPA** – inserimento rinnovo con pagamento pagoPA (IUV/estremo pagamento).
- **recuperoCreditoRinnovo** – recupero credito per rinnovo (protocollo, indirizzo, documento, pagopa).
- **dettaglioRinnovoPatente** (stato pagamento) – verifica stato pagamento richiesta.

### 6.7 Percorso riassuntivo (Rinnovo)

1. **Anagrafica / Candidati** → seleziona iscritto con tipo **CV** → **Modifica** → apre **iscrRinnovo**.
2. **iscrRinnovo** → (opz.) **Recupera dati** (BtnRecuperadati / BTMRECU) → compila da anagrafe locale.
3. Compilazione: anagrafica, numero patente, abilità, documento, indirizzo spedizione, visita, pagamento (IUV/pagoPA o recupero credito).
4. **Conferma** (btmconf) → salvataggio su DB.
5. **Trasmissione** (btmTrasm) → apre **Trasmiss** → seleziona operazione rinnovo (GroupRinnovo) e opzioni stampa (StampRinnovi) → **Invio** → modulo invia al CED → risposta in **rispostaced**.
6. **Stampe** (btmStampe) → form Stampe Ge.C.A.
7. **Ricerca protocollo / crediti / Ritorno pagamento** per aggiornare stato e pagamenti.
