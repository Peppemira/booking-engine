# P1 — Link delivery automatico al candidato (acquisizione remota)

**Data:** 2026-04-17
**Stato:** Design approvato, in attesa di plan e implementazione
**Owner:** Bluefox SRL — Gestionale autoscuola multi-tenant
**Scope:** Sotto-progetto P1 di un programma più ampio "Self-service candidato" (P1→P2→P3→P4)

---

## 1. Contesto e motivazione

Il gestionale ha già una pagina di acquisizione remota per il candidato (`/acquisizione-remota?token=…`) che funziona come wizard mobile-first a 4 step (Fototessera → Firma → Documenti → Riepilogo) e salva i file via `POST /remote-capture/:token`. Il backend espone già `POST /api/remote-capture/sessions` per generare token UUID con TTL configurabile e tenant isolation. Il link viene oggi generato nella scheda candidato ma il **delivery al candidato è manuale**: l'operatore copia/incolla l'URL e lo invia su WhatsApp/email per altre vie. Questo:

- Rallenta il workflow operativo
- Non lascia traccia di chi/quando/cosa è stato inviato
- Non standardizza il messaggio
- Costringe l'operatore a uscire dal gestionale per ogni candidato

**P1 elimina l'attrito** aggiungendo invio in 1-2 click direttamente dalla scheda candidato, sfruttando l'integrazione Brevo già presente (email transazionali) e il pattern `wa.me` (zero-cost per WhatsApp).

## 2. Scope

**In scope:**
- Pulsante "📲 Invia link" nella sidebar destra di `/candidati`
- Popover inline con due canali: email (via Brevo) + WhatsApp (`wa.me/<tel>?text=…`)
- Edit inline dei contatti mancanti (autosave su candidato)
- Tracking persistente dei delivery (chi, quando, canale, esito)
- TTL del token: 24 ore (override del default 30 min)
- Template messaggio fisso con segnaposto `{nome}` `{autoscuola}` `{link}` `{scadenza}`
- Nuovo endpoint backend `POST /api/remote-capture/sessions/:token/deliver`
- Nuova tabella `remote_capture_deliveries` con multi-tenant RLS
- Pulsante "📋 Copia link" come fallback universale

**Out of scope (sotto-progetti separati):**
- P2 — Dashboard "Pratiche in attesa di acquisizione" (vista operatore con stato e azioni bulk)
- P3 — Notifiche real-time all'operatore quando il candidato completa upload (Telegram + badge dashboard)
- P4 — Validazione automatica qualità foto/firma (face detection, sfondo, dimensioni, qualità firma)

**Esplicitamente fuori scope per P1:**
- WhatsApp Business API / Meta Cloud (delivery automatico WhatsApp lato server)
- Provider SMS (Skebby/Twilio)
- Template editabili per autoscuola (rimane hardcoded con segnaposto)
- Tracking "link aperto" via redirect intermedio (richiederebbe URL shortener)
- Bulk send a multipli candidati in un colpo

## 3. Architettura

```
┌─────────────────┐                                    ┌─────────────────┐
│  /candidati     │                                    │  Brevo API      │
│  (Operatore)    │                                    └────────▲────────┘
│                 │                                             │
│  [📲 Invia link]│                                             │
│      │          │                                             │
└──────┼──────────┘                                             │
       │ click                                                  │
       ▼                                                        │
┌──────────────────┐  POST /api/remote-capture/sessions  ┌──────┴──────────┐
│ Popover inline   │ ────────────────────────────────────▶│  Express        │
│ "Invia link a:"  │ ◀────── { token, link, expiresAt } ──│  /server.js     │
│                  │                                      │                  │
│ [📧 anna@...] Invia                                     │  +nuovo:         │
│ [💬 333...] Apri WA                                     │  POST /:token/   │
│                  │  POST /api/remote-capture/sessions/  │       deliver    │
│                  │       :token/deliver  ──────────────▶│                  │
└──────────────────┘  body: {channel, recipient}          └────────┬─────────┘
       │                                                            │
       │ wa.me/<tel>?text=<msg>                                     │ insert
       ▼                                                            ▼
┌──────────────────┐                                      ┌──────────────────┐
│  WhatsApp Web    │                                      │ Supabase         │
│  (nuova tab)     │                                      │ remote_capture_  │
└──────────────────┘                                      │ deliveries (new) │
                                                          └──────────────────┘
```

### File toccati

| File | Ruolo | LOC stimate |
|---|---|---|
| `gestionale/frontend/app/candidati/page.js` | Aggiunta pulsante `📲 Invia link` nella sidebar destra (riga ~1339-1342) | +30 |
| `gestionale/frontend/components/SendLinkPopover.js` (nuovo) | Componente popover isolato e riusabile | +200 |
| `gestionale/backend/src/server.js` | Nuovo endpoint `POST /api/remote-capture/sessions/:token/deliver` | +80 |
| `gestionale/backend/src/services/notificheService.js` | Nuovo template `remote_capture_link` (HTML + WhatsApp) + helper `inviaRemoteCaptureLink()` | +50 |
| `gestionale/backend/migrations/20260417_remote_capture_deliveries.sql` (nuovo) | Schema + indici + RLS | +30 |
| `gestionale/backend/tests/remoteCaptureDeliver.test.js` (nuovo) | Unit + integration test (`node:test`) | +150 |

### Riusi

- `POST /api/remote-capture/sessions` (già esistente in `server.js:675`)
- `buildRemoteCaptureLink(req, token)` (già esistente)
- `notificheService.invia({ template, to, vars })` con provider Brevo
- Pattern multi-tenant `tenantField(req)` / `withTenantFilter()`
- Pattern toast/popover esistenti in `/candidati`

## 4. UI/UX dettagliata

### 4.1 Trigger

Pulsante `📲 Invia link` accanto ai pulsanti esistenti "Scanner" / "Portale" / "C.I. digitale" nella sidebar destra di `/candidati` (riga ~1339-1342 di `page.js`). Stessa palette violetta degli altri pulsanti (`bg-violet-600 hover:bg-violet-700`).

### 4.2 Stato del popover

Layout (ancorato al pulsante che l'ha aperto, posizionamento `absolute right-0 top-full mt-2`, larghezza ~360px):

```
┌──────────────────────────────────────────────────┐
│  📲 Invia link acquisizione                  ✕   │
│  Token valido fino a: 18/04/2026 14:30           │
│  ──────────────────────────────────────────────  │
│                                                   │
│  📧 Email                                         │
│  ┌────────────────────────────────────┐ [Invia]  │
│  │ anna.rossi@gmail.com               │          │
│  └────────────────────────────────────┘          │
│  ✅ Inviata 17/04 14:32  [↻ Reinvia]             │
│                                                   │
│  💬 WhatsApp                                      │
│  ┌────────────────────────────────────┐ [Apri WA]│
│  │ +39 333 1234567                    │          │
│  └────────────────────────────────────┘          │
│  📂 Aperto WA 17/04 14:31  [↻ Riapri]            │
│                                                   │
│  🔗 Link diretto:                                 │
│  https://gestionale.../acquisizione-remota?token=│
│  abc123def...                          [📋 Copia] │
│                                                   │
└──────────────────────────────────────────────────┘
```

### 4.3 Flusso interattivo

1. Click `📲 Invia link` → POST `/api/remote-capture/sessions {expiresMinutes:1440}` → riceve `{token, link, expiresAt}` → apre popover con loading skeleton durante la POST
2. Input email/telefono **pre-popolati** dai campi candidato — uso le colonne primarie `candidate.email` e `candidate.telefono` (non i secondari `email_contatto` / `telefono_1`)
3. Modifica input + blur → `PUT /api/candidates/:id` (endpoint esistente in `routes/candidatiRoutes.js:20`, montato come alias di `/api/candidati-api/`) con body `{email|telefono}` (autosave silente, fallisce silenziosamente con toast warning se 4xx/5xx)
4. `[Invia]` (email) → POST `/api/remote-capture/sessions/:token/deliver {channel:"email", recipient}` → toast verde "Email inviata a anna@..." + label "✅ Inviata DD/MM HH:MM" + bottone diventa `↻ Reinvia`
5. `[Apri WA]` → costruisce URL `https://wa.me/<tel-pulito>?text=<encoded>` → `window.open(url, '_blank')` + POST stesso endpoint con `channel:"whatsapp"` (per tracking) → label "📂 Aperto WA HH:MM"
6. `[📋 Copia]` → `navigator.clipboard.writeText(link)` → toast "Link copiato negli appunti"
7. Click fuori popover → chiude (token rimane valido nel DB fino a scadenza)

### 4.4 Validation

- Email: regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` + non vuota → bottone `[Invia]` con stato disabled e bordo rosso se invalido
- Telefono: algoritmo di normalizzazione esplicito:
  ```javascript
  function cleanPhone(raw) {
    let s = String(raw || "").replace(/[\s\-\.\(\)]/g, ""); // rimuovi separatori
    if (s.startsWith("+")) s = s.slice(1);                  // rimuovi +
    else if (s.startsWith("00")) s = s.slice(2);            // 00 prefix internazionale → bare
    else if (/^3\d{8,9}$/.test(s)) s = "39" + s;            // numero IT mobile senza prefisso
    return /^\d{10,15}$/.test(s) ? s : null;                // valido se 10-15 cifre totali
  }
  ```
  Se `cleanPhone(input) === null` → bottone `[Apri WA]` disabled con tooltip "Telefono non valido (atteso es: +39 333 1234567)"
- Debounce frontend 1s sul bottone `[Invia]` per evitare doppi click rapidi

### 4.5 Componente isolato

`frontend/components/SendLinkPopover.js` esporta default un componente con props:

```javascript
<SendLinkPopover
  candidate={{ id, cognome, nome, email, telefono, autoscuola_nome }}
  onClose={() => {…}}
  onSent={(delivery) => {…}}  // chiamato dopo ogni delivery riuscito
/>
```

Il componente è autosufficiente (genera token, gestisce contatti, fa delivery) per essere riusabile da altre pagine in futuro (es. `/anagrafica-iscrizioni`).

## 5. Backend

### 5.1 Schema DB

`gestionale/backend/migrations/20260417_remote_capture_deliveries.sql`:

```sql
CREATE TABLE IF NOT EXISTS remote_capture_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         uuid NOT NULL REFERENCES remote_capture_sessions(token) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email','whatsapp')),
  recipient     text NOT NULL,                    -- email o telefono normalizzato
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'sent'      -- sent | failed | opened
                CHECK (status IN ('sent','failed','opened')),
  error_message text,
  user_id       uuid REFERENCES auth.users(id),    -- chi ha cliccato "Invia"
  autoscuola_id uuid NOT NULL REFERENCES autoscuole(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rcd_token       ON remote_capture_deliveries(token);
CREATE INDEX IF NOT EXISTS idx_rcd_autoscuola  ON remote_capture_deliveries(autoscuola_id, sent_at DESC);

ALTER TABLE remote_capture_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON remote_capture_deliveries
  USING (autoscuola_id = current_setting('app.autoscuola_id', true)::uuid);
```

Migration con `IF NOT EXISTS` su tabella e indici per safe re-run.

### 5.2 Endpoint deliver

`POST /api/remote-capture/sessions/:token/deliver` in `gestionale/backend/src/server.js` (vicino agli altri endpoint `remote-capture`):

```javascript
// Auth: requireAuth
// Params: :token (UUID)
// Body: { channel: "email"|"whatsapp", recipient: string, candidateName?: string }
// Logica:
//   1. Verifica token esiste in remote_capture_sessions, non scaduto, autoscuola_id matching tenant
//      → 404 Not Found se token sconosciuto
//      → 410 Gone se scaduto
//      → 403 Forbidden se tenant mismatch
//   2. Valida channel ∈ {"email","whatsapp"} → 400 se no
//   3. Valida recipient non vuoto + formato sensato per channel → 400 se no
//   4. Per channel="email":
//      try { await notificheService.inviaRemoteCaptureLink({ to:recipient, vars:{nome, autoscuola, link, scadenza} }) }
//      catch { status="failed", error_message=err.message }
//   5. Per channel="whatsapp":
//      Nessuna chiamata server-side (apertura wa.me lato client). Solo logging.
//      status="sent"
//   6. Insert in remote_capture_deliveries con tutti i campi
//   7. Ritorna { ok:true, delivery:{id, channel, recipient, sent_at, status, error_message} }
//   8. In caso di errore Brevo: ritorna comunque 200 con delivery.status="failed" (non 500)
//      Il frontend mostra l'errore nel popover. L'eccezione 500 è solo per errori imprevisti del server.
```

### 5.3 Template messaggio

In `gestionale/backend/src/services/notificheService.js`:

```javascript
const REMOTE_CAPTURE_LINK_HTML = `
<p>Ciao {nome},</p>
<p>{autoscuola} ha bisogno della tua fototessera, firma e copia dei documenti
per completare la tua pratica.</p>
<p>Clicca qui per caricarli dal tuo telefono:</p>
<p><a href="{link}" style="display:inline-block;padding:14px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px">📱 Apri il caricamento</a></p>
<p style="font-size:13px;color:#666">Il link scade il <strong>{scadenza}</strong> — bastano 5 minuti.</p>
<p style="font-size:13px;color:#666">Se hai problemi rispondi a questa email.</p>`;

const REMOTE_CAPTURE_LINK_WHATSAPP = `Ciao {nome}! 👋
{autoscuola} ti chiede foto, firma e documenti per la pratica.
Carica tutto dal telefono qui (bastano 5 minuti):
{link}
⏰ Il link scade il {scadenza}`;

async function inviaRemoteCaptureLink({ to, vars }) {
  const html = Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v ?? "")),
    REMOTE_CAPTURE_LINK_HTML
  );
  return invia({
    to,
    subject: `${vars.autoscuola}: carica foto, firma e documenti`,
    html,
    template_key: "remote_capture_link",
  });
}

// Esportata anche getRemoteCaptureWhatsappText({vars}) per generare lato client
```

Sostituzione segnaposto via `String.replaceAll('{key}', value)` — niente template engine pesante.

### 5.4 Frontend client

In `frontend/components/SendLinkPopover.js`:

- Genera testo WA con `getRemoteCaptureWhatsappText({nome, autoscuola, link, scadenza})` (lato client, copia del template)
- Pulisce il telefono con `cleanPhone()` (algoritmo definito in §4.4)
- Costruisce URL `https://wa.me/${cleanedTel}?text=${encodeURIComponent(text)}`
- `window.open(url, '_blank')`
- Subito dopo: POST `/deliver` con `channel:"whatsapp"`, `recipient: cleanedTel` (formato canonico es. `393331234567`) solo per logging

## 6. Edge cases ed error handling

| Scenario | Comportamento |
|---|---|
| Token scaduto al click invia | 410 Gone → banner rosso nel popover "Token scaduto" + bottone `↻ Nuovo link` (rigenera token) |
| Email Brevo fallisce (rate limit, indirizzo invalido) | Insert delivery con `status:failed` + `error_message` → popover mostra "❌ Errore: <messaggio>" + bottone `↻ Riprova` |
| Telefono mal formato (no cifre, troppo corto) | Bottone `[Apri WA]` disabilitato + tooltip "Telefono non valido" |
| Operatore clicca `Invia` 2 volte rapide | Debounce frontend 1s + idempotency: il secondo insert in `deliveries` è OK (storia degli invii è feature, non bug); UI mostra entrambi nei dettagli |
| Candidato senza email NÉ telefono | Popover mostra messaggio "Aggiungi almeno un contatto" + 2 input vuoti con `[Salva e invia]` (autosave su candidato + immediato invio) |
| Tenant mismatch (token di altra autoscuola) | 403 Forbidden — `withTenantFilter` su query session lookup |
| Brevo down (timeout) | Try/catch con `AbortController` timeout 8s applicato lato `notificheService.invia` → status:failed con error_message="Brevo timeout" → 200 al frontend con stato fallito (non 500). Implementazione: `const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 8000); fetch(brevoUrl, { signal: ctrl.signal, ... })` |
| Network error frontend | Toast rosso "Connessione persa, riprova" — nessun delivery insert lato server |
| Operatore chiude popover prima dell'invio | Token rimane valido in DB; alla riapertura il popover rilegge i delivery esistenti per quel token (chiamata GET ai deliveries del token) |
| WhatsApp non installato sul desktop dell'operatore | wa.me apre WhatsApp Web (web.whatsapp.com) — nessun problema |

## 7. Performance e scaling

- Endpoint `/deliver`: single-row insert + 1 chiamata Brevo (canale email) o 0 chiamate (canale WhatsApp) = trascurabile (<500ms p99)
- Brevo free tier: 300 email/giorno → sufficiente per autoscuola media (~50 candidati/giorno × 1 invio = 50 email/giorno)
- Tabella `remote_capture_deliveries` cresce ~1 riga per invio → indici su `token` e `(autoscuola_id, sent_at DESC)` mantengono query veloci anche a 100k righe
- Nessun impatto sulle query esistenti (tabella nuova, foreign key non bloccante)

## 8. Test coverage

### 8.1 Backend unit test

`gestionale/backend/tests/remoteCaptureDeliver.test.js` con `node:test`:

1. Token valido + email + Brevo mock OK → insert riga in deliveries con status=sent, ritorna 200 con delivery
2. Token scaduto → 410 Gone, niente insert
3. Token di altra autoscuola → 403 Forbidden, niente insert
4. Token inesistente → 404 Not Found
5. Channel non ammesso (es. "sms") → 400 Bad Request
6. Recipient vuoto → 400
7. Email malformata → 400
8. Telefono malformato → 400
9. Brevo throw (mock) → 200 con status=failed, error_message popolato

### 8.2 Backend integration test

Mock Brevo via stub di `notificheService.invia`:

1. Flow completo: create session → deliver email → query deliveries by token → trovo il record con tutti i campi corretti
2. Flow WhatsApp: create session → deliver whatsapp → niente chiamata a Brevo, solo insert
3. Re-deliver dopo failure: prima chiamata fallisce → status=failed; seconda chiamata ok → 2 righe in deliveries (sent + failed)

### 8.3 Frontend smoke test manuale (no Cypress)

Checklist da eseguire dopo il deploy in dev:

1. ☐ Click `📲 Invia link` su candidato con email+tel → popover appare con TTL = ora+24h
2. ☐ Email pre-popolata, modifico + blur → PATCH candidate ok (verifico in DB)
3. ☐ `[Invia]` → toast verde + label "Inviata HH:MM"
4. ☐ `[Apri WA]` → tab nuova su wa.me + label "Aperto WA"
5. ☐ Refresh pagina → popover non persiste, ma i delivery sì in DB
6. ☐ Candidato senza email → popover chiede di aggiungerla, autosave funziona
7. ☐ Token scaduto (manuale: imposto expires_at nel passato) → click `Invia` → vedo errore "Token scaduto" + `↻ Nuovo link`
8. ☐ Brevo simulated failure (env BREVO_API_KEY temporaneamente errata) → vedo `❌ Errore` + retry funziona

## 9. Migration e rollback strategy

### 9.1 Forward

1. Applicare migration `20260417_remote_capture_deliveries.sql` (idempotente con `IF NOT EXISTS`)
2. Deploy backend con nuovo endpoint
3. Deploy frontend con nuovo componente

Ordine critico: migration deve precedere il deploy backend (l'endpoint fa insert sulla tabella), altrimenti il primo invio fallisce. Il backend rimane retrocompatibile (l'endpoint nuovo è additivo).

### 9.2 Rollback

- Drop endpoint dal codice → no-op
- Drop tabella `remote_capture_deliveries` → no-op (tabella isolata, no FK in entrata)
- Drop componente frontend → no-op
- Nessun cambio a `remote_capture_sessions` esistente
- Zero downtime, zero rischio di corruzione dati

## 10. Future evolution (non in P1)

- **P1.5 — Preview messaggio collassabile**: aggiungere sezione "mostra anteprima" nel popover per vedere il testo finale prima di inviare
- **P1.6 — Template editabili per autoscuola**: pagina settings con editor WYSIWYG per email + textarea per WA
- **P1.7 — WhatsApp delivery server-side**: integrare Meta Cloud API o BSP per non dipendere dal click manuale dell'operatore
- **P2 — Dashboard pratiche in attesa** (sotto-progetto separato)
- **P3 — Notifiche real-time operatore** (sotto-progetto separato)
- **P4 — Validazione automatica AI** (sotto-progetto separato)

## 11. Decisioni acquisite (riferimento brainstorming 2026-04-17)

| Decisione | Scelta |
|---|---|
| Canali invio | Email via Brevo + wa.me click manuale |
| Contatti mancanti | Hybrid: pre-popolati + edit inline + autosave |
| TTL token | 24 ore |
| Personalizzazione messaggio | Template fisso con segnaposto `{nome} {autoscuola} {link} {scadenza}` |
| Tracking | Tabella dedicata `remote_capture_deliveries` (channel, recipient, status, error_message, user_id, autoscuola_id) |
| UI | Approccio A — popover inline ancorato al pulsante (no modale, no speed-dial) |

## 12. Non-goals esplicitati

- ❌ Niente integrazione WhatsApp Business API in P1
- ❌ Niente provider SMS in P1
- ❌ Niente bulk send a multipli candidati
- ❌ Niente template editabili in P1
- ❌ Niente tracking "link aperto" via redirect intermedio
- ❌ Niente dashboard di stato (è P2)
- ❌ Niente notifiche all'operatore (è P3)
- ❌ Niente validazione AI (è P4)
