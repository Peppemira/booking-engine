# UX Audit — Sidebar e Information Architecture del Gestionale

Data: 2026-04-17
Scope: solo lettura. Nessun file di codice modificato.
File analizzato per la sidebar: `C:\Users\bluef\booking-engine\gestionale\frontend\app\ModernAppShell.js`
Routes scansionate: `C:\Users\bluef\booking-engine\gestionale\frontend\app\*\page.js`

---

## 1. Sidebar attuale

Estratta dall'array `NAV_ITEMS` in `ModernAppShell.js` (linee 6-40), nell'ordine in cui appare visivamente:

| # | Label | Route | Icona | Note |
|---|-------|-------|-------|------|
| 1 | Dashboard | `/` | ⌂ | KPI + scadenze in evidenza |
| 2 | Prenotazioni e Radar | `/prenotazioni` | 📡 | Hub sedute / radar / lista attesa |
| 3 | Portale Automobilista | `/portale` | 🌐 | Lettura sessioni quiz/guide/CQC, verbali, archivio |
| 4 | Portale - Funzioni | `/portale/funzioni` | 🗂️ | Hub catalogo funzioni mappate (3 tiles macro-categorie) |
| 5 | Anagrafica ed Iscrizioni | `/anagrafica-iscrizioni` | 👤 | Wizard nuova iscrizione + lista candidati GeCA-style |
| 6 | Pratiche | `/pratiche` | 📂 | Lista pratiche per tipo/stato (CONSEGUIMENTO / RINNOVO / CQC...) |
| 7 | Trasmissioni CED | `/trasmiss` | 📤 | Stati invio CED (pronto, da_trasmettere, trasmesso, approvato, respinto, sospeso) |
| 8 | Trasmissione Portale | `/trasmissione-portale` | 🏛️ | Wizard invio pratiche al portale via Puppeteer |
| 9 | Lettura Portale | `/portal-sync` | 🌐 | Dashboard lettura punti, esami, rinnovi, ricevute |
| 10 | Sessioni Esame | `/sessioni-esame` | 📅 | Generazione SQI/SGOS (lingue, tipo) |
| 11 | Fogli Rosa e Patenti | `/fogli-rosa-patenti` | 📄 | Ristampa one-click foglio rosa via portale |
| 12 | Esami | `/esami` | 📅 | Lista esami per stato (prenotato, in_attesa, superato...) |
| 13 | Richieste Esame | `/richieste-esame` | 📝 | Lista richieste + storico pagamenti (PagoPA / decurtazione / ritenta) |
| 14 | Moduli | `/moduli` | 📋 | Tabs: TT2112, Scheda Candidato, Comunicazione, Foglio Rosa |
| 15 | Guide | `/guide` | 🚗 | Lista guide pratiche per stato |
| 16 | Corsi | `/corsi` | 📚 | CQC / ADR / Recupero Punti / altro |
| 17 | Pagamenti | `/pagamenti` | 💰 | Movimenti per metodo (contanti, pagoPA, satispay, POS, scontrino) ed esito |
| 18 | Documenti | `/documenti` | 📁 | Upload/elenco documenti candidato (CI, patente, foto, foglio rosa…) |
| 19 | Statistiche | `/statistiche` | 📈 | Tabs: Grafici, Iscrizioni, Esami, Incassi, Scheda contabile |
| 20 | Servizi on line | `/servizi-online` | 🌐 | Hub card "Servizi On Line C.E.D." (Import, Punti, Portale, Rinnovabilità, Cambio codice, CQC…) |
| 21 | Calendario | `/calendar` | 🗓 | Calendario eventi (guida, lezione, esame, scadenza, appuntamento, Google Cal) |
| 22 | Punti patente | `/punti-patente` | 🪪 | Saldo punti per CF / numero patente |
| 23 | Parco Veicoli | `/veicoli` | 🚘 | CRUD flotta (auto/moto/camion) |
| 24 | Listino Prezzi | `/listino` | 💶 | Servizi + IVA + rateizzazione |
| 25 | Committenti | `/committenti` | 🏢 | Soggetti terzi (privato/azienda/autoscuola) |
| 26 | Impegni e Scadenze | `/impegni` | 📌 | Task / promemoria / appuntamento / scadenza / visita / esame / corso |
| 27 | Visite Mediche | `/visite-mediche` | 🩺 | Prenotazione/monitoraggio visite mediche candidati |
| 28 | Scadenze Mediche | `/scadenze-mediche` | ⏳ | Tabella TT2112 in scadenza (filtri finestra/categoria, export CSV) |
| 29 | Preventivi | `/preventivi` | 📝 | CRUD preventivi con voci, IVA, workflow |
| 30 | Strumenti Utili | `/strumenti-utili` | 🔧 | Tabs: Scadenze, Crono, Archivio patenti, Export, Lookup Marca |
| 31 | Impostazioni | `/impostazioni` | ⚙️ | Config autoscuola |

Totale voci visibili al primo livello: **31**. Tutte renderizzate in un unico stack verticale con scroll. Nessun raggruppamento logico, nessuna sezione collassabile.

---

## 2. Routes esistenti (mappa completa)

Ricavata da `ls gestionale/frontend/app/` e dalla lettura delle prime 30-50 righe di ciascun `page.js`.

| Route | Cosa fa | Linkata da menu? | Note |
|-------|---------|------------------|------|
| `/` | Dashboard KPI + scadenze | sì | "Dashboard" |
| `/acquisizione-remota` | Wizard remoto fototessera/firma/documenti per candidato (uso da link diretto, es. tablet) | **NO** | Orfana — usata via deep-link inviato al candidato |
| `/anagrafica-iscrizioni` | Lista candidati + wizard nuova iscrizione | sì | "Anagrafica ed Iscrizioni" |
| `/archivio-portale` | Sync storico portale (rinnovi/medici/CQC) con SSE progress | **NO** | Orfana dal menu — accessibile solo via URL diretto |
| `/calendar` | Calendario eventi multi-tipo | sì | "Calendario" |
| `/candidati` | Quasi-clone di `/anagrafica-iscrizioni` (stessa logica candidati GeCA) | **NO** | Orfana — duplicazione storica |
| `/committenti` | CRUD committenti | sì | "Committenti" |
| `/corsi` | CRUD corsi (CQC/ADR/RP) | sì | "Corsi" |
| `/documenti` | Documenti candidati | sì | "Documenti" |
| `/esami` | Lista esami per stato | sì | "Esami" |
| `/fogli-rosa-patenti` | Ristampa foglio rosa via portale | sì | "Fogli Rosa e Patenti" |
| `/guida-accompagnata` | Foglio rosa AA (validazione vincoli età) | **NO** | Orfana — non in menu |
| `/guide` | Lista guide pratiche | sì | "Guide" |
| `/impegni` | Task/promemoria/scadenze | sì | "Impegni e Scadenze" |
| `/import` | Ricerca CED + import candidati | **NO** (solo da `/servizi-online`) | Linkata indirettamente |
| `/impostazioni` | Configurazione | sì | "Impostazioni" |
| `/istruttori` | CRUD istruttori (qualifiche, orari) | **NO** | Orfana dal menu |
| `/lista-attesa` | **Redirect** → `/prenotazioni` | **NO** | Stub di compatibilità (vedi §3) |
| `/listino` | Listino prezzi servizi | sì | "Listino Prezzi" |
| `/login`, `/register`, `/recupera-password` | Auth | n/a | – |
| `/moduli` | Stampa moduli (TT2112, scheda, comunicazione, FR) | sì | "Moduli" |
| `/notifiche` | Invio notifiche candidati (singole/bulk + storico) | **NO** | Orfana dal menu |
| `/operatori` | CRUD operatori per sede (admin/operatore/segreteria/istruttore) | **NO** | Orfana dal menu |
| `/pagamenti` | Movimenti pagamento | sì | "Pagamenti" |
| `/portal-sync` | Lettura dati portale (Punti 7-14) | sì | "Lettura Portale" |
| `/portale` | Hub sessioni/verbali/archivio storico portale | sì | "Portale Automobilista" |
| `/portale/funzioni` | Catalogo macro-categorie funzioni portale | sì | "Portale - Funzioni" |
| `/portale/funzioni/[categoria]/[funzione]` | Dettaglio dinamico funzione | n/a | sub-route |
| `/pratiche` | Lista pratiche per tipo/stato | sì | "Pratiche" |
| `/prenotazioni` | Hub prenotazioni esame + Sniper + Lista attesa + Radar | sì | "Prenotazioni e Radar" |
| `/preventivi` | CRUD preventivi | sì | "Preventivi" |
| `/punti-patente` | Saldo punti | sì | "Punti patente" |
| `/radar` | **Redirect** → `/prenotazioni` | **NO** | Stub (vedi §3) |
| `/rendiconto` | Cassa giornaliera | **NO** | Orfana dal menu |
| `/richieste-esame` | Richieste + storico pagamenti CED (PagoPA, decurt., ritenta) | sì | "Richieste Esame" |
| `/scadenze-mediche` | Tabella TT2112 in scadenza | sì | "Scadenze Mediche" |
| `/servizi-online` | Hub card "Servizi On Line C.E.D." | sì | "Servizi on line" |
| `/sessioni-esame` | Generazione sessioni SQI/SGOS lato GeCA | sì | "Sessioni Esame" |
| `/statistiche` | Dashboard stats + scheda contabile | sì | "Statistiche" |
| `/strumenti-utili` | 5 tabs disomogenei (Scadenze/Crono/Archivio/Export/Lookup) | sì | "Strumenti Utili" |
| `/trasmiss` | Stati invio CED | sì | "Trasmissioni CED" |
| `/trasmissione-portale` | Wizard Puppeteer invio portale | sì | "Trasmissione Portale" |
| `/veicoli` | Parco veicoli | sì | "Parco Veicoli" |
| `/visite-mediche` | Prenotazioni visite | sì | "Visite Mediche" |

**Pagine orfane (nel filesystem ma non linkate dal menu):**
`acquisizione-remota`, `archivio-portale`, `candidati`, `guida-accompagnata`, `istruttori`, `notifiche`, `operatori`, `rendiconto`. (`import` è linkata solo via `/servizi-online`; `lista-attesa` e `radar` sono redirect.)

---

## 3. Duplicazioni rilevate

### 3.1 Trasmissioni — 4 voci sovrapposte
- **`/trasmiss`** (label "Trasmissioni CED") — gestione stati invio al CED.
- **`/trasmissione-portale`** (label "Trasmissione Portale") — wizard Puppeteer per il Portale Automobilista.
- **`/portal-sync`** (label "Lettura Portale") — dashboard di **lettura** dati dal portale.
- **`/portale`** (label "Portale Automobilista") — anch'essa **lettura** + verbali + archivio storico.

Confusione: tre voci diverse usano l'icona 🌐 ("Portale Automobilista", "Lettura Portale", "Servizi on line"); l'utente non sa se cliccare 🏛️ o 🌐 per "trasmettere", e non distingue "Lettura Portale" da "Portale Automobilista".

**Raccomandazione:**
- Unire **`/portale`** + **`/portal-sync`** sotto un'unica voce "Portale → Lettura". Le due pagine già condividono ambito (lettura). `/portal-sync` ha 8 sezioni (Punti 7-14), `/portale` ha sessioni/verbali/archivio: diventano due tab della stessa schermata.
- Tenere **`/trasmiss`** (CED interno) e **`/trasmissione-portale`** (portale esterno) ma raggrupparle sotto sezione "Trasmissioni" (collassabile) con label chiare: "→ CED (GeCA)" e "→ Portale Automobilista".
- **`/portale/funzioni`** è solo un catalogo navigazionale: spostarlo come tab dentro "Portale" o collegarlo dalla pagina `/portale` come "Esplora funzioni" (non merita una voce di primo livello da sola).

### 3.2 Esami — 4 voci sovrapposte
- **`/sessioni-esame`** — generazione lato GeCA (SQI/SGOS).
- **`/esami`** — lista esami per stato.
- **`/richieste-esame`** — richieste + storico pagamenti CED.
- **`/prenotazioni`** — sniper + lista attesa + radar (prenotazione su sedute portale).

Tre routes hanno la stessa icona 📅 (sessioni-esame ed esami) o 📝 (richieste-esame). L'utente legge "Sessioni Esame" + "Esami" + "Richieste Esame" + "Prenotazioni e Radar" e non sa quale contiene cosa.

**Raccomandazione:**
- Sezione collassabile "Esami" con sottovoci: **Sessioni** (`/sessioni-esame`) | **Prenotazioni & Radar** (`/prenotazioni`) | **Richieste & Pagamenti** (`/richieste-esame`) | **Storico esami** (`/esami`).
- Eliminare le voci di primo livello, mantenere le route.
- Considerare di unire `/esami` (lista per stato) come tab della pagina `/richieste-esame` se la sovrapposizione dati è significativa.

### 3.3 Anagrafica candidati — duplicazione hard
- **`/anagrafica-iscrizioni`** — pagina principale (linkata).
- **`/candidati`** — pagina alternativa quasi identica (stesse `TIPO_ISCRIZIONE_FILTER_OPTIONS`, stesse import da `candidatoEditor`), **non** linkata.

**Raccomandazione:** confermare che `/candidati` è dead code; se sì, rimuoverla in un cleanup separato (la rimozione effettiva è una migrazione, non un quick win — vedi §7).

### 3.4 Visite e scadenze mediche — sovrapposizione semantica
- **`/visite-mediche`** — prenotazione e monitoraggio visite.
- **`/scadenze-mediche`** — TT2112 in scadenza.
- **`/impegni`** — include tipo "visita_medica" tra le scadenze generali.

L'utente con tre voci vicine ("Visite Mediche" / "Scadenze Mediche" / "Impegni e Scadenze") non sa dove cercare un rinnovo medico in scadenza.

**Raccomandazione:**
- Mantenere `/visite-mediche` come **operativa** (prenotazione/agenda).
- Spostare `/scadenze-mediche` come **tab** dentro `/visite-mediche` (es. tab "In scadenza" vs "Agenda visite").
- `/impegni` rimane il contenitore generico per task/promemoria; togliere "scadenza medica" dal suo tipo se l'utente dovrebbe usare `/visite-mediche` per quello (oppure documentare chiaramente la distinzione).

### 3.5 Pagamenti vs Rendiconto
- **`/pagamenti`** — registro completo movimenti (linkata).
- **`/rendiconto`** — cassa giornaliera con stampa (orfana dal menu).

`/rendiconto` è una **vista derivata** di `/pagamenti` (dati di un giorno + stampa). Oggi è raggiungibile solo via URL.

**Raccomandazione:** integrare "Rendiconto cassa giornaliero" come **tab** o pulsante "Stampa cassa di oggi" dentro `/pagamenti`. Eliminare la pagina standalone.

### 3.6 Documenti vs Moduli
- **`/documenti`** — documenti **caricati** (CI, patente, foto, FR…).
- **`/moduli`** — **stampa** modulistica (TT2112, scheda, comunicazione, FR).

Distinzione semantica reale (input vs output) ma label confusa: "Moduli" può sembrare un sottoinsieme di "Documenti".

**Raccomandazione:** rinominare:
- "Documenti" → "Documenti candidato"
- "Moduli" → "Stampa moduli" (oppure spostarlo come azione dentro la scheda candidato)

### 3.7 Time management — 5 voci che si sovrappongono
- **`/calendar`** — calendario multi-tipo (guida, lezione, esame, scadenza, appuntamento, Google).
- **`/impegni`** — task/promemoria con stessi 7 tipi (scadenza, appuntamento, promemoria, task, visita, esame, corso).
- **`/prenotazioni`** — sedute esame.
- **`/lista-attesa`** + **`/radar`** — redirect → `/prenotazioni`.
- **`/scadenze-mediche`** + tab "Scadenze" dentro **`/strumenti-utili`** — duplicano viste scadenze.

`/calendar` e `/impegni` hanno overlap quasi totale di tipologie. Le redirect-page `/lista-attesa` e `/radar` sono debito tecnico.

**Raccomandazione:**
- Unire `/calendar` (visualizzazione) e `/impegni` (gestione) nella stessa sezione "Agenda" con due tab: **Calendario** e **Lista impegni**.
- Eliminare `/lista-attesa` e `/radar` (file redirect): tenere solo `/prenotazioni`.
- Tab "Scadenze" di `/strumenti-utili` va spostata in Dashboard o in "Agenda → Scadenze".

### 3.8 "Servizi on line" è un secondo menu
La pagina `/servizi-online` è di fatto **una sidebar parallela**: contiene card per Import (`/import`), Punti patente (`/punti-patente`), portale esterno, rinnovabilità, cambio codice, verifica CQC, ecc. Alcune di queste funzioni sono **già voci della sidebar principale** (Punti patente). Confonde perché duplica accessi.

**Raccomandazione:** dichiarare `/servizi-online` come **hub mono-funzione** ("operazioni puntuali Portale/CED che non hanno una pagina dedicata") e rimuovere dalla sidebar le voci che esistono già anche lì (es. "Punti patente" può vivere dentro questo hub e non in primo livello — è una funzione di consultazione occasionale, non un workflow ricorrente).

### 3.9 "Strumenti Utili" è un sacco della spazzatura
5 tab disomogenei: Scadenze, Crono, Archivio patenti, Export dati, Lookup Marca. Non c'è coerenza semantica. Ognuno appartiene logicamente a un'altra sezione.

**Raccomandazione:** smontarlo:
- Scadenze → Dashboard / Agenda
- Crono → Storico sotto candidato o sotto Statistiche
- Archivio patenti → unire con `/archivio-portale` sotto "Portale → Archivio storico"
- Export dati → menu "Esporta" globale (azione, non sezione) o in Statistiche
- Lookup Marca → in Pratiche (filtro avanzato)

### 3.10 Pratiche vs Fogli Rosa e Patenti
- **`/pratiche`** ha tipo `ESAME`, `RINNOVO`, `CERTIFICATO_MEDICO`, `DUPLICATO`, `CQC`, `GUIDA_ACCOMPAGNATA`, `NAUTICA`, `CORSO`.
- **`/fogli-rosa-patenti`** è una sezione "candidati con foglio rosa già emesso" + ristampa via portale.

Funzionalmente `/fogli-rosa-patenti` è una **vista filtrata** di `/pratiche` (sottoinsieme: pratiche con FR emesso) + un'azione (ristampa). Non merita una voce di primo livello.

**Raccomandazione:** trasformare `/fogli-rosa-patenti` in un **filtro/tab** dentro `/pratiche`, con il pulsante "Ristampa FR" come azione di riga.

---

## 4. Label da rinominare

| Vecchio | Nuovo proposto | Ragione |
|---------|----------------|---------|
| Strumenti Utili | (eliminare — splittare contenuti) | Catch-all senza identità; vedi §3.9 |
| Servizi on line | Servizi C.E.D. portale | "On line" non distingue dal resto (tutto è online); va legato esplicitamente a CED/portale |
| Lettura Portale | Portale → Lettura dati | Oggi indistinguibile da "Portale Automobilista"; va annidata sotto "Portale" |
| Portale Automobilista | Portale → Sessioni & Verbali | Specificare cosa contiene (sessioni quiz/guide, verbali, archivio) |
| Portale - Funzioni | Portale → Esplora funzioni | Diventa una tab/link interno, non una voce di primo livello |
| Trasmissioni CED | Trasmissioni → CED (GeCA) | Annidata + qualificata |
| Trasmissione Portale | Trasmissioni → Portale | Annidata + plurale coerente con "Trasmissioni" |
| Prenotazioni e Radar | Esami → Prenotazioni & Radar | Annidata sotto "Esami" (vedi §3.2) |
| Sessioni Esame | Esami → Sessioni | Annidata sotto "Esami" |
| Richieste Esame | Esami → Richieste & Pagamenti | Esplicita la presenza dello storico pagamenti |
| Esami | Esami → Storico | Distinguere dall'aggregatore "Esami" |
| Anagrafica ed Iscrizioni | Candidati | Più corto, è il termine usato in tutta l'app (`candidati-api`, `WizardNuovaIscrizione`, ecc.) |
| Fogli Rosa e Patenti | (eliminare — tab in Pratiche) | Sottoinsieme di Pratiche; vedi §3.10 |
| Moduli | Stampa moduli | Specifica che è output, non input |
| Documenti | Documenti candidato | Distingue dai "moduli da stampare" |
| Pagamenti | Cassa & Pagamenti | Include rendiconto |
| Visite Mediche | Visite & Rinnovi medici | Include scadenze TT2112 (vedi §3.4) |
| Scadenze Mediche | (eliminare — tab in Visite) | Vedi §3.4 |
| Impegni e Scadenze | Agenda | Più corto, copre calendar+impegni unificati |
| Calendario | (eliminare — tab in Agenda) | Vedi §3.7 |
| Punti patente | (sposta in Servizi C.E.D.) | Funzione di consultazione, non workflow |
| Parco Veicoli | Veicoli | Più corto |
| Listino Prezzi | Listino | Più corto |
| Preventivi | Preventivi | OK |
| Committenti | Committenti | OK |

---

## 5. Proposta nuova sidebar

Obiettivo: **8 voci di primo livello**, tutte con identità chiara, con sub-voci collassabili dove serve.

```
🏠  Dashboard                                  → /
👥  Candidati                                  → /anagrafica-iscrizioni
     │
     ├─ Anagrafica & iscrizioni                → /anagrafica-iscrizioni
     ├─ Documenti candidato                    → /documenti
     └─ Stampa moduli                          → /moduli

📂  Pratiche                                   → /pratiche
     │
     ├─ Tutte le pratiche                      → /pratiche
     ├─ Fogli rosa attivi (filtro)             → /pratiche?filtro=foglio_rosa
     └─ Guida accompagnata                     → /guida-accompagnata

🏛️  Portale Automobilista                      → /portale
     │
     ├─ Lettura dati                           → /portal-sync  +  /portale (tab unificate)
     ├─ Esplora funzioni                       → /portale/funzioni
     ├─ Archivio storico                       → /archivio-portale
     └─ Servizi C.E.D.                         → /servizi-online   (Import / Punti / CQC / Rinnovab.)

📤  Trasmissioni                               → /trasmiss (default)
     │
     ├─ → CED (GeCA)                           → /trasmiss
     └─ → Portale Automobilista                → /trasmissione-portale

🎓  Esami                                      → /prenotazioni (default)
     │
     ├─ Prenotazioni & Radar                   → /prenotazioni
     ├─ Sessioni                               → /sessioni-esame
     ├─ Richieste & Pagamenti                  → /richieste-esame
     └─ Storico esami                          → /esami

🚗  Operatività                                → /guide (default)
     │
     ├─ Guide                                  → /guide
     ├─ Corsi                                  → /corsi
     ├─ Visite & Rinnovi medici                → /visite-mediche  (con tab "in scadenza")
     ├─ Veicoli                                → /veicoli
     └─ Istruttori                             → /istruttori     (oggi orfana)

💼  Amministrazione                            → /pagamenti (default)
     │
     ├─ Cassa & Pagamenti                      → /pagamenti  (con tab "Rendiconto giornaliero")
     ├─ Listino                                → /listino
     ├─ Preventivi                             → /preventivi
     ├─ Committenti                            → /committenti
     └─ Statistiche                            → /statistiche

🗓  Agenda                                     → /calendar (default)
     │
     ├─ Calendario                             → /calendar
     ├─ Impegni & scadenze                     → /impegni
     └─ Notifiche                              → /notifiche       (oggi orfana)

⚙️  Sistema
     │
     ├─ Operatori                              → /operatori        (oggi orfana)
     └─ Impostazioni                           → /impostazioni
```

**Conteggio: 9 voci di primo livello + sotto-menu** (vs 31 attuali). Tutte le route esistenti sono raggiungibili. Le orfane (`istruttori`, `notifiche`, `operatori`, `archivio-portale`, `rendiconto`, `guida-accompagnata`) sono adottate. Le redirect-stub (`lista-attesa`, `radar`, `candidati`) possono essere rimosse.

---

## 6. Quick wins (fattibili senza spec/plan)

1. **Rimuovere "Portale - Funzioni" dalla sidebar di primo livello** e linkarla come tile/CTA dentro la pagina `/portale`. Riduce da 31 a 30 voci con zero rischio (la route resta esistente).
2. **Rinominare "Strumenti Utili" → "Utility"** o spostare i 5 tab nei loro owner naturali (Dashboard / Statistiche / Pratiche). Il primo passo "rinomina" è banale e rimuove la falsa promessa del nome.
3. **Rinominare "Lettura Portale" → "Portale: Lettura dati"** e **"Portale Automobilista" → "Portale: Sessioni & Verbali"**. Disambigua le 3 voci 🌐 senza toccare codice.
4. **Adottare nel menu le orfane non-redirect** (`istruttori`, `notifiche`, `operatori`, `archivio-portale`, `rendiconto`) finché non si fa il consolidamento — almeno diventano scopribili.
5. **Allineare le icone duplicate**: oggi 📅 è usata sia da "Sessioni Esame" sia da "Esami"; 🌐 è usata da 3 voci. Cambiare almeno una per rendere distinguibile la lista in scroll.

---

## 7. Migrazioni complesse (richiedono spec/plan separato)

Queste sono modifiche strutturali che toccano più route e hanno impatto su deep-link, bookmark utenti, eventuali integrazioni esterne. Servono spec dedicate.

1. **Consolidare `/portale` + `/portal-sync` in un'unica pagina con tab unificate.** Da decidere: shape API condivisa, gestione stato sessione portale unica, nome route canonico.
2. **Sezione "Esami" con 4 sotto-route navigazionali coerenti.** Ridisegnare top-bar comune (filtri data/sessione) condivisa tra `/sessioni-esame`, `/prenotazioni`, `/richieste-esame`, `/esami`.
3. **Rimozione `/candidati` (dead code) con verifica nessun link interno o e-mail/portale punti a quella route.** Serve grep approfondito + redirect 301 a `/anagrafica-iscrizioni`.
4. **Rimozione redirect-stub `/lista-attesa` e `/radar`.** Decidere strategia: redirect server-side via `next.config` o eliminazione totale (e accettare 404 sui vecchi bookmark).
5. **Trasformare `/fogli-rosa-patenti` in tab di `/pratiche`.** Spostare la "Sezione Candidati con Foglio Rosa" e l'azione "ristampa via portale" dentro la lista pratiche con filtro preimpostato; richiede ridisegno azioni di riga.
6. **Unificare `/calendar` + `/impegni` in "Agenda".** Schema dati: oggi sono due tabelle distinte con tipi parzialmente sovrapposti. Serve mappatura tipo → categoria, e decidere se i 7 tipi di impegno restano distinti dai 7 tipi di evento calendar.
7. **Promuovere `/visite-mediche` a contenitore con tab "Agenda" + "In scadenza"** assorbendo `/scadenze-mediche`. Migrare filtri, query e CSV export.
8. **Hub "Servizi C.E.D. portale"**: razionalizzare `/servizi-online` come unico punto per import, punti patente, verifica CQC, cambio codice ecc., togliendo duplicazioni in sidebar.
9. **Smantellare `/strumenti-utili`** muovendo i 5 tab nei loro owner naturali (vedi §3.9). Coordinare con i deep-link che oggi puntano a `?tab=…`.

---

Fine report.
