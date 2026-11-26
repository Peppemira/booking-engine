# Commissioni PagoPA – Specifica tecnica di integrazione

Documento per lo sviluppo della piattaforma BLUEFOX (booking engine multi-autoscuola). Obiettivo: addebitare a ogni autoscuola una commissione fissa (1,00–1,50 €) per ogni PagoPA gestito tramite la piattaforma, con incasso e fatturazione elettronica settimanali e automatici.

## 1. Principi

- Le autoscuole pagano i PagoPA sul Portale dell'Automobilista con la propria carta (Postepay, carta del conto, carta di credito). La piattaforma non gestisce mai i fondi dei PagoPA: niente obblighi da istituto di pagamento.
- La commissione della piattaforma è un canone software a consumo, fatturato separatamente.
- Incasso: carta salvata su Stripe (anche la stessa usata per i PagoPA) oppure addebito SEPA diretto.
- Fatturazione: settimanale. Il conteggio è aggiornato in tempo reale.
- Nota: la commissione PagoPA dipende dal PSP scelto al checkout. Verificare con una Postepay quali PSP propone il checkout e a che costo (obiettivo: circa 0,25 € come oggi).

## 2. Componenti

- **Stripe Billing**: clienti, metodi di pagamento, abbonamento a consumo (Meters API), addebito automatico, nuovi tentativi in caso di insoluto.
- **Provider di fatturazione elettronica con API** (Fatture in Cloud, Aruba, Openapi o equivalente): emissione e invio della fattura allo SDI.
- **Backend della piattaforma**: registra gli eventi PagoPA, riceve i webhook Stripe, crea le fatture SDI, gestisce blocchi e sblocchi.
- **Messaggistica**: email e WhatsApp per avvisi e solleciti.

## 3. Flusso di iscrizione

1. L'autoscuola si registra e inserisce i dati di fatturazione (ragione sociale, P.IVA, codice fiscale, codice SDI o PEC).
2. Il backend crea il cliente su Stripe e salva l'ID nel database.
3. L'autoscuola salva la carta o firma il mandato SEPA (Stripe Checkout in modalità setup o Payment Element). Alla prima carta c'è la conferma 3D Secure; i successivi addebiti partono senza intervento.
4. Il backend crea l'abbonamento con un prezzo a consumo collegato al meter "pagopa_usati", con intervallo settimanale.

## 4. Conteggio dei PagoPA

- Ogni volta che un PagoPA viene associato a una pratica, il backend salva un record locale (autoscuola, pratica, identificativo PagoPA, data) e invia un evento al meter di Stripe con valore 1.
- Chiave di idempotenza = identificativo del PagoPA, per non contare due volte lo stesso pagamento.
- Gli storni (PagoPA annullato o non usato) generano un evento di correzione o una nota di credito, secondo le regole commerciali decise.
- Il pannello dell'autoscuola mostra il contatore giornaliero e settimanale.

## 5. Chiusura settimanale e incasso

1. A fine periodo Stripe calcola il totale (numero PagoPA × tariffa) e genera la invoice interna.
2. Stripe addebita il metodo di pagamento salvato.
3. Il webhook invoice.paid arriva al backend.
4. Il backend crea la fattura elettronica tramite il provider SDI, con i dati del cliente, il numero di PagoPA, l'importo e l'IVA, e la invia allo SDI.
5. Il backend salva l'esito SDI e mette a disposizione il PDF nel pannello dell'autoscuola.

Nota: la invoice di Stripe non è valida ai fini fiscali italiani. Fa fede solo la fattura inviata allo SDI.

Da decidere con il commercialista: emettere la fattura prima dell'incasso (all'emissione della invoice Stripe) oppure dopo (a pagamento avvenuto).

## 6. Gestione degli insoluti

1. **Nuovi tentativi**: Smart Retries di Stripe, per esempio dopo 1, 3 e 5 giorni.
2. **Avvisi**: a ogni webhook invoice.payment_failed parte un'email o un WhatsApp con il link per pagare con un'altra carta o con un bonifico.
3. **Tolleranza**: la piattaforma resta attiva e mostra un banner "pagamento in sospeso".
4. **Blocco parziale**: dopo 7 giorni vengono bloccate le nuove pratiche con PagoPA. La consultazione dei dati resta consentita.
5. **Sblocco automatico**: al webhook invoice.paid la piattaforma si riattiva.
6. **Controllo preventivo**: prima di ogni nuovo PagoPA il backend verifica che non ci siano fatture scadute.

## 7. Webhook Stripe da gestire

- invoice.created: aggiornamento del pannello.
- invoice.paid: emissione della fattura SDI e sblocco.
- invoice.payment_failed: avviso e avvio dei solleciti.
- customer.subscription.updated / deleted: stato dell'abbonamento.
- payment_method.attached / setup_intent.succeeded: metodo di pagamento salvato.
- Verificare sempre la firma del webhook e gestire l'idempotenza.

## 8. Dati da salvare nel database

- Autoscuola: ID Stripe del cliente, ID dell'abbonamento, dati fiscali, stato (attiva, in sospeso, bloccata).
- Eventi PagoPA: ID, autoscuola, pratica, data, inviato a Stripe (sì/no).
- Fatture: ID della invoice Stripe, numero della fattura SDI, importo, stato del pagamento, stato SDI, PDF.

## 9. Costi indicativi

- Stripe: commissione per singolo addebito settimanale (carta o SEPA), non per singolo PagoPA. Più l'eventuale costo di Stripe Billing in percentuale sul fatturato. Verificare il listino aggiornato.
- Provider SDI: canone annuo o costo per singola fattura, secondo il piano.

## 10. Prossimi passi

1. Prova pratica di pagamento PagoPA con una Postepay e verifica dei PSP disponibili.
2. Conferma con il commercialista di tariffa, IVA e momento di emissione della fattura.
3. Apertura dell'account Stripe e test in modalità sandbox.
4. Scelta del provider SDI con API.
5. Sviluppo dei moduli: iscrizione, conteggio, webhook, fatturazione, solleciti, pannello.

## 11. Analisi del codice esistente (26/11/2026)

Dove si inserisce ogni modulo nel repository attuale:

- **Backend**: `gestionale/backend` (Express, `@supabase/supabase-js`, auth JWT con `requireAuth` e `req.autoscuolaId`, filtro tenant `withTenantFilter`). Deploy su Railway (`railway.json`, `Dockerfile`).
- **Frontend**: `gestionale/frontend` (Next.js, cartella `app/`). Esiste già la pagina `app/pagamenti`; la nuova pagina "Fatturazione" va accanto, la parte admin in una nuova sezione.
- **Migrazioni SQL**: `gestionale/backend/sql/AAAA-MM-GG_nome.sql`. Le nuove tabelle seguono questo schema di nomi (es. `2026-11-26_billing_commissioni_pagopa.sql`).
- **Tabella `autoscuole`** (`sql/2026-02-25_multi_autoscuola_auth.sql`): mancano dati fiscali e campi Stripe → da aggiungere con `ALTER TABLE`.
- **Tabella `pagamenti`** (`sql/2026-03-31_pagamenti_table.sql`): registra i pagamenti dei candidati (metodo `pagoPA` già previsto, con `provider_id`). Non va riusata per le commissioni: servono le tabelle dedicate `pagopa_eventi` e `fatture_piattaforma`.
- **Punto di aggancio del conteggio**: `src/controllers/prenotazioniController.js`, azione di pagamento `pagopa` (stato `pending` / esito `pagamento_in_attesa`). Il conteggio va fatto quando il PagoPA risulta effettivamente pagato/associato alla pratica, non alla sola richiesta, per non addebitare tentativi falliti. Da verificare anche il flusso di `decurtazione` (stato `paid`).
- **Servizio pagamenti**: `src/services/pagamentiService.js` ha uno stub `avviaPagoPA` ("non implementata") esposto su `POST /api/pagamenti/pagoPA` (`src/routes/pagamentiRoutes.js`). Il nuovo codice va in un servizio separato, es. `src/services/billingService.js` + `src/routes/billingRoutes.js`.
- **Webhook Stripe**: l'endpoint deve ricevere il body grezzo (`express.raw`) per la verifica della firma, quindi va registrato in `src/server.js` **prima** del parser JSON globale.
- **Job periodici**: esiste `node-cron` e `src/services/scheduler.js` → usarlo per il job di reinvio degli eventi non inviati a Stripe e per il passaggio a "bloccata" dopo 7 giorni.
- **Notifiche**: esiste `src/services/notificheService.js` → usarlo per email/WhatsApp dei solleciti.
- **Test**: `node --test` in `gestionale/backend/tests` → aggiungere `billing.test.js`.
- **Dipendenza da aggiungere**: `stripe` in `gestionale/backend/package.json`.
