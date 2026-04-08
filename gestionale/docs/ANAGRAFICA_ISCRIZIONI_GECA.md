# Anagrafica e Iscrizioni – Riferimento GeCA (dettaglio)

Documento di analisi dei moduli GeCA per **Gestione Anagrafica** e **Iscrizioni**: form, flussi, tipi iscrizione e collegamenti.

---

## 1. Form principale: anagrafe (Gestione Anagrafica)

- **Titolo form:** `Gestione Anagrafica`
- **File:** `anagrafe.cs`, `anagrafe.Designer.cs`
- **Apertura:** da menu principale (frmmenu), da NAVIGATOREnew, da menucontab, gestesame, creaelenchi, arubafattura, auleLezioni, menuGuide, GeCorsi.

### 1.1 Struttura

- **GroupBox fraiscr:** "Iscrizioni Presenti in Archivio"
  - **DataGridView eleIscritti:** griglia iscritti (archivio anagrafico).
  - **Filtri:** cognome (`cogno`), nome (`nome`), tipo iscrizione (`cmbTipi`/`cmbtipisigle`), categoria patente (`cmbpat`/`cmbpatsigle`), autoscuola (`cbAutosc`). Filtro in tempo reale su `BindingSource` (cogn/nom LIKE, codautos).
  - **Ordinamento:** click su intestazione colonna → `strOrdinamento` (ASC/DESC + `cogn, nom, datiscr`).

- **Pulsanti (pannello iscrizioni):**
  - **btmadd:** Nuova iscrizione → apre `nuovaiscr` (scelta tipo), poi il form iscr specifico.
  - **btmedit:** Modifica iscritto selezionato → doppio click sulla riga: in base a `eleTipoIscrizione` apre il form corrispondente (iscrEsame, iscrdup, iscrCorso, …).
  - **btmdel:** Elimina.
  - **btmback:** Indietro.
  - **btnFoglirosa:** Fogli rosa (link a funzionalità fogli rosa).
  - **btnPatenti:** Patenti (link a funzionalità patenti).
  - **brnArchiviaRipristina:** Sposta in "Archivio Storico" / ripristina.
  - **btmNote:** Note iscritto.
  - **btnRiepilogo:** Riepilogo.
  - **BtnSeleziona:** Seleziona (es. per chiamante esterno, es. arubafattura).

- **Pannello dettaglio (a lato della griglia):**
  - **foto,** **firma:** PictureBox foto e firma iscritto.
  - **txtEmail,** **txtTel** (Label6 EMAIL, Label5 REC. TELEFONICO): dati di contatto.
  - Caricamento dettaglio sulla riga corrente: `CaricaDettagliDaRigaCorrente()` (codice candidato, note, foto/firma da DB/servizio).

- **GroupBox fraric:** criteri di ricerca (cognome, nome, tipo, patente, autoscuola).

### 1.2 Colonne griglia eleIscritti

- `codcand` – codice candidato (id)
- `eleAnoes` – anno esame
- `ncol` – colonna numero
- `eleCodaut` – codice autoscuola
- `eleCognome` – cognome
- `eleNome` – nome
- `eleDataNascita` – data nascita
- `eleTipoIscrizione` – **tipo iscrizione** (sigla che determina quale form aprire in modifica)
- `elemotrich` – motivo richiesta
- `eleDataRegis` – data registrazione
- `elecqcposs` – CQC posseduto
- `elecqcrich` – CQC richiesto
- `elecatpat` – categoria patente
- `elePat` – patente
- `elenpatposs` – numero patente posseduta
- `elescad` – scadenza
- `elecodf` – codice fiscale
- `elefoto` – presenza foto
- `elefirma` – presenza firma
- `elestorico` – storico (archiviato)
- `elenote` – note

*(eleTipoIscrizione è spesso nascosta ma usata per il routing al form di modifica.)*

### 1.3 Flusso dati

- Caricamento: `CaricaDatiGriglia()` → query su DB (iscritti + join interno/statini/visite/abilitazioni ecc.) → `BindingSource` → `eleIscritti`.
- Selezione riga: `eleIscritti_SelectionChanged` → `CaricaDettagliDaRigaCorrente()` (dettaglio, foto, firma, note).
- Doppio click riga: `eleIscritti_CellDoubleClick` → in base a `eleTipoIscrizione` viene aperto il form iscr corrispondente con `codicecandidato` = `codcand` della riga; alla chiusura `CaricaDatiGriglia()` e riposizionamento sulla riga.

---

## 2. Nuova iscrizione: nuovaiscr (Registra Nuova Iscrizione)

- **Titolo:** `Registra Nuova Iscrizione`
- **File:** `nuovaiscr.cs`, `nuovaiscr.Designer.cs`
- **Apertura:** da anagrafe, pulsante btmadd.

### 2.1 Scelta tipo (radio / pulsanti)

L’utente sceglie il tipo di iscrizione; alla conferma viene aperto il form specializzato (e eventualmente `nuovaiscr` viene chiuso):

| Scelta nuovaiscr   | Form aperto   | Note |
|-------------------|---------------|------|
| Conseguimento     | iscrEsame     | Conseguimento per esame |
| Rinnovo           | iscrRinnovo   | Conferma validità / rinnovo patente |
| Patente (duplicato) | iscrdup     | Rilascio per duplicato |
| Patente CQC       | iscrPATCQC    | Rilascio patente CQC |
| CQC Card          | iscrPATCQC    | Variante CQC Card (firma nascosta, layout diverso) |
| Conversione       | iscrdup       | Rilascio per conversione (panConv, pandupl nascosto) |
| Recupero punti    | iscrCorso     | Corso recupero punti (PanRecupero) |
| Corso CQC         | iscrCorso     | Corso C.Q.C. (panCQC) |
| Corso ADR         | iscrCorso     | Corso A.D.R. (PanADR, GroupPag) |
| Guida accompagnata | iscrGUIACC   | Autorizzazione guida accompagnata |
| Certificato medico | iscrCerMed   | Richiesta certificato medico |
| Patente nautica   | iscrNaut      | (se presente) |
| Altro             | iscrAltro     | Nuova iscrizione generica |

Ogni form viene aperto con titolo tipo "… - Registra Nuova Iscrizione" e `BTMRECU.Visible = true` dove previsto (recupero dati da portale/CED).

---

## 3. Tipi iscrizione (eleTipoIscrizione) e form di modifica

In **anagrafe**, alla modifica (doppio click o btmedit) il form aperto dipende dalla sigla **eleTipoIscrizione** della riga:

| Sigla eleTipoIscrizione | Form aperto   | Descrizione |
|-------------------------|---------------|-------------|
| IN, PR, RE              | iscrEsame     | Conseguimento per esame |
| CM                      | iscrCerMed    | Certificato medico |
| PN                      | iscrNaut      | Patente nautica |
| D\|, Y\|, L\|, S\|, R\|  | iscrdup       | Rilascio duplicato (alcune voci tipo rimosse) |
| M\|, E\|                 | iscrdup       | Rilascio per conversione (panConv, pandupl nascosto) |
| PC, CC                  | iscrPATCQC    | Patente CQC / CQC Card |
| CV                      | iscrRinnovo   | Conferma validità (rinnovo patente) |
| GA                      | iscrGUIACC    | Guida accompagnata |
| EG, AD, PI, PP          | iscrAltro     | Esercitazione guide, Archivio dati, Permesso internazionale, Permesso provvisorio guida |
| RP, CQ, CK, CA          | iscrCorso     | Corso recupero punti, Corso CQC, Corso CAP, Corso ADR |

*(Le sigle con \| sono letterali nel codice, es. "D|", "Y|".)*

---

## 4. Form iscrizioni specializzate (sintesi)

| Form       | Titolo / uso |
|-----------|---------------|
| **iscrEsame**   | Conseguimento per esame |
| **iscrCerMed**  | Gestione richieste certificato medico |
| **iscrdup**     | Rilascio per duplicato / per conversione (stesso form, pannelli diversi) |
| **iscrPATCQC**  | Richiesta patente C.Q.C. / CQC Card |
| **iscrRinnovo** | Gestione richieste rinnovo patente |
| **iscrGUIACC**  | Guida accompagnata |
| **iscrAltro**   | Nuova iscrizione (EG, AD, PI, PP) |
| **iscrCorso**   | Corso (recupero punti, CQC, CAP, ADR) |
| **iscrNaut**    | Patente nautica |

Tutti espongono almeno:
- `codicecandidato` (TextBox): id candidato da anagrafe.
- Caricamento/salvataggio dati legati a quel tipo di iscrizione (interno, statini, visite, certificati, corsi, ecc.).

---

## 5. ModIscritti (modulo helper)

- **File:** `ModIscritti.cs`
- **Tipo:** modulo standard (class statica), no form.

Funzioni principali (sintesi):
- **SetComboYesNo / SetComboYesNoFromRow:** imposta ComboBox SI/NO da valore o da DataRow.
- **ParseBoolNullable:** interpreta stringhe (SI/NO, TRUE/FALSE, 1/0, …) in bool?.
- **GetControl:** trova controllo per nome su un form.
- **SetTextValue / GetStr:** lettura/scrittura testi su controlli da DataRow (binding campi anagrafici).
- **Lettura/scrittura dati iscritto** su vari form iscr (cod_ana, cognome, nome, codice fiscale, data nascita, indirizzo, patente, npatente, punti, ecc.) per caricare/salvare dalla riga anagrafe o dal DB.

Usato da anagrafe e da tutti i form iscr per popolare e leggere i campi in modo uniforme.

---

## 6. dettaglio (Dettaglio Richiesta)

- **Titolo:** `Dettaglio Richiesta`
- **File:** `dettaglio.cs`, `dettaglio.Designer.cs`
- **Uso:** visualizzazione dettaglio di una richiesta/iscrizione (es. da portale, da pratica). Non è la griglia principale ma il “dettaglio” di un singolo record (dati completi, stati, protocolli, ecc.). Usato anche in contesti come resocon (colonna dettaglio).

---

## 7. NAVIGATOREnew e integrazione

- **NAVIGATOREnew:** form “navigatore” principale (menu a tendina / sezioni). Da qui si può aprire **anagrafe** (Gestione anagrafica).
- Dopo selezione in anagrafe è possibile passare al navigatore (es. prenotazioni, portale) con `codric`, `inicog` ecc. impostati sul candidato selezionato (codcand, cognome, …).

---

## 8. Riepilogo flussi

1. **Apertura anagrafe:** da menu o da NAVIGATOREnew → griglia “Iscrizioni Presenti in Archivio” con filtri (cognome, nome, tipo, autoscuola).
2. **Nuova iscrizione:** anagrafe → btmadd → nuovaiscr (scelta tipo) → form iscr (iscrEsame, iscrdup, iscrCorso, …) con titolo “… - Registra Nuova Iscrizione”.
3. **Modifica iscritto:** anagrafe → selezione riga → doppio click (o btmedit) → in base a eleTipoIscrizione si apre iscrEsame, iscrdup, iscrCerMed, iscrNaut, iscrPATCQC, iscrRinnovo, iscrGUIACC, iscrAltro o iscrCorso con codicecandidato = codcand; alla chiusura si ricarica la griglia.
4. **Dettaglio richiesta:** in contesti specifici si apre **dettaglio** per vedere il dettaglio completo di una richiesta/iscrizione.
5. **ModIscritti:** usato ovunque per binding e lettura/scrittura campi iscritto sui form iscr e anagrafe.

---

## 9. Nel gestionale web

- **Anagrafica e Iscrizioni** nel menu punta a questa documentazione / pagina di riferimento; l’uso operativo è unificato nella pagina **Candidati** (`/candidati`), che riproduce in forma web: elenco candidati, filtri, dettaglio, e (in evoluzione) le varie “tipologie” di iscrizione (conseguimento, rinnovo, corsi, duplicato, ecc.) in linea con i form GeCA sopra descritti.
