# Portale dell'Automobilista — Sistema Unico Prenotazione Esami
## Documentazione Tecnica Completa per Replicazione del Gestionale

**Data rilevazione:** 26/03/2026
**Autoscuola:** BLUEFOX S.R.L. — Cod. `0674` — Ufficio `ME` (Messina) — Cod. Esaminatore `083`
**URL base:** `https://www.ilportaledellautomobilista.it`
**Stack tecnologico:** Apache Struts2 / Liferay — jQuery — DataTables

---

## INDICE

1. [Autenticazione](#1-autenticazione)
2. [Struttura Navigazione](#2-struttura-navigazione)
3. [Meccanismi Tecnici Globali](#3-meccanismi-tecnici-globali)
4. [Situazione Candidati](#4-situazione-candidati)
5. [Prenotazione Esame da Candidato](#5-prenotazione-esame-da-candidato)
6. [Conseguimento Patente — Sessioni Quiz Interne](#6-conseguimento-patente--sessioni-quiz-interne)
7. [Conseguimento Patente — Sessioni Guide/Orali/Scritti](#7-conseguimento-patente--sessioni-guideoralisscritti)
8. [Conseguimento Patente — Sessioni Approvate](#8-conseguimento-patente--sessioni-approvate)
9. [Conseguimento Patente — Sposta Da Sessione](#9-conseguimento-patente--sposta-da-sessione)
10. [Conseguimento Patente — Verbali Aperti](#10-conseguimento-patente--verbali-aperti)
11. [Conseguimento Patente — Verbali Svolti](#11-conseguimento-patente--verbali-svolti)
12. [Conseguimento Patente — Verbali Annullati](#12-conseguimento-patente--verbali-annullati)
13. [Conseguimento Patente — Sposta da Verbali](#13-conseguimento-patente--sposta-da-verbali)
14. [Conseguimento CQC — Sessioni CQC](#14-conseguimento-cqc--sessioni-cqc)
15. [Conseguimento CQC — Sessioni Approvate CQC](#15-conseguimento-cqc--sessioni-approvate-cqc)
16. [Conseguimento CQC — Sposta Da Sessione CQC](#16-conseguimento-cqc--sposta-da-sessione-cqc)
17. [Conseguimento CQC — Verbali Aperti/Svolti/Annullati CQC](#17-conseguimento-cqc--verbali-apertisvoltannullati-cqc)
18. [Revisione Patente — Verbali Svolti / Annullati](#18-revisione-patente--verbali-svolti--annullati)
19. [Revisione CQC — Verbali Svolti / Annullati](#19-revisione-cqc--verbali-svolti--annullati)
20. [Sessioni Guida Scadute (Diniego)](#20-sessioni-guida-scadute-diniego)
21. [Messaggi](#21-messaggi)
22. [Tabella Riepilogativa indicatoreTipoSessione](#22-tabella-riepilogativa-indicatoretiposessione)
23. [Struttura Chiavi RadioKey](#23-struttura-chiavi-radiokey)
24. [Funzioni JavaScript Principali](#24-funzioni-javascript-principali)
25. [Flusso Completo Prenotazione Candidato](#25-flusso-completo-prenotazione-candidato)

---

## 1. AUTENTICAZIONE

### URL
```
POST https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action
```

### Payload POST
| Campo | Valore |
|-------|--------|
| `loginView.beanUtente.userName` | username |
| `loginView.beanUtente.password` | password |
| `loginView.gotoRedirect` | `https://www.ilportaledellautomobilista.it` |
| `orgname` | `/` |
| `action:Login_executeLogin` | `Login` |

### Verifica successo
- URL risposta NON contiene `Login_initAction` né `login`
- Corpo risposta contiene `Benvenuto` oppure URL contiene `prenotazione`

### Sessione
- Gestita tramite cookie di sessione standard (JSESSIONID)
- `requests.Session()` in Python gestisce automaticamente i cookie
- SSL attivo (`session.verify = True`)
- User-Agent: Mozilla 5.0 Chrome 120 (richiesto per evitare blocchi)

---

## 2. STRUTTURA NAVIGAZIONE

```
Home (/prenotazione/menu/LoadMenu.action)
│
├── Situazione Candidati
│   └── /richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action
│
├── Pren. Esame da Candidato
│   └── /prenotazioneCandidatoEP/Read_initAction.action
│
├── [Sessioni Guida Scadute]
│   └── /disponibilitaSessioneEsameEP/Read_initDiniego.action
│
├── Conseguimento Patente
│   ├── Sessioni Quiz Interne → /disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action
│   ├── Sessioni Guide/Orali/Scritti → /disponibilitaSessioneEsameEP/Read_initActionSessioniGuideOrali.action
│   ├── Sessioni Approvate - Cons. → /disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action
│   ├── Sposta Da Sessione - Cons. → /disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessione.action
│   ├── Verbali Aperti - Cons. → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiConseguimento.action
│   ├── Verbali Svolti - Cons. → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action
│   ├── Verbali Annullati - Cons. → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiConseguimento.action
│   └── Sposta da Verbali Cons. → /sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliConseguimento.action
│
├── Conseguimento CQC
│   ├── Sessioni Cqc → /disponibilitaSessioneEsameEP/Read_initActionSessioniCqc.action
│   ├── Sessioni Approvate - Cqc → /disponibilitaSessioneEsameEP/Read_initActionSessioniCqcApprovate.action
│   ├── Sposta Da Sessione - Cqc → /disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessioneCqc.action
│   ├── Verbali Aperti - Cqc → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiCqc.action
│   ├── Verbali Svolti - Cqc → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqc.action
│   ├── Verbali Annullati - Cqc → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiCqc.action
│   └── Sposta da Verbali Cqc → /sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliCqc.action
│
├── Revisione Patente
│   ├── Verbali Svolti - Rev. → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiRevisione.action
│   └── Verbali Annullati - Rev. → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiRevisione.action
│
├── Revisione CQC
│   ├── Verbali Svolti - Rev. Cqc → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqcRev.action
│   └── Verbali Annullati - Rev. Cqc → /sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiRevisioneCqc.action
│
└── Messaggi
    ├── Oggi → /messaggi/Read_elencoMessaggiAttiviGiornalieriHeader.action
    └── Tutti → /messaggi/Read_elencoMessaggiAttiviTotaliHeader.action
```

---

## 3. MECCANISMI TECNICI GLOBALI

### 3.1 Token CSRF Struts2

Ogni form POST richiede un token CSRF a uso singolo (consumato dopo il primo invio).

**Procedura obbligatoria:**
1. `GET` alla pagina di ricerca (`?pageStatus=SEARCH`) → ottieni token fresco
2. Estrai dal form HTML:
   - `struts.token.name` → nome del token (es. `tokenSearchDisponibilitaSessioneEsameEP`)
   - Valore del token (es. `BVFJKMDDCQAZPW5ZPLPAH5XOPBI14Z33`)
3. Includi ENTRAMBI nel payload POST

**Esempio Python:**
```python
from bs4 import BeautifulSoup

def get_struts_token(session, url):
    resp = session.get(url + "?pageStatus=SEARCH")
    soup = BeautifulSoup(resp.text, "html.parser")
    form = soup.find("form", {"id": re.compile(r"Ricerca|Dettaglio")})
    params = {}
    for inp in form.find_all("input", {"type": "hidden"}):
        if inp.get("name"):
            params[inp["name"]] = inp.get("value", "")
    return params
```

### 3.2 Nomi azione Struts (action: prefix)

Il nome del pulsante submit che attiva l'azione deve essere incluso nel payload:

| Sezione | Submit name | Valore |
|---------|-------------|--------|
| Sessioni Quiz/Guide | `action:Read_paging` | `Ricerca` |
| Verbali Conseguimento | `action:ReadConseguimento_pagingConseguimento` | `Ricerca` |
| Verbali CQC | `action:ReadCqc_pagingCQC` | `Ricerca` |
| Verbali Revisione | `action:ReadRevisione_pagingRevisione` | `Ricerca` |
| Verbali Annullati Cons. | `action:VerbaleAnnullato_pagingVerbaleAnnullato` | `Ricerca` |
| Sposta Sessione Cons. | `action:SpostaDaSessione_pagingOrigineSpostaDaSessione` | `Ricerca` |
| Sposta Sessione CQC | `action:SpostaDaSessione_pagingOrigineSpostaDaSessioneCqc` | `Ricerca` |

### 3.3 Limiti range date

| Sezione | Range massimo |
|---------|--------------|
| Sessioni Quiz Interne / Guide | 30 giorni |
| Verbali (Aperti/Svolti/Annullati) | 7 giorni |

### 3.4 Campi obbligatori

- **Ufficio Provinciale** (`codUfficioMCTC`) è sempre obbligatorio. Per BLUEFOX: `ME`
- **Data da/a**: obbligatorie per Sessioni e Verbali

### 3.5 Identificatori principali

| Identifier | Descrizione | Esempio |
|-----------|-------------|---------|
| `COD_UFFICIO` | Codice ufficio MCTC | `ME` |
| `COD_AUTOSCUOLA` | Codice autoscuola | `0674` |
| `COD_ESAMINATORE` | Codice esaminatore | `083` |
| `COD_LOCALITA` | Progressivo sede esame | `660` |
| `COD_AULA` | Numero aula | `1` |

---

## 4. SITUAZIONE CANDIDATI

### URL
```
GET  /richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH
POST /richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action
```

### Form ID: `RicercaSituazioneCandidati`

### Campi nascosti fissi
| Campo | Valore |
|-------|--------|
| `struts.token.name` | `tokenSearchRichiestaEmissioneDocumentoAbilitazioneEP` |
| Token dinamico | (valore) |

### Campi ricerca
| Campo (prefisso: `richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.`) | Tipo | Valori |
|---|---|---|
| `indicatoreTipoSessione` | hidden | `C` (Conseguimento) |
| `indicatoreConseguimentoEsame` | hidden | `P`=Patente, `Q`=CQC |
| `theDisponibilitaEsaminatoreEP.codUfficioMCTC` | text | es. `ME` |
| `codiceIdentificativoAutoscuolaAgenzia` | text | es. `0674` |
| `indicatoreStatoCandidati` | hidden | `D`=Da Prenotare, `P`=Prenotati |
| `dataFrom` | text | data da (opzionale) |
| `dataTo` | text | data a (opzionale) |
| `indicatoreTipoProvaEsame` | hidden | `Q` (Quiz) |
| `indicatoreStatoRichiesta` | hidden | `A` |
| `indicatoreTipoProvaEsameDaPrenotare` | hidden | `T` |

### Submit
`action:ReadSituazioneCandidati_pagingSituazioneCandidati` = `Ricerca`

### Tabella risultati — Colonne
`Uff. Prov. | Autoscuola | Tipo Esame | Abilitazione Richiesta | Nr. Candidati | Stato Candidati | Sel.`

### Radio key formato
```
{cod_ufficio}|{cod_autoscuola}|{tipo_esame}|{abilitazione}|{nr_candidati}|{stato}
```

### Pulsanti disponibili sui risultati
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Dettaglio | `action:ReadSituazioneCandidati_pagingSituazioneCandidati` | Mostra lista candidati del gruppo |

### Dettaglio candidati — Colonne
`Marca Operativa | Cognome | Nome | Codice Statino | DataEmissione Statino | Scadenza | AbilitazioneRichiesta | Tipo Esame`

### Link candidato singolo
Clic su Marca Operativa → `Read_searchElementDaSituazioneCandidati.action` con `selectRowId=null|null|null|null|null|null|ME|{aula}|{progressivo}|`

### Dati rilevati (BLUEFOX 26/03/2026)
- **Da Prenotare Patente:** A1:8, AM:4, B:21, C:2 → **totale 35**
- **Da Prenotare CQC:** (separato)
- **Prenotati Patente:** (separato)

---

## 5. PRENOTAZIONE ESAME DA CANDIDATO

### URL
```
GET  /prenotazioneCandidatoEP/Read_initAction.action
```

### Descrizione
Permette di cercare un singolo candidato per prenotarlo a un esame.

### Campi ricerca candidato
- Marca Operativa (numero patente)
- Data di Nascita
- Codice Fiscale / altro identificatore

### Flusso
1. Ricerca candidato → risultato con dati anagrafici
2. Clic `#buttonPlus` → `Select_viewNuovaPrenotazione.action?...selectRowId=...`
3. Pagina "Lista Sessioni" → lista sessioni disponibili filtrate per tipo esame
4. Selezione sessione → prenotazione confermata

---

## 6. CONSEGUIMENTO PATENTE — SESSIONI QUIZ INTERNE

### URL
```
GET  /disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH
POST /disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action
```

### Form ID: `RicercaDisponibilitaSessioneEsameEP`

### Campi nascosti fissi
| Campo | Valore |
|-------|--------|
| `disponibilitaSessioneEsameEPView.indicatoreTipoSessione` | `SQI` |
| `disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.indicatoreConseguimentoEsame` | `P` |
| `disponibilitaSessioneEsameEPView.approvata` | `N` |
| `disponibilitaSessioneEsameEPView.dataDiniegoAlRilascio` | `01/01/2013` |

### Campi ricerca (prefisso: `disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.`)
| Campo finale | Tipo | Valori |
|---|---|---|
| `theDisponibilitaEsaminatoreEP.codUfficioMCTC` | text | es. `ME` |
| `dataDisponibiltaEsaminatore` (**da**) | text | gg/mm/aaaa |
| `dataTo.dataDisponibiltaEsaminatore` (**a**) | text | gg/mm/aaaa (max +30gg) |
| `indicatoreFasciaOrariaEsaminatore` | select | `M`=Mattutina, `P`=Pomeridiana |
| `theAulaEP.theLocalitaEsameAbilitazioneEP.progressivoLocalitaEsameAbilitazione` | text | es. `660` |
| `flagRicercaSessioniCiaConCandidatiAutoscuola` | checkbox | `true` |
| `flagRicercaSessioniConCandidatiAutoscuola` | checkbox | `true` |

### Submit
`action:Read_paging` = `Ricerca`
`action:Read_clearSearch` = `Annulla`

### Tabella risultati — Colonne
`Sel. | (icona) | (flag) | Data Ses. | Limite Pren. | Esame | F.O | Ufficio Prov. | Loc. | Aula | Turni | Esam. | Cand. Poss. | Cand. Pren. | Desc. Località | Stato`

### Valori Stato
`APERTA | BLOCCATA | ANNULLATA`

### Valori Esame (per Patente)
`QUIZ - AS` (Quiz Autoscuola) — tipo seduta `QALL`

### Radio key formato (Sessioni Patente)
```
{cod_esaminatore}|{cod_localita}|{cod_aula}|{cod_ufficio}|{data_sessione}|{fascia}|{nr_candidati}|{extra}
```
Esempio: `083|660|1|ME|2026-03-30 00:00:00.0|M|68|null`

### Pulsanti disponibili
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Dettaglio | `action:Select_listCandidati` | Apre dettaglio sessione |
| Esporta Excel | (link) | Download Excel |
| Esporta PDF | (link) | Download PDF |

---

### 6.1 DETTAGLIO SESSIONE QUIZ — URL
```
POST /disponibilitaSessioneEsameEP/Read_paging.action
```
(risultato del click su Dettaglio dalla lista sessioni)

### Form ID: `DettaglioDisponibilitaSessioneEsameEP`
Action: `Select_listCandidati.action`

### Campi header sessione (visibili/read-only)
| Campo | Descrizione | Esempio |
|-------|-------------|---------|
| `descrizioneTipoProvaEsame` | Tipo esame | `QUIZ` |
| `descrizioneCompletaUfficioMCTC` | Ufficio | `ME - MESSINA` |
| `dataDisponibiltaEsaminatore` | Data sessione | `30/03/2026` |
| `dataLimitePrenotazione` | Data limite prenotazione | `27/03/2026` |
| `indicatoreFasciaOrariaEsaminatoreRead` | Fascia oraria | `M`=Mattutina |
| `descrizioneCompletaLocalitaEsame` | Località | `660 - UP MESSINA - QUIZ PATENTI` |
| `progressivoAula` | Aula | `1` |
| `numeroCapienzaAula` | Capienza aula | `17` |
| `numeroEsaminatoriDisponibilitaEsame` | Num. esaminatori | `1` |
| `numeroTurniDisponibilitaEsame` | Num. turni | `4` |
| `codiceTipoSedutaEsame` | Tipo seduta | `QALL` |
| `numeroGiorniLimiteInserimentoAutoscuola` | Giorni limite | `14` |
| `indicatoreConto` | Tipo conto | `P`=Privato, `S`=Stato |
| `numeroPostiRiservatiUfficio` | Posti riservati UP | `0` |
| `numeroPostiRiservatiAutoscuolaTurno` | Posti max autoscuola/turno | `10` |

### Tabella Turni — Colonne
`Sel. | Turno | Esaminatore | Orario Inizio | Minuti turno | Ufficio Operativo`

Dati esempio sessione 30/03/2026:
- Turno 1: 08:30, 60 min, Esam. 1, CIA `QALL`, Categorie: A1,A2,A3,AM,B,B+...
- Turno 2: 09:30, 60 min
- Turno 3: 10:30, 60 min
- Turno 4: 11:30, 60 min

### Radio key Turni
```
{cod_esaminatore}|{cod_localita}|{cod_aula}|{cod_ufficio}|{data_sessione}|{fascia}|{turno}|{num_esaminatore}|
```
Esempio: `083|660|1|ME|2026-03-30 00:00:00.0|M|1|1|`

### Tabella Candidati — Colonne (Patente QUIZ)
`Nr. | Sel. | Marca Operativa | Patente | Abilitazione | Num. Domande | Autoscuola | Cognome | Codice Anomalia | Lingua | Supporto Audio | Turno | Esaminatore | Ente`

**Ente:** `A`=Autoscuola, `U`=UP (posto riservato UP)

### Pulsanti disponibili (Dettaglio QUIZ Patente)
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Ricerca/Filtra | `action:Select_listCandidati` | Filtra per turno |
| Stampa | `action:SelectCandidato_stampaPrenotazioneCandidato` | Stampa candidato |
| Stampa Candidati Autoscuola | `action:SelectCandidato_stampaPrenotazioneCandidatiPropriAutoscuola` | Stampa tutti propri |
| Storia | `action:SelectCandidato_viewStoriaElementCandidato` | Storico candidato |
| Dettaglio | `action:SelectCandidato_viewElementCandidato` | Scheda candidato |
| Indietro | `action:Read_backSearch` | Torna alla lista |

### AJAX — Calcolo Data Limite Prenotazione
```
GET /disponibilitaSessioneEsameEP/Read_viewDataLimitePrenotazione.action
    ?id={dataSessione}&id2={giorniLimite}&codiceUmc={codUfficio}
```
Risposta: stringa data (gg/mm/aaaa)

---

## 7. CONSEGUIMENTO PATENTE — SESSIONI GUIDE/ORALI/SCRITTI

### URL
```
GET/POST /disponibilitaSessioneEsameEP/Read_initActionSessioniGuideOrali.action
```

### Differenze rispetto a Sessioni Quiz Interne
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `SGOS` (vs `SQI`) |
| `indicatoreConseguimentoEsame` | `P` |
| `approvata` | `N` |

### Campi ricerca aggiuntivi
| Campo | Tipo | Valori |
|-------|------|--------|
| `indicatoreTipoProvaEsame` | select | `G`=GUIDA, `O`=ORALE, `S`=SCRITTO |
| `theStatoDisponibilitaSessioneEsameEP.selectRowId` | select | `A\|`=APERTA, `B\|`=BLOCCATA, `L\|`=ANNULLATA |

### Submit
`action:Read_paging` = `Ricerca`

### Tabella risultati — Colonne
`Sel. | Data Ses. | Limite Pren. | Esame | F.O | Ufficio Prov. | Loc. | Turni | Cand. Poss. | Cand. Pren. | Desc. Località | Anomalia | Stato`

**Nota:** Manca colonna "Aula" rispetto alle Approvate; colonna "Anomalia" indica se la sessione ha anomalie.

### Dati rilevati (26/03/2026)
- 09/04/2026 Mattutina ME: GUIDA, 3 turni, 36 posti, 17 prenotati — APERTA
- 17/04/2026 Mattutina ME: GUIDA, 2 turni, 19 posti, 7 prenotati — APERTA

---

### 7.1 DETTAGLIO SESSIONE GUIDE

### Form ID: `DettaglioDisponibilitaSessioneEsameEP`

### Differenze chiave rispetto al Dettaglio Quiz

**Turni — Colonne:**
`Sel. | Turno | Esaminatore | Min. Residui | Durata(in min.) | Cod. CIA/Autoscuola | Cod. Tipo Seduta | Categorie Ammesse | Tipo Ciclomotore`

**Tipo Seduta GUIDA:** `0SUP` = Ordinario Superiore, `ABCI` = Abilitazioni B1, C, I

**Candidati — Colonne aggiuntive rispetto a QUIZ:**
`Nr. | Sel. | Marca Operativa | Patente | Abilitazione | Autoscuola | Cognome | Codice Anomalia | Stampa Attestato / Guide Certificate | Esercitazioni / Guide Completate | Turno | Ente`

**Pulsanti aggiuntivi per GUIDA:**
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Nuovo Candidato | `action:SelectCandidato_viewNewCandidato` | Inserisci nuovo candidato |
| Acq. File | `action:ReadUpload_initUploadFile` | Upload file candidati |

### Funzioni JS specifiche GUIDA
- `returnRefreshTipoSeduta1()` — Aggiorna tipo seduta e calcola capienza automatica
- `changeNumeroMaxCandidatiMinutaggioFromCampoDurata()` — Ricalcola posti da durata/minuti
- `changeIndicatoreTipoSessioneEsameCiclomotore()` — Toggle sezione ciclomotore
- `changeReadonlyMinutaggio()` — Abilita/disabilita campo durata

---

## 8. CONSEGUIMENTO PATENTE — SESSIONI APPROVATE

### URL
```
GET/POST /disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action
```

### Differenze rispetto a Quiz Interne
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `SQA` |
| `approvata` | `S` (sessioni approvate = CHIUSE) |
| `theStatoDisponibilitaSessioneEsameEP.selectRowId` | `C` (CHIUSA, fisso) |

### Tipo Esame
Tutte le tipologie: `Q`=QUIZ, `G`=GUIDA, `O`=ORALE, `S`=SCRITTO

### Tabella risultati — Colonne aggiuntive vs Quiz Interne
`Sel. | Data Ses. | Limite Pren. | Esame | F.O | Ufficio Prov. | Loc. | **Aula** | Turni | **Esam.** | Cand. Poss. | Cand. Pren. | Desc. Località | Stato`

**Nota:** Aggiunge colonne "Aula" ed "Esam." rispetto alle sessioni aperte.

### Dati rilevati (26/03/2026)
- 26/03/2026 M: QUIZ-AS, ME, loc 660, aula 1, 2 turni, 8 poss., 32 pren. — APPROVATA
- 26/03/2026 P: QUIZ-AS, ME, loc 660, aula 1, 3 turni, 12 poss., 51 pren. — APPROVATA

### Dettaglio Sessione Approvata — Pulsanti
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Ricerca | `action:Select_listCandidati` | Filtra candidati |
| Stampa | `action:SelectCandidato_stampaPrenotazioneCandidato` | Stampa singolo |
| Stampa Candidati Autoscuola | `action:SelectCandidato_stampaPrenotazioneCandidatiPropriAutoscuola` | Stampa tutti |
| Storia | `action:SelectCandidato_viewStoriaElementCandidato` | Storico |
| Dettaglio | `action:SelectCandidato_viewElementCandidato` | Scheda |
| Indietro | `action:Read_backSearch` | Torna lista |

---

## 9. CONSEGUIMENTO PATENTE — SPOSTA DA SESSIONE

### URL
```
GET/POST /disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessione.action
```

### Campi nascosti
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `""` (vuoto — include tutti i tipi) |
| `indicatoreConseguimentoEsame` | `P` |
| `approvata` | `N` |

### Tipo Esame
Tutte le tipologie: `Q`=QUIZ, `G`=GUIDA, `O`=ORALE, `S`=SCRITTO

### Submit
`action:SpostaDaSessione_pagingOrigineSpostaDaSessione` = `Ricerca`
`action:SpostaDaSessione_clearSearchOrigineSpostaDaSessione` = `Annulla`

### Descrizione funzione
Permette di spostare candidati da una sessione (Origine) a un'altra sessione (Destinazione). Il workflow è in due step:
1. Ricerca e selezione **sessione di origine**
2. Ricerca e selezione **sessione di destinazione**
3. Conferma spostamento

---

## 10. CONSEGUIMENTO PATENTE — VERBALI APERTI

### URL
```
GET/POST /sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiConseguimento.action
```

### Form ID: `RicercaSessioneEsameAbilitazioneEP`
**Nota:** Tutti i verbali (Conseguimento, CQC, Revisione) usano lo stesso Form ID ma diversi `indicatoreTipoSessione`.

### Campi nascosti fissi
| Campo | Valore |
|-------|--------|
| `sessioneEsameAbilitazioneEPView.indicatoreTipoSessione` | `VAC` |
| `sessioneEsameAbilitazioneEPView.indicatoreComboUfficioProvinciale` | `B` |

### Campi ricerca (prefisso: `sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.`)
| Campo finale | Tipo | Valori |
|---|---|---|
| `theTipoProvaSessioneEsameAbilitazioneEP.codiceTipoProvaSedutaEsame` | select | `I`=QUIZ, `G`=GUIDA, `O`=ORALE, `S`=SCRITTO |
| `dataVerbaleEsameAbilitazione` (**da**) | text | gg/mm/aaaa |
| `dataVerbaleEsameAbilitazioneTO.dataVerbaleEsameAbilitazione` (**a**) | text | gg/mm/aaaa (max +7gg) |
| `indicatoreFasciaOrariaSessioneEsame` | select | `M`=Mattutina, `P`=Pomeridiana |
| `progressivoVerbaleEsameAbilitazione` | text | Numero verbale |
| `theUfficioCompetenteMCTCAN.codUfficioMCTC` | text | es. `ME` (**obbligatorio**) |
| `progressivoLocalitaEsameAbilitazione` | text | es. `660` |
| `theLocalitaEsameAbilitazioneEP.indicatoreStatoLocalitaEsameAbilitazione` | select | `A`=Attiva, `C`=Cessata |
| `theAbilitazioneEsaminatoreMCTCEP.codiceEsaminatore` | text | codice esaminatore |
| `theAbilitazioneEsaminatoreMCTCEP.descrizioneCognomeEsaminatore` | text | cognome esaminatore |
| `annoVerbaleEsameAbilitazione` | select | 2006-2026 (**solo per GUIDA**) |

### Submit
`action:ReadConseguimento_pagingConseguimento` = `Ricerca`
`action:ReadConseguimento_clearSearchConseguimento` = `Annulla`

### Nota Anno Verbale
Il campo `annoVerbaleEsameAbilitazione` è visibile **solo** quando `codiceTipoProvaSedutaEsame` = `G` (GUIDA).
Funzione JS: `changeIndicatoreTipoProvaSedutaEsame()`

---

## 11. CONSEGUIMENTO PATENTE — VERBALI SVOLTI

### URL
```
GET/POST /sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action
```

### Campi nascosti fissi
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `VSC` |

### (Tutti gli altri campi identici a Verbali Aperti)

### Tabella risultati — Colonne
`Sel. | Data Verb. | Esame | F.O | Verb. | Cand. Pren. | Stato Verb. | Uff. Prov. | Loc. | Aula | Desc. Località | Indirizzo`

### Valori Stato Verbale
`VERBALE CON ESITI INSERITI E BLOCCATI PER LA MODIFICA` = Verbale chiuso con esiti

### Dati rilevati (settimana 20-26/03/2026)
- 20/03/2026 M: QUIZ-AS, Verb. 1, 17 cand., VERBALE CON ESITI INSERITI E BLOCCATI, ME-660-1
- 23/03/2026 M: QUIZ-AS, Verb. 1, 17 cand., VERBALE CON ESITI INSERITI E BLOCCATI, ME-660-1

### Radio key Verbali
```
{cod_esaminatore}|{cod_localita}|{cod_ufficio}|{data_verbale}|{progressivo_verbale}|
```
Esempio: `083|660|ME|2026-03-20 00:00:00.0|1|`

### Pulsanti disponibili
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Dettaglio | `action:Select_viewDetailVerbale` | Apre dettaglio verbale |

---

### 11.1 DETTAGLIO VERBALE SVOLTO

### URL risultato
```
POST /sessioneEsameAbilitazioneEP/ReadConseguimento_pagingConseguimento.action
```

### Form ID: `DettaglioSessioneEsameAbilitazioneEP`

### Campi nascosti fissi
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `VSC` |
| `modificaEsiti` | `N` (non modificabile) o `S` |
| `flagInserimentoEsiti` | `S` (esiti inseriti) |
| `changeEsaminatore` | `N` |
| `selectRowId` | `{cod_esaminatore}\|{cod_localita}\|{cod_ufficio}\|{data}\|{progressivo}\|` |
| `progressivoAbilitazioneEsaminatore` | es. `1I` |

### Campi header verbale (visibili/read-only)
| Campo | Esempio |
|-------|---------|
| `descrizioneTipoProva` | `QUIZ` |
| `progressivoVerbaleEsameAbilitazione` | `1` |
| `dataVerbaleEsameAbilitazione` | `20/03/2026` |
| `descrizioneCompletaFasciaOrariaSessioneEsame` | `M - Mattutina` |
| `descrizioneCompletaUfficioMCTC` | `ME - MESSINA` |
| `progressivoAula` | `1` |
| `descrizioneCompletaLocalitaEsame` | `660 - UP MESSINA - QUIZ PATENTI` |
| `descrizioneCompletaEsaminatore` | `11I - BASILE GIOVANNA` |

### Tabella Candidati con ESITI — Colonne
`Nr. | Marca Operativa | Abilitazione | Num. Domande | Codice CIA | Autoscuola | Cognome | Nome | Data di Nascita | Lingua | Supporto Audio | Stato Pres. | Esito Esame | Desc. Stato Pres. | Codice Anomalia | Matricola | Data inserimento prenotazione | Ricezione DR | Diniego Rilascio | Stampa Attestato/Guide Certificate | Esercitazioni/Guide Completate`

### Valori Esito Esame
| Codice | Descrizione |
|--------|-------------|
| `I` | Idoneo (Promosso) |
| `N` | Non Idoneo (Bocciato) |
| `A` | Assente |
| `P` | Irregolare/Presente |

### Valori Stato Presenza
`Assente | Presente | Idoneo | Non Idoneo | ASSENZA A PROVA DI ESAME`

### Dati BLUEFOX rilevati (20/03/2026)
- **98ME199888** - CINTURRINO ANTONIO - A1 - Assente (A) - Matr: AGME020501
- **98ME197901** - FERRANTE LUCIANA - AM - Assente (A) - Matr: AGME020501

### Pulsanti disponibili
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Stampa Elenco | `action:Select_stampaEsitiElencoCandidatiPerConseguimento` | Stampa elenco con esiti |
| Indietro | `action:Read_searchElementConseguimento` | Torna lista verbali |

---

## 12. CONSEGUIMENTO PATENTE — VERBALI ANNULLATI

### URL
```
GET/POST /sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiConseguimento.action
```

### Campi nascosti fissi
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `SVCO` |
| `codiceStatoVerbaleSessioneEsame` | `0` |

### Submit
`action:VerbaleAnnullato_pagingVerbaleAnnullato` = `Ricerca`

---

## 13. CONSEGUIMENTO PATENTE — SPOSTA DA VERBALI

### URL
```
GET/POST /sessioneEsameAbilitazioneEP/Read_initActionSpostaVerbaliConseguimento.action
```

### Nota
Condivide stesso `indicatoreTipoSessione` = `SVCO` con Verbali Annullati.
Differisce solo nell'action del pulsante submit.

### Submit
`action:SpostaDaVerbale_pagingOrigineSpostaDaVerbale` = `Ricerca`
`action:SpostaDaVerbale_clearSearchDestinazioneSpostaDaVerbale` = `Annulla`

---

## 14. CONSEGUIMENTO CQC — SESSIONI CQC

### URL
```
GET/POST /disponibilitaSessioneEsameEP/Read_initActionSessioniCqc.action
```

### Campi nascosti fissi — Differenze rispetto a Patente
| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `SCQC` |
| `indicatoreConseguimentoEsame` | **`Q`** (CQC, vs `P` per Patente) |
| `approvata` | `N` |

### Tipo Esame (CQC)
Solo `Q`=QUIZ e `O`=ORALE (no GUIDA, no SCRITTO per CQC)

### Stato sessione — Valori aggiuntivi CQC
`APERTA | BLOCCATA | **DA ATTIVARE** | ANNULLATA`
**Nota:** `DA ATTIVARE` è esclusivo delle sessioni CQC.

### Tabella risultati — Colonne aggiuntive vs Patente
`Sel. | Data Ses. | Esame | F.O | Ufficio Prov. | Loc. | Aula | Turni | **Turno per Assenti** | Esam. | Cand. Poss. | Cand. Pren. | **Cand. Poss. Aut.** | **Cand. Pren. Aut.** | Desc. Località | Stato`

**Colonne extra CQC:**
- `Turno per Assenti` — turno dedicato a chi era assente
- `Cand. Poss. Aut.` — posti disponibili per autoscuola
- `Cand. Pren. Aut.` — candidati prenotati dalla propria autoscuola

### Dati rilevati (26/03/2026, range 30gg)
- 16/04/2026 M: QUIZ, ME, loc 660, aula 1, 2 turni, turno assenti: -, 34 poss., 32 pren., 0/0 aut. — APERTA

---

### 14.1 DETTAGLIO SESSIONE CQC

### Turni — Colonne (CQC diverso da Patente)
`Sel. | Turno | Esaminatore | Orario Inizio Turno | Minuti turno | Ufficio Operativo`

Dati rilevati (16/04/2026):
- Turno 1: 08:30, 150 min (2.5 ore)
- Turno 2: 11:00, 150 min (2.5 ore)

### Candidati CQC — Colonne (diverso da Patente)
`Nr. | Sel. | Marca Operativa | Autoscuola | Cognome | Codice Anomalia | Lingua | Supporto Audio | Turno | Esaminatore | **Tipo Prova** | **Num. Domande** | **Motivo richiesta**`

### Valori Tipo Prova CQC
| Valore | Descrizione |
|--------|-------------|
| `PROVA UNICA MERCI` | Prova CQC merci completa (70 domande) |
| `PROVA UNICA PERSONE` | Prova CQC persone completa (70 domande) |
| `SPECIALISTICA MERCI` | Solo sezione specialistica merci (30 domande) |
| `SPECIALISTICA PERSONE` | Solo sezione specialistica persone |

### Pulsanti aggiuntivi CQC (non presenti in Patente)
| Pulsante | Action name | Descrizione |
|----------|-------------|-------------|
| Nuovo Candidato | `action:SelectCandidato_viewNewCandidato` | Inserisci candidato CQC |
| **Modifica Candidato** | `action:SelectCandidato_editElementCandidato` | **Modifica** dati candidato |
| **Elimina Candidato** | `action:SelectCandidato_viewDeletingElementCandidato` | **Elimina** candidato |
| Stampa | `action:SelectCandidato_stampaPrenotazioneCandidato` | Stampa candidato |
| Stampa Candidati Autoscuola | `action:SelectCandidato_stampaPrenotazioneCandidatiPropriAutoscuola` | Stampa tutti |
| Storia | `action:SelectCandidato_viewStoriaElementCandidato` | Storico |
| Dettaglio | `action:SelectCandidato_viewElementCandidato` | Scheda |

---

## 15. CONSEGUIMENTO CQC — SESSIONI APPROVATE CQC

### URL
```
GET/POST /disponibilitaSessioneEsameEP/Read_initActionSessioniCqcApprovate.action
```

| Campo | Valore |
|-------|--------|
| `indicatoreTipoSessione` | `SCQCA` |
| `indicatoreConseguimentoEsame` | `Q` |
| `approvata` | `S` |
| `selectRowId` (stato) | `C` (CHIUSA, fisso) |

---

## 16. CONSEGUIMENTO CQC — SPOSTA DA SESSIONE CQC

### URL
```
GET/POST /disponibilitaSessioneEsameEP/Read_initActionSpostaDaSessioneCqc.action
```

| Campo | Valore |
|-------|--------|
| `indicatoreConseguimentoEsame` | `Q` (secondo hidden field) |

### Submit
`action:SpostaDaSessione_pagingOrigineSpostaDaSessioneCqc` = `Ricerca`

---

## 17. CONSEGUIMENTO CQC — VERBALI APERTI/SVOLTI/ANNULLATI CQC

| Sezione | URL action | `indicatoreTipoSessione` | Submit action |
|---------|-----------|--------------------------|---------------|
| Verbali Aperti CQC | `Read_initActionVerbaliApertiCqc` | `VAQ` | `ReadCqc_pagingCQC` |
| Verbali Svolti CQC | `Read_initActionVerbaliSvoltiCqc` | `VSQ` | `ReadCqc_pagingCQC` |
| Verbali Annullati CQC | `Read_initActionVerbaliAnnullatiCqc` | `SVSQ` | `VerbaleAnnullatoCqc_pagingVerbaleAnnullatoCqc` |
| Sposta da Verbali CQC | `Read_initActionSpostaVerbaliCqc` | `SVSQ` | `SpostaDaVerbaleCqc_pagingCQCAnnullate` |

### Tipo Esame CQC Verbali
Solo `I`=QUIZ e `O`=ORALE

---

## 18. REVISIONE PATENTE — VERBALI SVOLTI / ANNULLATI

| Sezione | URL action | `indicatoreTipoSessione` | Submit action |
|---------|-----------|--------------------------|---------------|
| Verbali Svolti Rev. | `Read_initActionVerbaliSvoltiRevisione` | `VSR` | `ReadRevisione_pagingRevisione` |
| Verbali Annullati Rev. | `Read_initActionVerbaliAnnullatiRevisione` | `SVRO` | `VerbaleAnnullatoRevisione_pagingVerbaleAnnullatoRevisione` |

### Tipo Esame Revisione Patente
`I`=QUIZ, `G`=GUIDA, `O`=ORALE (no SCRITTO)

---

## 19. REVISIONE CQC — VERBALI SVOLTI / ANNULLATI

| Sezione | URL action | `indicatoreTipoSessione` | Submit action |
|---------|-----------|--------------------------|---------------|
| Verbali Svolti Rev. CQC | `Read_initActionVerbaliSvoltiCqcRev` | `VSRCQCC` | `ReadRevisione_pagingRevisione` |
| Verbali Annullati Rev. CQC | `Read_initActionVerbaliAnnullatiRevisioneCqc` | `SVROCQC` | `VerbaleAnnullatoRevisioneCqc_pagingVerbaleAnnullatoRevisioneCqc` |

---

## 20. SESSIONI GUIDA SCADUTE (DINIEGO)

### URL
```
GET /disponibilitaSessioneEsameEP/Read_initDiniego.action
```

### Descrizione
Visualizza le sessioni Guide - Orali - Scritti per cui è scaduto il termine di prenotazione ("diniego al rilascio"). Usa la stessa form di Sessioni Guide ma filtrata per data `dataDiniegoAlRilascio`.

Il campo `dataDiniegoAlRilascio` nelle sessioni Guide è impostato a `01/01/2013` (data fissa di sistema dal 2013).

Questa sezione è utile per vedere sessioni perse (non prenotate in tempo).

---

## 21. MESSAGGI

### URL
```
GET /messaggi/Read_elencoMessaggiAttiviGiornalieriHeader.action  (Oggi)
GET /messaggi/Read_elencoMessaggiAttiviTotaliHeader.action       (Tutti)
```

### Descrizione
I messaggi del portale sono visualizzati come **popup overlay** (modal) tramite un iframe (`#popupFrame`). Non hanno una form di ricerca strutturata.

La sezione Messaggi mostra comunicazioni di sistema inviate dall'UP (Ufficio Provinciale) o dalla motorizzazione.

### Contatori
- **Messaggi Personali Oggi**: counter nell'header (es. `0`)
- **Tutti i messaggi**: storico completo

---

## 22. TABELLA RIEPILOGATIVA indicatoreTipoSessione

| Sezione | Codice | Tipo Conseguimento |
|---------|--------|-------------------|
| Sessioni Quiz Interne (Patente) | `SQI` | Patente (`P`) |
| Sessioni Quiz Approvate (Patente) | `SQA` | Patente (`P`) |
| Sessioni Guide/Orali/Scritti (Patente) | `SGOS` | Patente (`P`) |
| Sposta Da Sessione (Patente) | `` (vuoto) | Patente (`P`) |
| Verbali Aperti Conseguimento | `VAC` | Patente (`P`) |
| Verbali Svolti Conseguimento | `VSC` | Patente (`P`) |
| Verbali Annullati Conseguimento | `SVCO` | Patente (`P`) |
| Sposta da Verbali Conseguimento | `SVCO` | Patente (`P`) |
| Sessioni CQC | `SCQC` | CQC (`Q`) |
| Sessioni CQC Approvate | `SCQCA` | CQC (`Q`) |
| Verbali Aperti CQC | `VAQ` | CQC (`Q`) |
| Verbali Svolti CQC | `VSQ` | CQC (`Q`) |
| Verbali Annullati CQC | `SVSQ` | CQC (`Q`) |
| Sposta da Verbali CQC | `SVSQ` | CQC (`Q`) |
| Verbali Svolti Revisione Patente | `VSR` | Patente (Rev.) |
| Verbali Annullati Revisione Patente | `SVRO` | Patente (Rev.) |
| Verbali Svolti Revisione CQC | `VSRCQCC` | CQC (Rev.) |
| Verbali Annullati Revisione CQC | `SVROCQC` | CQC (Rev.) |

---

## 23. STRUTTURA CHIAVI RADIOKEY

### Sessioni (Patente/CQC) — Search Results Radio
```
{cod_esaminatore}|{cod_localita}|{cod_aula}|{cod_ufficio}|{data_sessione}|{fascia}|{nr_candidati}|{extra}
```
Esempio: `083|660|1|ME|2026-03-30 00:00:00.0|M|68|null`

### Turni Sessione — Dettaglio Radio
```
{cod_esaminatore}|{cod_localita}|{cod_aula}|{cod_ufficio}|{data_sessione}|{fascia}|{turno}|{num_esaminatore}|
```
Esempio: `083|660|1|ME|2026-03-30 00:00:00.0|M|1|1|`

### Verbali — Search Results Radio
```
{cod_esaminatore}|{cod_localita}|{cod_ufficio}|{data_verbale}|{progressivo_verbale}|
```
Esempio: `083|660|ME|2026-03-20 00:00:00.0|1|`

### Candidato (selectRowId)
```
null|null|null|null|null|null|{cod_ufficio}|{cod_aula}|{id_candidato}|
```
Esempio: `null|null|null|null|null|null|ME|98|197899|`

---

## 24. FUNZIONI JAVASCRIPT PRINCIPALI

### Funzioni globali (tutte le sezioni)

| Funzione | Trigger | Descrizione |
|----------|---------|-------------|
| `returnRefreshUfficioProvinciale(val)` | Selezione UP da popup | Popola campo codice ufficio |
| `returnRefreshDataSessione(val)` | Selezione data da popup | Popola data + fascia oraria |
| `returnRefreshLocalita(val)` | Selezione località da popup | Popola progressivo località |
| `returnRefreshAula(val)` | Selezione aula da popup | Popola progressivo aula + capienza |
| `returnRefreshEsaminatori(val)` | Selezione esaminatore da popup | Popola codice + cognome |

### Funzioni Sessioni Guide specifiche

| Funzione | Trigger | Descrizione |
|----------|---------|-------------|
| `viewDataLimitePrenotazione()` | Cambio data/giorni | AJAX call → calcola data limite pren. |
| `changeGiorniLimite()` | Cambio tipo prova | Ricalcola range giorni limite |
| `changeIndicatoreTipoSessioneEsameCiclomotore()` | Cambio tipo prova | Toggle UI ciclomotore vs standard |
| `changeReadonlyMinutaggio()` | Caricamento pagina | Abilita/disabilita campo durata turno |
| `changeNumeroMaxCandidatiMinutaggioFromCampoDurata()` | Cambio durata | Ricalcola max candidati = floor(durata / durata_minima) |
| `returnRefreshTipoSeduta1(val)` | Selezione tipo seduta GUIDA | Popola seduta + ricalcola posti |
| `returnRefreshTipoSeduta2(val)` | Selezione tipo seduta altri | Popola seduta |
| `returnRefreshTipoSedutaWithNumeroDomande(val)` | Selezione seduta QUIZ | Popola seduta + abilita/disabilita num. domande |

### Funzioni gruppi/autoscuola

| Funzione | Trigger | Descrizione |
|----------|---------|-------------|
| `returnRefreshGruppoEP1/2(val)` | Selezione gruppo | Popola codice gruppo, svuota autoscuola/CIA |
| `returnRefreshAutoscuolaEP1/2(val)` | Selezione autoscuola | Popola codice autoscuola, svuota gruppo/CIA |
| `returnRefreshCIAEP(val)` | Selezione CIA | Popola codice CIA, svuota gruppo/autoscuola |

### AJAX endpoint
```
GET /disponibilitaSessioneEsameEP/Read_viewDataLimitePrenotazione.action
    ?id={data_sessione}&id2={giorni_limite}&codiceUmc={cod_ufficio}
Risposta: stringa data gg/mm/aaaa
```

---

## 25. FLUSSO COMPLETO PRENOTAZIONE CANDIDATO

### Scenario: prenotare candidato a quiz patente

```
1. LOGIN
   POST /SSO/SSOLogin/Login_initAction.action
   [ottieni sessione autenticata]

2. SITUAZIONE CANDIDATI — Cerca gruppi "Da Prenotare"
   GET  /richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH
   POST /richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action
   → indicatoreStatoCandidati=D, indicatoreConseguimentoEsame=P
   → Risultato: lista gruppi con nr. candidati

3. DETTAGLIO CANDIDATI DEL GRUPPO
   POST /richiestaEmissioneDocumentoAbilitazioneEP/ReadSituazioneCandidati_pagingSituazioneCandidati.action
   → (click su riga, poi Dettaglio)
   → Risultato: lista candidati con Marca Operativa, Cognome, Abilitazione

4. SCHEDA CANDIDATO SINGOLO
   POST /prenotazioneCandidatoEP/Read_searchElementDaSituazioneCandidati.action
   → selectRowId = null|null|...|ME|{aula}|{id_cand}|
   → Risultato: dati candidato + bottone "Nuovo" per nuova prenotazione

5. SESSIONI DISPONIBILI PER CANDIDATO
   POST /prenotazioneCandidatoEP/Select_viewNuovaPrenotazione.action
   → (click #buttonPlus)
   → Risultato: lista sessioni disponibili per il tipo esame del candidato

6. SELEZIONE SESSIONE E CONFERMA
   POST /prenotazioneCandidatoEP/Select_viewConfermaPrenotazione.action
   → (selezione sessione + turno + conferma)
   → Risultato: prenotazione confermata, candidato passa a stato "Prenotato"
```

---

## APPENDICE — Dati BLUEFOX S.R.L.

| Dato | Valore |
|------|--------|
| Codice autoscuola | `0674` |
| Ufficio MCTC | `ME` (Messina) |
| Codice esaminatore | `083` |
| Codice località principale | `660` (UP MESSINA - QUIZ PATENTI) |
| Aula principale | `1` |
| Email account | `bluefox.srl@gmail.com` |

### Sessioni attive rilevate (26/03/2026)

| Data | Tipo | Fascia | Candidati BLUEFOX | Note |
|------|------|--------|-------------------|------|
| 26/03/2026 | QUIZ Patente | M | 2 (LIVOI + RUNDO) | APPROVATA |
| 26/03/2026 | QUIZ Patente | P | (verificare) | APPROVATA |
| 30/03/2026 | QUIZ Patente | M | 68 totali | APERTA |
| 02/04/2026 | QUIZ Patente | P | 64 totali | APERTA |
| 02/04/2026 | QUIZ Patente | M | (verificare) | APERTA |
| 03/04/2026 | QUIZ Patente | M | (verificare) | APERTA |
| 09/04/2026 | GUIDA Patente | P | 17 pren. | APERTA |
| 17/04/2026 | GUIDA Patente | M | 7 pren. | APERTA |
| 16/04/2026 | QUIZ CQC | M | 32 pren. | APERTA |

### Candidati Da Prenotare (26/03/2026)
- **Patente:** 35 candidati (A1:8, AM:4, B:21, C:2)

---

*Documento generato da esplorazione sistematica del portale — 26/03/2026*

---

## 26. MANUALI MIT WEBSERVICE — CROSS-REFERENCE CON PORTALE HTML

> **Aggiornato:** 26/03/2026 — Analisi 5 documenti MIT uploadati dall'utente

### 26.1 Riepilogo Documenti Analizzati

| Documento | Utilità | Contenuto chiave |
|-----------|---------|-----------------|
| MIT-EP06 Specifiche WS | **ALTA** | 70+ operazioni WS per prenotazioni, CQC, foglio rosa, rinnovi |
| GRPW Appendice XSD 7.25 | **ALTISSIMA** | 236 tipi complessi, 99 tipi semplici — tutti i campi form |
| Modalità accesso CED DT | Bassa | Conferma necessità SPC/VPN per WS |
| WebServices SIDT | Media | URL ambiente test: `http://e-servizicoll.dtt.ilportaledellautomobilista.it/...` |
| Manuale VPN AnyConnect | Nulla | Non utile per sviluppo gestionale |

### 26.2 URL WebService (Base)

```
https://www.ilportaledellautomobilista.it/PrenotaPatente-ws/services/{nomeServizio}
```

> ⚠️ Non chiamabili direttamente: richiedono VPN SPC / rete intranet MIT.
> **I nomi dei campi WS corrispondono quasi 1:1 ai `name=""` dei form HTML Struts2.**

### 26.3 Operazioni WS — Richiesta Esame

| Operazione WS | Equivalente HTML portale | Note |
|--------------|--------------------------|------|
| `inserimentoRichiestaEsame` | Form prenotazione candidato | 3 varianti pagamento |
| `modificaRichiestaEsame` | Form modifica prenotazione | |
| `ricercaRichiestaEsame` | Tabella ricerca candidati | Output: `DatiRichiestaEsameType[]` |
| `cancellazioneRichiestaEsame` | Pulsante annulla prenotazione | |
| `ricercaFoglioRosaPerPrimaStampa` | Tab foglio rosa | |
| `stampaFoglioRosa` | Pulsante "Stampa" foglio rosa | |
| `ristampaFoglioRosa` | Pulsante "Ristampa" foglio rosa | |

### 26.4 Operazioni WS — CQC

| Operazione WS | Note |
|--------------|------|
| `inserimentoPrenotazioneCQC` | Bollettino / Decurtazione / PagoPA |
| `modificaPrenotazioneCQC` | |
| `ricercaPrenotazioneCQC` | Output: `DettaglioPrenotazioneCQCType[]` |
| `cancellazionePrenotazioneCQC` | |
| `facsimilePrenotazioneCQC` | Anteprima prima del pagamento |
| `inserimentoPrenotazionePatentiCQC` | Patente CQC separata |

### 26.5 Campi XSD → Nomi Campi HTML Portale

#### `IdentificativoRichiestaEsameType` (autenticazione WS = variabili .env)
| Campo XSD | Nome campo .env | Valore BLUEFOX |
|-----------|----------------|----------------|
| `login.codicePin` | `PORTAL_PIN` | da inserire |
| `marcaOperativa` | `CODICE_AUTOSCUOLA` | `0674` |
| `codiceOperatore` | `CODICE_ESAMINATORE` | `083` |
| `uffOperativo` | `PORTAL_UFFICIO_MCTC` | `ME` |

#### `AnagraficaRichiedenteType` (candidato)
| Campo XSD | Tipo | Campo DB (`candidates`) |
|-----------|------|------------------------|
| `cognome` | VarChar(35) required | `cognome` |
| `nome` | VarChar(35) optional | `nome` |
| `dataNascita` | date required | `data_nascita` |
| `codiceFiscale` | Char(16) optional | `codice_fiscale` |
| `sesso` | M/F required | `sesso` |
| `luogoNascita` | LuogoNascitaType required | `comune_nascita` + `provincia_nascita` |
| `foto` | FileType optional | — (non salvato in DB) |
| `firma` | FileType optional | — (non salvato in DB) |

#### `DatiRichiestaEsameType` (richiesta esame)
| Campo XSD | Tipo | Campo DB (`richieste_esame`) |
|-----------|------|------------------------------|
| `marcaOperativa` | String(11) | `marca_operativa` |
| `codiceOperatore` | Char(4) | `codice_operatore` |
| `ufficioOperativo` | Char(2) | `ufficio_operativo` |
| `categoriaRichiesta` | String | `categoria_richiesta` |
| `categoriaDisponibile` | String | `categoria_disponibile` |
| `cambioAutomatico` | S/N | `cambio_automatico` (boolean) |
| `validitaPatenteRichiestaMM` | integer | `validita_mm` |
| `validitaPatenteRichiestaAA` | integer | `validita_aa` |
| `tipologiaPagamento` | BOLLETTINO/DECURTAZIONE/PAGOPA | `tipo_pagamento` |
| `codicePagamento` | String optional | `codice_pagamento` |
| `protocolloRichiesta` | String optional | `protocollo_richiesta` |
| `datiAnagrafici` | AnagraficaRichiedenteType | → FK candidato_id |
| `datiResidenza` | LuogoResidenzaType | → colonne candidato |
| `datiMedici.dataVisitaMedica` | date | `data_visita_medica` |
| `datiMedici.codiceIscrizioneAlboMedici` | String | `codice_medico` |
| `obbligoVisitaCML` | S/N | `obbligo_visita_cml` |
| `esenteVisitaCML` | S/N | `esente_visita_cml` |
| `tempoEstesoProvaTeoria` | S/N | `tempo_esteso_teoria` |

#### `DettaglioPrenotazioneCQCType` (CQC)
| Campo XSD | Campo DB (`richieste_esame`) |
|-----------|------------------------------|
| `datiPatenteCQC.numeroPatenteCQC` | `cqc_numero_patente` (candidates) |
| `datiPatenteCQC.dataRilascio` | — |
| `datiPatenteCQC.dataScadenza` | `data_scadenza_cqc` (candidates) |
| `datiPatenteCQC.categorieAbilitate` | `categoria_richiesta` |
| `datiCorso.tipoCorso` | — (ORDINARIO/CONTINUATIVO) |
| `datiCorso.centroFormazioneCMN` | — |
| `datiCorso.dataInizioCorso` | `data_inizio_corso_cqc` (candidates) |
| `esenteVisitaCML` | `esente_visita_cml` |
| `dataScadenzaCQC` | `data_scadenza_cqc` |

### 26.6 Tipi Pagamento

| Codice | Descrizione | Note |
|--------|-------------|------|
| `BOLLETTINO` | Bollettino postale | Richiede numero bollettino |
| `DECURTAZIONE` | Decurtazione credito | Scala da credito precaricato |
| `PAGOPA` | PagoPA | Pagamento online |

### 26.7 Categorie Patente Supportate
`A1, A2, A, B, BE, C1, C1E, C, CE, D1, D1E, D, DE, AM`
(Fonte: XSD `TipoPatenteType` — `DatiPatenteCQCType.tipoPatente`)

### 26.8 Stati Prenotazione CQC (XSD `StatoPrenotazioneCQCType`)
`ACQUISITA | RIFIUTATA | PAGAMENTO_DA_RIPETERE | IN_ATTESA | ANNULLATA | COMPLETATA`

### 26.9 Sezioni Portale Da Esplorare (prossime sessioni 08:00–21:00)

| Sezione | indicatoreTipoSessione | Stato |
|---------|----------------------|-------|
| Revisione Patente — Verbali aperti | VAC/VSC/VSR/VSRCQCC | ⏳ Da esplorare |
| Messaggi portale | — | ⏳ Da esplorare |
| Sposta da Sessione (Conseguimento) | — | ⏳ Da esplorare |
| Sposta da Verbale (Conseguimento) | — | ⏳ Da esplorare |
| Sessioni Approvate — dettaglio pagina | SQA | ⏳ Da esplorare |
| CQC — colonne extra tabella | SCQCA | ⏳ Da esplorare |
| Form inserimento nuova Richiesta Esame | — | ⏳ Da esplorare |
| Form inserimento Prenotazione CQC | — | ⏳ Da esplorare |

### 26.10 File Riferimento Salvati nel Workspace

| File | Posizione | Contenuto |
|------|-----------|-----------|
| `Portal_Integration_Analysis.txt` | `gestionale/` | 70+ operazioni WS categorizzate |
| `Field_Mapping_Reference.txt` | `gestionale/` | Tabelle complete campi XSD |
| `EXECUTIVE_SUMMARY_WS.txt` | `gestionale/` | Riepilogo esecutivo + checklist |

---

---

## §27 — Analisi Completa iPatenteCloud (Manuale Utente — 28 Capitoli)

### §27.1 — Panoramica
**iPatenteCloud** è un gestionale per autoscuole sviluppato come applicazione Electron (v4.0.0, ~247 MB `app.asar`).  
Sito: https://www.ipatente.cloud | Supporto: 0871252831 | info@ipatente.cloud  
Analisi effettuata il: 2026-03-26 — Tutti i 28 capitoli del manuale utente esaminati.

**Punti di forza identificati:**
- Workflow preventivo → accettazione → pratica
- Distinzione ANAGRAFICA vs SERVIZIO (un cliente può avere più pratiche/servizi)
- 5 ruoli distinti con permessi graduati
- Gestione multi-sede con codici sblocco postazione
- Integrazione WhatsApp nativa via @wppconnect-team
- DCW (Documento Commerciale Web) — ricevute fiscali senza registratore di cassa
- Prenotazione esami automatizzata con anti-captcha
- Lettore CIE (uTrust 3700F, ISO 14443 A-B, codice CAN)

---

### §27.2 — Capitoli Analizzati e Funzionalità

| Cap | Titolo | Funzionalità chiave | Implementata nel nostro gestionale |
|-----|--------|--------------------|------------------------------------|
| Intro | Introduzione | Software completo autoscuole, emissione fiscale senza reg. cassa | Parziale |
| 1 | Installazione | Electron desktop, multi-OS | N/A (web-based) |
| 2 | Configurazione Iniziale | Setup autoscuola, configurazione sede | ✅ `/impostazioni` |
| 3 | Gestione Postazioni | Multi-seat: 6 segreteria + 10 quiz, codice sblocco | Parziale (multi-autoscuola) |
| 4 | Gestione Collaboratori | 5 ruoli: Amm/Dir/Seg/Ins/Istr, colore calendario | ✅ `collaboratori` table + routes |
| 5 | Parco Veicoli | Flotta con targa/colore/scadenze, integrata in calendario guide | ✅ `/veicoli` (NUOVO) |
| 6 | Listino Prezzi | Categorie, IVA, rateizzazione, blocco morosi | ✅ `/listino` (NUOVO) |
| 7 | Orari Lezioni/Visite | Fasce orarie per giorno/tipo configurabili | ✅ `/impostazioni` parziale |
| 8 | Importazione Portale | Import candidati da MIT portale | ✅ `/portale` → `/import` |
| 9 | Gestione Clienti | ANAGRAFICA + SERVIZIO, preventivi workflow | Parziale — ANAGRAFICA ✅ |
| 10 | Regole Pagamenti | Rate, acconto, blocco app quiz morosi | Struttura DB ✅ |
| 11 | Committenti | Terzi (privati/aziende/autoscuole), lookup P.IVA AdE | ✅ `/committenti` (NUOVO) |
| 12 | Calendario Lezioni | Calendarizzazione lezioni teoria (anti-covid) | Parziale — `corsi_sessions` |
| 13 | Calendario Guide | Settimanale/giornaliero, colori istruttore/veicolo | ✅ `/guide` + `/calendar` |
| 14 | Calendario Visite Mediche | Calendario appuntamenti + reminder WhatsApp | DB ✅ `visite_mediche` (NUOVO) |
| 15 | Impegni e Scadenze | Task, promemoria, scadenze con notifiche | ✅ `/impegni` (NUOVO) |
| 16 | Lezioni | Gestione presenze lezioni teoriche | ✅ `corsi_presenze` |
| 17 | Gestione Esami | Anti-captcha, prenotazione massiva, verbali, sessioni MIT | ✅ `/esami` (completato) |
| 18 | Controllo Esercitazioni | Tracking km, esercitazioni per candidato | Parziale — `guide_sessions` |
| 19 | Contabilità | Ricevute RP, DCW (senza reg. cassa), movimenti cassa | Parziale — `pagamenti` |
| 20 | IUV e PagoPA | Carrelli veloci, conto terzi, stato pagamento | DB ✅ campi su `candidates` |
| 21 | Collegare CIE | Lettore NFC uTrust 3700F, CAN code, auto-fill | ✅ `/acquisizione-remota` |
| 22 | Fatture In Cloud | Integrazione Fatture in Cloud | ⬜ Non implementata |
| 23 | iPatente Quiz | SuperQuiz aula, iPatente Meet online | ⬜ Non implementata |
| 24 | Comunicazioni | WhatsApp massivo con template personalizzabili | Parziale — `/moduli` comunicazioni |
| 25 | Come fare per | Guide operative | ⬜ N/A |
| 26 | Appendice e Assistenza | Contatti supporto | N/A |
| 27 | Richiesta VPN | Procedura MIT: ticket su portale automobilista, PDF firmato | ✅ Documentato |
| 28 | WhatsApp | Connessione WhatsApp con iPatente | Parziale — struttura presente |

---

### §27.3 — Procedura Richiesta VPN MIT (Cap 27)

La VPN del MIT è necessaria per la connessione diretta al portale automobilista:

1. Accedere al **Portale dell'Automobilista** con credenziali autoscuola
2. Andare in sezione **ASSISTENZA** → **Apri Ticket**
3. Inserire campi obbligatori
4. Allegare il **PDF compilato e firmato** (scaricabile dal link indicato nel portale)
5. Inviare il ticket
6. Attesa elaborazione: **2-3 giorni lavorativi**
7. Risposta via ticket + copia email fornita in fase di registrazione

**Codice autoscuola BLUEFOX:** `0674` | Ufficio: `ME` (Messina) | Cod. Esaminatore: `083`

---

### §27.4 — Funzionalità da Implementare (Roadmap)

**Priorità Alta:**
- `Preventivi` — Workflow preventivo → accettato → pratica (tabella `preventivi` già creata in DB)
- `Calendario Visite Mediche` — UI calendario per `visite_mediche` table
- `DCW / Contabilità` — Documento Commerciale Web per ricevute senza registratore cassa
- `IUV PagoPA UI` — Interfaccia per generazione carrelli e tracking pagamenti

**Priorità Media:**
- `Comunicazioni WhatsApp` — Template massivi con variabili candidato
- `Controllo Esercitazioni` — Dettaglio km/esercitazioni per pratica
- `Multi-sede` — Gestione più sedi della stessa autoscuola
- `Ruoli collaboratori` — Permessi differenziati per 5 ruoli in session/JWT

**Priorità Bassa:**
- Integrazione Fatture in Cloud
- SuperQuiz / iPatente Meet
- Statistiche avanzate (ore lezioni, km totali flotta, ricavi per categoria)

---

### §27.5 — File Creati in Questa Sessione (2026-03-26)

**Backend:**
| File | Descrizione |
|------|-------------|
| `backend/src/controllers/veicoliController.js` | CRUD parco veicoli |
| `backend/src/controllers/committentiController.js` | CRUD committenti |
| `backend/src/controllers/listinoController.js` | CRUD listino prezzi |
| `backend/src/controllers/impegniController.js` | CRUD impegni e scadenze |
| `backend/src/routes/veicoliRoutes.js` | Route `/api/veicoli` |
| `backend/src/routes/committentiRoutes.js` | Route `/api/committenti` |
| `backend/src/routes/listinoRoutes.js` | Route `/api/listino` |
| `backend/src/routes/impegniRoutes.js` | Route `/api/impegni` |
| `backend/sql/2026-03-26_veicoli_committenti_listino_impegni.sql` | Migration 7 nuove tabelle |

**Frontend:**
| File | Descrizione |
|------|-------------|
| `frontend/app/veicoli/page.js` | Parco Veicoli con scadenze e allerte |
| `frontend/app/listino/page.js` | Listino prezzi raggruppato per categoria |
| `frontend/app/committenti/page.js` | Committenti con card grid + lookup P.IVA |
| `frontend/app/impegni/page.js` | Impegni e scadenze con cambio stato rapido |

**Modificati:**
| File | Modifica |
|------|---------|
| `backend/src/routes/index.js` | Aggiunte 4 nuove route |
| `frontend/app/ModernAppShell.js` | Aggiunte 4 voci navigazione |


---

## §28 — Analisi Sorgente iPatenteCloud (app.asar decompilato — 2026-03-26)

> **Fonte**: `C:\Users\bluef\AppData\Local\iPatenteCloud\app-4.0.0\resources\app.asar`  
> Estratto con parser Python Pickle/ASAR custom. File chiave analizzati:  
> `www/js/portale.js` (2235 righe), `portale_do.js` (1357), `portale_read.js` (4300), `agenzia_entrate.js` (112)

---

### §28.1 — Gestione Captcha

**IMPORTANTE**: iPatenteCloud **NON usa alcun servizio anti-captcha automatizzato**.  
Quando il portale mostra un captcha (`#captcha`), l'app:
1. Ripristina la finestra Electron nascosta (`elektronReader.win.restore()`)
2. Mostra messaggio all'utente: *"Portale dell'automobilista — Richiesta inserimento captcha"*
3. L'operatore risolve manualmente il captcha
4. Il flusso riprende automaticamente dopo la risoluzione

**Implicazione per il nostro gestionale**: anche noi dobbiamo prevedere un meccanismo di fallback manuale quando il portale richiede captcha.

---

### §28.2 — URL Esatti del Portale Automobilista

**Login:**
```
POST https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action
  Param: loginView.gotoRedirect=[REDIRECT]
  Param: loginView.beanUtente.userName=[USR]
  Param: loginView.beanUtente.password=[PWD]
  Param: action:Login_executeLogin=Accedi

  Selettori form:
  username → #LoginFom_loginView_beanUtente_userName
  password → #LoginFom_loginView_beanUtente_password
  button   → #LoginFom_button_value_login
```

**PIN (se richiesto):**
```
  pin    → #LoginForm_loginView_pin
  button → #LoginForm_button_value_confirm
```

**URL redirect dopo login:**
```
https://www.ilportaledellautomobilista.it/web/portale-automobilista/homepage-professionista?init
```

---

### §28.3 — URL Prenotazione Esame (SQI — Teoria)

```
GET https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action
  pageStatus=New
  disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId=[ID_VERBALE]
  disponibilitaSessioneEsameEPView.indicatoreTipoSessione=SQI
  disponibilitaSessioneEsameEPView.visualizzaCaptcha=false
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosa=[COD_FOGLIO_ROSA]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.thePersonaFisica.descrizioneCognomePersonaFisica=[COGNOME]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceLinguaPrenotazioneCandidato=[LINGUA]   (es. IT)
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.supportoAudio=[AUDIO]                        (N oppure S)
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore=[TURNO]                     (1, 2, 3...)
  action:CreateSIP_saveNewElementCandidato=Conferma
```

**Turni**: 
- Mattina: M1, M2, M3, M4, M5, M6
- Pomeriggio: P1, P2, P3, P4, P5, P6
- Nel form numerico: 1=primo turno, 2=secondo, ecc.

---

### §28.4 — URL Prenotazione Esame (SGOS — Guida pratica)

```
GET https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_undoListCandidati.action
  pageStatus=READ
  disponibilitaSessioneEsameEPView.indicatoreTipoSessione=SGOS
  disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId=[ID_VERBALE]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.selectRowId=[ID_VERBALE]
  action:SelectCandidato_viewNewCandidato=Nuovo+Candidato
```

---

### §28.5 — URL Sostituzione Candidato in Sessione

```
POST https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewSostituisciCandidato.action
  struts.token.name=tokenDisponibilitaSessioneEsameEP
  pageStatus=SOSTITUISCI
  action:SostituisciCandidato_sostituisciElementCandidato=Sostituisci
  disponibilitaSessioneEsameEPView.indicatoreTipoSessione=SQI
  disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId=[ID_VERBALE]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codUfficioMCTCMarcaOperativa=[PROV_VECCHIO]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceUnitaContabileMarcaOperativa=[CODMEC_VECCHIO]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.progressivoMarcaOperativa=[NUM_VECCHIO]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosaSostituzioneCandidato=[COD_STATINO_NUOVO]
  disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.descrizioneCognomePersonaFisicaSostituzioneCandidato=[COGNOME_NUOVO]
```

---

### §28.6 — URL Lettura Sessioni (Read)

| Tipo | URL |
|------|-----|
| Sessioni quiz prenotate | `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH` |
| Sessioni quiz approvate | `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH` |
| Allievi prenotati quiz | `https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH` |
| Prenotazione manuale init | `https://www.ilportaledellautomobilista.it/prenotazione/prenotazioneCandidatoEP/Read_initAction.action?pageStatus=SEARCH` |
| Prenotazione programmata | `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH` |

---

### §28.7 — URL Ricerca Richiesta Esame (per Marca Operativa)

```
GET https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/Read_initAction.action
  struts.token.name=tokenSearchRichiestaEsameFrom
  richiestaPerEsameView.richiestaFrom.idAutAg=[CODMEC]          (codice autoscuola, es. 0674)
  richiestaPerEsameView.richiestaFrom.theUfficioMctcOperativo.codiceUffOperativo=[PROV]   (es. ME)
  richiestaPerEsameView.richiestaFrom.marcaOperativa=[MARCAOPERATIVA]
  richiestaPerEsameView.richiestaFrom.theAnagrafica.codiceFiscale=[CODICEFISCALE]
  richiestaPerEsameView.richiestaFrom.indicatoreRicercaEstesa=S    (per ricerca estesa)
  action:Read_paging=Ricerca
```

**Formato Marca Operativa**: `CODMEC(2) + PROV(2) + NUMERO(6)` es. `06ME000123`
- `codUfficioMCTCMarcaOperativa` = primi 2 caratteri
- `codiceUnitaContabileMarcaOperativa` = caratteri 3-4 (provincia)
- `progressivoMarcaOperativa` = caratteri 5+ (numero)

---

### §28.8 — URL Trasmissione Guide (Esercitazioni)

```
Ricerca: https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/Read_initEsercitazioniGuida.action
  Selettori:
  cognome → #Read_initEsercitazioniGuida_richiestaPerEsameView_cognome
  marca   → #Read_initEsercitazioniGuida_richiestaPerEsameView_richiestaFrom_marcaOperativa
  button  → #Read_initEsercitazioniGuida_button_value_searchElement

Nuovo inserimento: POST → Read_initEsercitazioniGuida_button_value_newEsame (button click)
```

---

### §28.9 — DCW / Documento Commerciale Web (Agenzia delle Entrate)

iPatenteCloud apre un **browser separato** (`elektronAE`) e naviga su:

```
Login SPID:  https://spid.sogei.it/SPIDManagerWeb/loginFattureCorrispettivi.html
Home AdE:    https://ivaservizi.agenziaentrate.gov.it/portale/web/guest/home
DCW Home:    https://ivaservizi.agenziaentrate.gov.it/ser/documenticommercialionline/#/home
DCW Wizard:  https://ivaservizi.agenziaentrate.gov.it/ser/documenticommercialionline/#/generazione/wizard2
DCW Esito:   https://ivaservizi.agenziaentrate.gov.it/ser/documenticommercialionline/#/generazione/wizard4
```

Anche qui il processo è **semi-automatico**: apre il browser Electron, l'operatore fa il login SPID, poi l'app naviga al wizard e compila i campi automaticamente.

---

### §28.10 — Dipendenze Chiave (package.json)

| Package | Versione | Scopo |
|---------|----------|-------|
| `@wppconnect-team/wppconnect` | ^1.40.1 | WhatsApp Web integration |
| `electron-edge-js` | ^40.0.1 | .NET/C# bridge (CIE reader) |
| `pcsclite` | ^1.0.1 | Smart card reader (PC/SC) |
| `robotjs` | ^0.6.0 | Input simulation/automazione |
| `mrz` | ^3.3.0 | Parsing MRZ documenti identità |
| `jimp` | ^0.22.12 | Image processing |
| `qrcode` | ^1.5.4 | Generazione QR code |
| `sharp` | ^0.32.6 | Image resize/convert |

---

### §28.11 — File HTML Pagine Principali

| File | Contenuto |
|------|-----------|
| `www/index.html` | Entry point app (Framework7 SPA) |
| `www/incasso_rapido.html` | Schermata incasso rapido / cassa |
| `www/prenotazione_guida.html` | Form prenotazione seduta guida |
| `www/calendario_guide.html` | Calendario guide settimanale |
| `www/fotofirma.html` | Acquisizione foto+firma candidato |
| `www/ipatentemeet.html` | iPatente Meet (lezioni online) |


---

## §29 — Bypass Captcha: Meccanismo Esatto (Scoperto dal Sorgente iPatenteCloud)

### §29.1 — Risposta alla domanda: come lo scavalcano?

Sia **iPatenteCloud** che **GeCA** bypassano il captcha del portale **senza alcun servizio anti-captcha, senza OCR, senza image recognition**. Il meccanismo è semplicissimo:

#### ✅ Parametro Struts2: `visualizzaCaptcha=false`

Il portale dell'automobilista è basato su **Struts2/Java** ed espone questo parametro nelle action di prenotazione. Passando `visualizzaCaptcha=false` nella query string (GET) o nel form body (POST), il server **salta completamente la generazione e validazione del captcha**.

**URL inserimento SQI (dalla riga 164 di `portale.js`):**
```
https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action
  ?pageStatus=New
  &disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId=[ID_VERBALE]
  &disponibilitaSessioneEsameEPView.indicatoreTipoSessione=SQI
  &disponibilitaSessioneEsameEPView.visualizzaCaptcha=false          ← BYPASS
  &disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosa=[FOGLIO_ROSA]
  &disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.thePersonaFisica.descrizioneCognomePersonaFisica=[COGNOME]
  &disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceLinguaPrenotazioneCandidato=[LINGUA]
  &disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.supportoAudio=[AUDIO]
  &disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore=[TURNO]
  &action:CreateSIP_saveNewElementCandidato=Conferma
```

**È una singola GET request** — nessun form submission multiplo, nessun step intermedio. La prenotazione avviene in un unico salto.

---

### §29.2 — Login: perché non c'è captcha

Il captcha appare sulla **home page pubblica** del portale (`/web/portale-automobilista/`). iPatenteCloud **non naviga mai su quella pagina** — va direttamente all'action di login:

```
https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action
  ?loginView.gotoRedirect=[REDIRECT]
  &orgname=
  &loginView.beanUtente.userName=[USR]
  &loginView.beanUtente.password=[PWD]
  &action:Login_executeLogin=Accedi
```

Questa pagina non mostra captcha. Se un captcha appare inaspettatamente, il codice di iPatenteCloud:
1. Se è sulla home page: ricarica il login URL (`elektronReader.open(portale.urlArray["login"])`)
2. Se è altrove: mostra la finestra Electron all'utente per risoluzione manuale (`elektronReader.win.restore()`) — ma questo è il fallback rarissimo

Tutte le chiamate a `f7app.mostraCaptcha(elektronReader)` nel codice sono **commentate out** — non vengono mai eseguite nella versione rilasciata.

---

### §29.3 — Implementazione nel Gestionale Bluefox

I file modificati/aggiunti in questa sessione:

| File | Modifica |
|------|----------|
| `backend/src/connector/booking.js` | Aggiunto `visualizzaCaptcha=false` in `cercaCandidatoInDettaglio` + nuova funzione `prenotazioneDirectUrl()` |
| `backend/src/controllers/portaleController.js` | Nuovo endpoint `prenotazioneDiretta()` |
| `backend/src/routes/portaleRoutes.js` | Route `POST /portal/prenotazione-diretta` |

**Endpoint nuovo:**
```
POST /api/portal/prenotazione-diretta
{
  "idVerbale":        "12345",
  "tipoSessione":     "SQI",
  "codiceFoglioRosa": "06ME000123",
  "cognome":          "ROSSI",
  "turnoEsaminatore": 1,
  "lingua":           "IT",
  "audio":            "N"
}
```

**Turni:** 1=M1, 2=M2, 3=M3, 4=P1, 5=P2, 6=P3 (numerazione portale)

