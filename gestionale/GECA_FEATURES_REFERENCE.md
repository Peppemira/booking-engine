# Riferimento funzioni GeCA Future → Gestionale

Documento per non dimenticare nessuna funzione del software GeCA Future quando si implementa il gestionale autoscuola.
Fonte: analisi di `reserse/GeCAFuture/GeCA/*.cs`.

---

## 1. Login e avvio

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **login** | Login utente | ✅ `app/login/page.js` |
| **frmsplash** | Splash screen | Opzionale |
| **firstAcco** | Primo accesso / attivazione | Opzionale |
| **licenza** | Attivazione licenza | Opzionale |
| **CONFIG** | Configurazione generale Ge.C.A. | ✅ Impostazioni |

---

## 2. Anagrafica / Candidati

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **anagrafe** | Gestione anagrafica (eleIscritti = griglia iscritti), modifica, ricerca | ✅ Candidati → link Anagrafica iscrizioni |
| **nuovaiscr** | Registra nuova iscrizione | ✅ Modal "Nuova Iscrizione" in Candidati |
| **dettaglio** | Dettaglio richiesta/candidato | ✅ Anagrafica-Iscrizioni (pannello dettaglio) |
| **dettaglioPPG** | Dettaglio permesso provvisorio di guida | ✅ Pratiche → Foglio Rosa sezione |
| **frmRiepilogo** | Scheda riepilogativa candidato | ✅ Pulsante "📋 Scheda" in Candidati (modal 5-tab) |
| **frmOmoni** | Presenze in archivio (omonimi) | Da fare (ricerca omonimi) |
| **frmpatenti** | Gestione patenti rilasciate | ✅ Fogli Rosa & Patenti |
| **frmstatini** | Gestione fogli rosa | ✅ Fogli Rosa & Patenti |
| **gestPatA** | Gestione fogli presenze A2/A | ✅ Guide → tipo A2A + guideSessioni |
| **VisNote** | Note sul candidato | ✅ Campo note in Anagrafica |
| **grigliaRicerca** | Risultati ricerca | ✅ Filtri avanzati in Candidati |
| **datiautos** | Gestione dati autoscuole | ✅ Impostazioni |
| **frmautosc** | Dati autoscuola | ✅ Impostazioni |
| **Datiint** | Gestione operatori | Impostazioni → Utenti |
| **riccomuni** | Località e province | Lookup/Impostazioni |
| **datifisc** | Dati fiscali | ✅ Dettaglio candidato |

---

## 3. Pratiche / Iscrizioni (per tipo)

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **iscrEsame** | Conseguimento per esame | ✅ Pratiche |
| **iscrCerMed** | Richieste certificato medico | ✅ Pratiche |
| **iscrNaut** | Patente nautica | ✅ Pratiche |
| **iscrdup** | Rilascio per duplicato | ✅ Pratiche |
| **iscrPATCQC** | Richiesta patente C.Q.C. | ✅ Pratiche |
| **iscrRinnovo** | Richieste rinnovo patente | ✅ Pratiche |
| **iscrGUIACC** | Guida accompagnata | ✅ Pratiche |
| **iscrAltro** | Nuova iscrizione (altro) | ✅ Pratiche |
| **iscrCorso** | Corso | ✅ Pratiche / Corsi |
| **Trasmiss** | Trasmissione pratiche | Da fare (portale MIT/CED) |

---

## 4. Esami

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **gestesame** | Gestione esami – elenco sedute | ✅ Esami |
| **preTeoria** | Nuova prenotazione esame teoria | ✅ Esami |
| **preGuida** | Nuova prenotazione esame guida | ✅ Esami |
| **NAVIGATOREnew** | Gestione prenotazione esami – Portale Automobilista | ✅ Radar Sedute |
| **resocesami** | Resoconto esami svolti | ✅ Statistiche → tab Esami |
| **esamican** | Riepilogo esami per candidato | ✅ frmRiepilogo modal → tab Esami |
| **candprep** | Candidati prenotabili esami | ✅ Lista attesa |
| **creaelenchi** | Gestione elenchi prenotazione automatica | ✅ Radar |
| **LoginMedico** | Credenziali medico | ✅ Impostazioni |

---

## 5. Guide / Planning / Sedute (lezioni guida)

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **newguide** | Planning guide – calendario sedute guide | ✅ Guide → tab Sedute (guide_sessions) |
| **menuGuide** | Menu gestione guide | ✅ Guide |
| **conguist** | Conteggio guide istruttore | ✅ Guide → `GET /api/guide/conteggio?istruttore=X` |
| **newcontguiall** | Conteggio guide allievo | ✅ Guide → KPI per candidato |
| **guiobb** | Gestione guide certificate | ✅ Guide → tipo "obbligatoria/certificata" |
| **newConfGuide** | Parametri esercitazioni guide | Impostazioni (futuro) |
| **valutazioni** | Valutazioni capacità candidato | ✅ Guide → campo valutazione ★ (1-5) |

---

## 6. Corsi

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **menuCorsi** | Menu gestione corsi | ✅ Corsi |
| **GeCorsi** | Gestione corsi (ADR, CQC, recupero punti) | ✅ Corsi → tab Iscrizioni (corsi_sessions) |
| **auleLezioni** | Calendario lezioni | ✅ Corsi → tab Presenze (corsi_presenze) |
| **gestAule** | Gestione aule e prenotazioni | ✅ Corsi → campo sede_corso |
| **PRESENZECORSI** | Presenze corsi | ✅ Corsi → tab Presenze con registro per lezione |

---

## 7. Documenti / Fatture / Stampe

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **elenchifattvb** | Fatturazione elettronica | ✅ Documenti |
| **newfatturaz** | Nuova fatturazione | ✅ Documenti |
| **arubafattura** | Creazione nuovo documento | ✅ Documenti |
| **showfatt** | Visualizzatore documento | ✅ Documenti |
| **ricevutaFE** | Dettagli ricevuta | ✅ Documenti |
| **gesModellie** | Gestione modelli fatture | Impostazioni |
| **Stampe** | Stampe Ge.C.A. | Da fare (stampe specifiche) |
| **digitaliz** | Digitalizzazioni | ✅ Scanner service |
| **VisRegistro** | Numerazione registro iscrizioni | Da fare |

---

## 8. Pagamenti / Cassa

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **cassa** | Cassa telematica – documento | ✅ Pagamenti (CRUD completo) |
| **resocon** | Resoconto incasso giornaliero | ✅ Pagamenti → pulsante "📊 Resoconto" |
| **accontinew** | Gestione acconti | ✅ Pagamenti (importo parziale + decurtazione) |
| **listino** | Gestione prezziari | Impostazioni (futuro) |
| **pagoPA** | Portale Trasporto / pagoPA | ✅ Tipo pagamento "pagoPA" |
| **satispay** | IUV / Satispay | ✅ Tipo pagamento "satispay" |
| **salpapo** | Saldo crediti pagoPA | Da fare |
| **dettcrediti** | Dettaglio crediti | Da fare |
| **ricercacreditinew** | Ricerca crediti | Da fare |

---

## 9. Lista attesa / Radar

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| (nessun form dedicato) | Coda prenotazioni | ✅ Lista attesa (waitlist) |
| **creaelenchi** | Elenchi per prenotazione automatica | ✅ Radar + backend queue |
| **NAVIGATOREnew** | Sedute portale, prenotazioni | ✅ Radar Sedute |

---

## 10. Statistiche / Resoconti

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **conteggi** | Resoconto iscrizioni (conteggi) | ✅ Statistiche → tab Iscrizioni |
| **resocesami** | Resoconto esami | ✅ Statistiche → tab Esami |
| **resocon** | Resoconto incasso | ✅ Statistiche → tab Incassi + Pagamenti → Resoconto |
| **newschecont** | Riepilogo scheda contabile | ✅ Statistiche → tab Scheda contabile |

---

## 11. Impostazioni / Config / Strumenti

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **CONFIG** | Configurazione Ge.C.A. | ✅ Impostazioni |
| **configini** | Sincronizza dati autoscuola | ✅ Impostazioni |
| **newConfGuide** | Parametri guide | Da fare (Impostazioni) |
| **ConfPrezzi** | Prezzi | Da fare (Impostazioni) |
| **gestScontrini** | Scontrini | Da fare |
| **gesModellie** | Modelli fatture | Da fare |
| **MENUSTRUMENTI** | Conteggi, archivi, aule, crono, stampe, scadenze | ✅ Strumenti Utili (4 tab completi) |
| **dettEvidenza** | Scadenze/eventi in evidenza | ✅ Dashboard → Scadenze imminenti + Incasso oggi |
| **creaarchivio** | Archivio patenti | ✅ Strumenti Utili → tab Archivio patenti |
| **creascadenze** | Elenchi scadenze patenti | ✅ Strumenti Utili → tab Scadenze |
| **crono** | Cronologia operazioni | ✅ Strumenti Utili → tab Crono |

---

## 12. Portale / Sync / Online

| GeCA | Descrizione | Nel nostro gestionale |
|------|-------------|------------------------|
| **connessioneportalenew** | Login/sync Portale Automobilista | ✅ Backend portalSession + Impostazioni |
| **Portale** | Recupero dati utenti patentati | ✅ Backend |
| **BROWSER** | Browser Portale Automobilista | Opzionale |
| **menuonline** | Servizi C.E.D. | ✅ Servizi Online |
| **rinnovabilita** | Verifica rinnovabilità patente | ✅ Servizi Online → Rinnovo Patente |
| **sistArchivi** | Sincronizzazione archivi | ✅ Sync backend |

---

## 13. Funzioni ancora da implementare

| Funzione | Priorità | Note |
|----------|----------|-------|
| `Trasmiss` | Alta | Trasmissione pratiche a CED/MIT tramite portale |
| `ConfPrezzi` / listino | Media | Listino prezzi servizi per autoscuola |
| `gestScontrini` | Bassa | Scontrini precompilati |
| `gesModellie` | Bassa | Modelli fatture personalizzati |
| `frmOmoni` | Bassa | Ricerca omonimi candidati |
| `VisRegistro` | Bassa | Numerazione registro iscrizioni |
| `salpapo` / `dettcrediti` | Bassa | Saldo/dettaglio crediti pagoPA |

---

## 14. Checklist voci menu gestionale (stato)

- ✅ **Dashboard** – KPI, scadenze in evidenza, incasso giorno, accessi rapidi
- ✅ **Candidati** – Anagrafica, nuova iscrizione, dettaglio, note, fogli rosa/patenti
- ✅ **Pratiche** – Tipi: esame, cert. medico, duplicato, CQC, rinnovo, guida acc., corso, altro
- ✅ **Esami** – Sedute, prenotazione teoria/guida, resoconti, candidati prenotabili
- ✅ **Lista Attesa** – Coda esami, priorità, elenchi prenotazione automatica
- ✅ **Radar Sedute** – Implementato con Telegram + auto-booking
- ✅ **Guide** – Planning guide, conteggio guide istruttore/allievo, guide certificate, valutazioni ★
- ✅ **Corsi** – Gestione corsi (ADR, CQC, recupero punti), presenze per lezione, CQC portale
- ✅ **Pagamenti** – Cassa, acconti, resoconto giornaliero, resoconti
- ✅ **Documenti** – Fatture, ricevute, digitalizzazioni
- ✅ **Statistiche** – Conteggi iscrizioni, esami, incassi, grafici, scheda contabile
- ✅ **Strumenti Utili** – Scadenze, crono, archivio patenti, export CSV
- ✅ **Impostazioni** – Credenziali portale, Telegram, orari radar, autoscuola, utenti

---

*Ultimo aggiornamento: 2026-03-25 – Sessione di sviluppo completa.*
