# Deploy Railway - Autoscuola SaaS

Questo workspace usa due servizi separati:

- `gestionale/backend` (API + engine)
- `gestionale/frontend` (Next.js dashboard)

## 1) Crea progetto Railway

1. Apri Railway e crea un nuovo progetto da repository GitHub.
2. Aggiungi **2 services** dallo stesso repo:
   - Service A root directory: `gestionale/backend`
   - Service B root directory: `gestionale/frontend`

## 2) Configura backend service

Root directory: `gestionale/backend`

Variabili ambiente minime:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`
- `JWT_SECRET`
- `AUTH_REQUIRED=true`
- `MULTI_AUTOSCUOLA=true`
- `PORT=3000`
- `ENGINE_AUTO_START=true`
- `ENGINE_AUTO_INTERVAL_SECONDS=30`
- `PORTAL_USERNAME`
- `PORTAL_PASSWORD`
- `PORTAL_PIN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Healthcheck:

- path: `/health`

## 3) Configura frontend service

Root directory: `gestionale/frontend`

Variabili ambiente minime:

- `NEXT_PUBLIC_API_BASE=https://<backend-public-url>`
- `PORT=3000`

## 4) Migrazione DB multi-autoscuola

Esegui su Supabase SQL editor:

- `gestionale/backend/sql/2026-02-25_multi_autoscuola_auth.sql`
- `gestionale/backend/sql/2026-03-01_candidates_extended_anagrafica.sql`
- `gestionale/backend/sql/2026-03-01_remote_capture_sessions.sql`

## 5) Verifica post-deploy

- Backend: `https://<backend-url>/health` -> `{ ok: true }`
- Frontend: apri `https://<frontend-url>/register`
- Registra autoscuola, poi login.
- Verifica `/import` e `/prenotazioni`.

## 6) Note operative

- Backend usa fallback porta locale in sviluppo; su Railway usa `PORT` fornita dalla piattaforma.
- Engine auto parte solo se `ENGINE_AUTO_START=true`.
- In produzione usa valori forti per `JWT_SECRET`.

## 7) Variabili pronte (copia/incolla)

Backend (service `gestionale/backend`):

```dotenv
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE=YOUR_SUPABASE_SERVICE_ROLE
JWT_SECRET=CHANGE_ME_TO_LONG_RANDOM_SECRET
AUTH_REQUIRED=true
MULTI_AUTOSCUOLA=true
PORT=3000
ENGINE_AUTO_START=true
ENGINE_AUTO_INTERVAL_SECONDS=30
PORTAL_USERNAME=YOUR_PORTAL_USERNAME
PORTAL_PASSWORD=YOUR_PORTAL_PASSWORD
PORTAL_PIN=YOUR_PORTAL_PIN
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID
```

Frontend (service `gestionale/frontend`):

```dotenv
NEXT_PUBLIC_API_BASE=https://YOUR_BACKEND_PUBLIC_URL.up.railway.app
PORT=3000
```

File di riferimento nel repo:

- `gestionale/backend/.env.railway.example`
- `gestionale/frontend/.env.railway.example`

## 8) Go-live checklist (5 minuti)

1. Deploy backend e verifica `https://<backend-url>/health`.
2. Esegui le migrazioni SQL su Supabase (multi-autoscuola + anagrafica estesa + remote capture sessions).
3. Deploy frontend con `NEXT_PUBLIC_API_BASE` puntato al backend live.
4. Apri `/register`, crea autoscuola, fai login.
5. Verifica `/import` e `/prenotazioni` con token attivo.
