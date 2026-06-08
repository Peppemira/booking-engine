# Aggancio di un NUOVO frontend al backend esistente

Questo documento spiega come collegare un **nuovo gestionale** (frontend) all'infrastruttura
già online del progetto `booking-engine`, riusando **tutto**: database, portale Ministero,
autenticazione. Il nuovo frontend NON riscrive nessun collegamento: chiama l'API esistente.

> Come usarlo sull'altro PC: apri Claude Code nella cartella del nuovo gestionale e incolla
> questo file dicendo «aggancia questo frontend al backend descritto qui».

## Infrastruttura da riusare
- **Backend API (Railway):** `https://booking-engine-production-415a.up.railway.app`
- **Database:** Supabase *prenota automativo* — già collegato DENTRO il backend (service_role lato server)
- **Portale Ministero + auth + sync:** tutto dietro l'API, niente da rifare
- **Hosting:** Vercel team `iopatentes-projects`

## 1) Imposta l'URL dell'API nel nuovo frontend
- Vite:   `VITE_API_BASE=https://booking-engine-production-415a.up.railway.app`
- Next.js: `NEXT_PUBLIC_API_BASE=https://booking-engine-production-415a.up.railway.app`
Usa questa variabile come base per TUTTE le chiamate fetch.

## 2) Login (obbligatorio — AUTH_REQUIRED=true)
`POST {API_BASE}/api/auth/login`  body JSON `{ "email": "...", "password": "..." }`
→ risposta `{ success, token, autoscuola:{id,nome,email,codice_autoscuola} }`
- Salva `token`. Su ogni chiamata protetta aggiungi header: `Authorization: Bearer <token>`
- Usa il tuo account autoscuola (codice 0674). Le credenziali NON vanno scritte qui: chiedile/recuperale a parte.
- Altri: `GET /api/auth/me`, `POST /api/auth/logout`, `/register`, `/request-reset`, `/reset-password`

## 3) Endpoint principali (tutti sotto /api, richiedono Bearer)
- Candidati: `GET/POST /api/candidati-api` (alias `/api/candidates`); lista intera `GET /api/candidati/all`
- Waitlist/radar: `/api/waitlist`, `/api/radar`
- Prenotazioni: `/api/prenotazioni`  · Pagamenti: `/api/pagamenti`  · Pratiche: `/api/pratiche`
- Guide: `/api/guide` · Corsi: `/api/corsi` · Veicoli: `/api/veicoli` · Committenti: `/api/committenti`
- Listino: `/api/listino` · Impegni/scadenze: `/api/impegni` · Istruttori: `/api/istruttori`
- Operatori: `/api/operatori` · Visite mediche: `/api/visite-mediche` · Preventivi: `/api/preventivi`
- Verbali: `/api/verbali-svolti` · Notifiche: `/api/notifiche` · Documenti: `/api/documenti` · Calendar: `/api/calendar`
- Portale Ministero: `/api/portal/...`, `/api/portal-sync/...`, `/api/portal-login`, `/api/portal-status`, `/api/portal-candidati`, `/api/portal/punti-patente`
- Statistiche: `/api/resoconti/conteggi|esami|incassi|grafici`
- Moduli PDF: `/api/moduli` · Acquisizione remota CIE: `/api/remote-capture/sessions`
- Salute (pubblico, no auth): `/health`

Le firme esatte (parametri/corpo) sono nel codice: repo `Peppemira/booking-engine`,
cartella `gestionale/backend/src/routes/*.js` (+ `src/server.js`). Clona/leggi quelli per i dettagli.

## 4) Multi-tenant
`MULTI_AUTOSCUOLA=true`: i dati sono filtrati per autoscuola in base al JWT del login.
Loggandoti col tuo account vedi solo i tuoi dati (codice 0674). Nessuna config lato frontend.

## 5) CORS — già a posto
Il backend accetta qualsiasi origine `*.vercel.app` e `localhost`. Quindi il nuovo frontend
funziona sia in locale sia su Vercel SENZA modifiche. (Per un dominio custom non-vercel:
aggiungere l'origine alla variabile `FRONTEND_ORIGIN` su Railway, valori separati da virgola.)

## 6) Deploy su Vercel (stesso account)
1. Nuovo progetto Vercel dal repo del nuovo gestionale (team `iopatentes-projects`)
2. Env var (Production + Preview): `VITE_API_BASE` / `NEXT_PUBLIC_API_BASE` = URL Railway sopra
3. Deploy. Il dominio `*.vercel.app` è già coperto dalla CORS.

## 7) Regola d'oro di sicurezza
Il nuovo frontend NON deve collegarsi direttamente a Supabase e NON deve contenere la
`service_role`. Passa SEMPRE dal backend: così riusi anche portale + auth e non esponi segreti.
