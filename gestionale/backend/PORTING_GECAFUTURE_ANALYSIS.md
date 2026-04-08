# Porting GeCAFuture -> Gestionale (analisi + stato)

## 0) Nota struttura workspace

- La cartella presente nel repository è `reserse/GeCAFuture` (non `reverse/GeCAFuture`).

## 1) Come funziona il decompilato GeCAFuture

### Entry e orchestrazione

- Entry point WinForms: `reserse/GeCAFuture/GeCA/My/MyApplication.cs`.
- Form/menu principali: `reserse/GeCAFuture/GeCA/frmmenu.cs`, `reserse/GeCAFuture/GeCA/NAVIGATOREnew.cs`, `reserse/GeCAFuture/GeCA/connessioneportalenew.cs`.
- Modulo HTTP principale verso portale: `reserse/GeCAFuture/GeCA/modConnPort.cs`.

### Flusso portale (alto livello)

1. Login SSO (`Login_initAction.action`)
2. Validazione PIN (`DispatcherEntry_executeDispatch` + `Pin_executePinValidation`)
3. Apertura area prenotazioni/sedute (`Read_initActionSessioni*.action?pageStatus=SEARCH`)
4. Lettura dettaglio seduta (`Read_paging.action` / submit form seduta)
5. Azioni candidato su seduta:
   - ricerca/selezione candidato: `Select_listCandidati.action`
   - conferma nuovo candidato: `SelectCandidato_viewNewCandidato.action`
   - modifica candidato: `SelectCandidato_editElementCandidato.action`
   - sostituzione candidato: `SelectCandidato_viewSostituisciCandidato.action`
   - eliminazione candidato: `SelectCandidato_viewDeletingElementCandidato.action`

## 2) Chiamate HTTP al portale trovate in GeCAFuture

(estratte principalmente da `modConnPort.cs` e `NAVIGATOREnew.cs`)

### Autenticazione

- `https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action`
- `https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=...`

### Sessioni/Sedute

- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniGuideOrali.action?pageStatus=SEARCH`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqc.action?pageStatus=SEARCH`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqcApprovate.action?pageStatus=SEARCH`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_paging.action`

### Candidati in seduta

- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewNewCandidato.action`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_editElementCandidato.action`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewSostituisciCandidato.action`
- `https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewDeletingElementCandidato.action`

### Situazione candidati archivio

- `https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH`
- `https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/ReadSituazioneCandidati_pagingSituazioneCandidati.action`
- `https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/SelectSituazioneCandidati_viewElementSituazioneCandidati.action`

## 3) Cosa era già nel gestionale

- Login/PIN + contesto prenotazione HTTP in `gestionale/backend/src/connector/portalHttp.js`
- Flusso browser/manuale sedute in `gestionale/backend/src/connector/portalSession.js`
- Import archivio candidati in `gestionale/backend/src/connector/importByPatente.js`
- Step base prenotazione seduta in `gestionale/backend/src/connector/booking.js`

## 4) Porting implementato in questa attività

### 4.1 Nuova logica GeCA-like in booking connector

File aggiornato: `gestionale/backend/src/connector/booking.js`

Aggiunte funzioni:

- `cercaCandidatoInDettaglio(...)`
- `confermaNuovoCandidato(...)`
- `modificaCandidatoPrenotazione(...)`
- `eliminaCandidatoPrenotazione(...)`
- `sostituisciCandidatoPrenotazione(...)`

Supporto aggiunto:

- parsing stato form dettaglio (hidden/select/textarea)
- ricostruzione payload e submit HTTP `application/x-www-form-urlencoded`
- supporto campi GeCA (`codiceFoglioRosa`, `turnoEsaminatore`, `codiceLingua`, `supportoAudio`, `codiceTipoPagamento`, `indicatoreTipoEsamePrenotato` + `fields` custom)

### 4.2 Nuovo endpoint backend per orchestrare azioni candidato

File aggiornato: `gestionale/backend/src/server.js`

Nuovo endpoint:

- `POST /api/portal/prenotazione-candidato`

Flusso endpoint:

1. login portale con credenziali tenant
2. apertura sedute (`readSessioniQuizInterne`)
3. selezione seduta (`sessionIndex`)
4. apertura dettaglio seduta (`prenotaSessione`)
5. esecuzione azione (`search|new|edit|delete|replace`)

Output endpoint:

- indicatori esito (`containsSuccess`, `containsAlreadyBooked`, `containsNoSeats`)
- `portalMessage`
- `trace` opzionale

## 5) Gap residui per equivalenza 1:1 completa

Per una replica completa del software decompilato mancano ancora alcune parti avanzate:

- strategie retry/multi-turno in automatico identiche a GeCA (switch turno con fallback esteso)
- gestione completa stati UI/feedback granulari GeCA (messaggistica fine per ogni casistica)
- copertura intera di varianti sessioni (GUIDA/CQC/APPROVATE) in tutti i branch server/API
- eventuale porting di moduli non prenotazione (pagamenti, scanner, altri WS) se richiesti

## 6) Prossimo step consigliato

- Agganciare il nuovo endpoint `POST /api/portal/prenotazione-candidato` alla UI del gestionale (azioni riga candidato: cerca/nuovo/modifica/sostituisci/elimina), così il flusso diventa operativo end-to-end nel frontend.
