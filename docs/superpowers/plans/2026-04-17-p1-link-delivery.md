# P1 — Link delivery automatico al candidato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla scheda candidato un pulsante "📲 Invia link" che genera un token di acquisizione remota con TTL 24h e permette all'operatore di consegnarlo al candidato in 1-2 click via Email (Brevo) o WhatsApp (wa.me), tracciando ogni invio in una tabella dedicata.

**Architecture:** Backend Express aggiunge endpoint `POST /api/remote-capture/sessions/:token/deliver` che valida tenant/token/canale/recipient, invia (per email) tramite il `notificheService` esistente con un nuovo template `remote_capture_link`, e registra il delivery in nuova tabella Supabase `remote_capture_deliveries` con RLS. Frontend Next.js aggiunge componente isolato `lib/SendLinkPopover.js` (popover ancorato al pulsante) che riusa `useToast()` per il feedback. Multi-tenant via `withTenantFilter()` esistente.

**Tech Stack:** Express 4, Supabase JS, `node:test`, Next.js 14 App Router, React 18, TailwindCSS, Brevo HTTP API (già integrata).

**Spec di riferimento:** `docs/superpowers/specs/2026-04-17-p1-link-delivery-design.md` (commit `48b4d38`).

---

## File Structure

| File | Stato | Responsabilità |
|---|---|---|
| `gestionale/backend/sql/2026-04-17_remote_capture_deliveries.sql` | **NEW** | Schema tabella + indici + RLS |
| `gestionale/backend/src/services/notificheService.js` | MOD | Aggiunge entry `remote_capture_link` in TEMPLATES + helper `getRemoteCaptureWhatsappText()` |
| `gestionale/backend/src/server.js` | MOD | Aggiunge endpoint `POST /api/remote-capture/sessions/:token/deliver` |
| `gestionale/backend/tests/remoteCaptureDeliver.test.js` | **NEW** | 9 test case (validazione, edge case, happy path) |
| `gestionale/frontend/lib/SendLinkPopover.js` | **NEW** | Componente popover isolato con generazione token + 2 canali |
| `gestionale/frontend/lib/phoneUtils.js` | **NEW** | Funzione `cleanPhone()` riusabile (anche per futuri P3/P4) |
| `gestionale/frontend/app/candidati/page.js` | MOD | Aggiunge pulsante "📲 Invia link" + integra `<SendLinkPopover>` |

**Convenzioni progetto** (verificate prima del plan):
- Migration directory: `gestionale/backend/sql/` (non `migrations/`)
- Componenti React riusabili: `gestionale/frontend/lib/` (es. `ToastContext.js`, `ProgressPanel.js`)
- Test framework: `node:test` (vedi `tests/auth.test.js` per pattern di mocking)
- Toast: `useToast()` da `lib/ToastContext.js` con metodi `success/error/info/warning`

---

## Task 1: Migration SQL `remote_capture_deliveries`

**Files:**
- Create: `gestionale/backend/sql/2026-04-17_remote_capture_deliveries.sql`

- [ ] **Step 1: Crea il file di migration**

Crea `gestionale/backend/sql/2026-04-17_remote_capture_deliveries.sql` con questo contenuto esatto:

```sql
-- Migration: tabella tracking delivery per link acquisizione remota.
-- Data: 2026-04-17
-- Spec: docs/superpowers/specs/2026-04-17-p1-link-delivery-design.md
-- Idempotente (IF NOT EXISTS), safe re-run.

CREATE TABLE IF NOT EXISTS remote_capture_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         uuid NOT NULL REFERENCES remote_capture_sessions(token) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email','whatsapp')),
  recipient     text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','failed','opened')),
  error_message text,
  user_id       uuid,
  autoscuola_id uuid NOT NULL REFERENCES autoscuole(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rcd_token       ON remote_capture_deliveries(token);
CREATE INDEX IF NOT EXISTS idx_rcd_autoscuola  ON remote_capture_deliveries(autoscuola_id, sent_at DESC);

ALTER TABLE remote_capture_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON remote_capture_deliveries;
CREATE POLICY tenant_isolation ON remote_capture_deliveries
  USING (autoscuola_id = current_setting('app.autoscuola_id', true)::uuid);
```

- [ ] **Step 2: Applica la migration in Supabase**

Apri Supabase Studio → SQL Editor → New Query → incolla il contenuto del file → click "Run".

Atteso: messaggio "Success. No rows returned".

- [ ] **Step 3: Verifica lo schema in DB**

Esegui in Supabase SQL Editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'remote_capture_deliveries'
ORDER BY ordinal_position;
```

Atteso: 9 righe (id, token, channel, recipient, sent_at, status, error_message, user_id, autoscuola_id).

- [ ] **Step 4: Commit**

```bash
cd C:/Users/bluef/booking-engine
git add gestionale/backend/sql/2026-04-17_remote_capture_deliveries.sql
git commit -m "feat(p1): migration remote_capture_deliveries

Tracking persistente dei delivery del link acquisizione remota
(canale, recipient, status, error_message). Multi-tenant via RLS
con app.autoscuola_id. FK su remote_capture_sessions.token con
ON DELETE CASCADE per pulizia automatica."
```

---

## Task 2: Backend — Test failing per template `remote_capture_link`

**Files:**
- Create: `gestionale/backend/tests/notificheServiceTemplate.test.js`

- [ ] **Step 1: Scrivi il test failing**

Crea `gestionale/backend/tests/notificheServiceTemplate.test.js`:

```javascript
"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { TEMPLATES, getRemoteCaptureWhatsappText } = require("../src/services/notificheService");

describe("Template remote_capture_link", () => {
  it("esiste in TEMPLATES", () => {
    assert.ok(TEMPLATES.remote_capture_link, "TEMPLATES.remote_capture_link non definito");
    assert.equal(typeof TEMPLATES.remote_capture_link.subject, "string");
    assert.equal(typeof TEMPLATES.remote_capture_link.html, "function");
    assert.equal(typeof TEMPLATES.remote_capture_link.text, "function");
  });

  it("html() sostituisce {nome} {autoscuola} {link} {scadenza}", () => {
    const html = TEMPLATES.remote_capture_link.html({
      nome: "Anna",
      autoscuola: "Autoscuola Miracolo",
      link: "https://gest.example/acquisizione-remota?token=abc",
      scadenza: "18/04/2026 14:30",
    });
    assert.match(html, /Anna/);
    assert.match(html, /Autoscuola Miracolo/);
    assert.match(html, /acquisizione-remota\?token=abc/);
    assert.match(html, /18\/04\/2026 14:30/);
  });

  it("subject contiene il nome dell'autoscuola", () => {
    const sub = typeof TEMPLATES.remote_capture_link.subject === "function"
      ? TEMPLATES.remote_capture_link.subject({ autoscuola: "Test Autoscuola" })
      : TEMPLATES.remote_capture_link.subject;
    // Accetta entrambi: subject statico O funzione che accetta vars
    assert.ok(sub.length > 0);
  });

  it("getRemoteCaptureWhatsappText sostituisce i segnaposto", () => {
    const text = getRemoteCaptureWhatsappText({
      nome: "Mario",
      autoscuola: "Bluefox",
      link: "https://gest.example/acquisizione-remota?token=xyz",
      scadenza: "18/04/2026 14:30",
    });
    assert.match(text, /Mario/);
    assert.match(text, /Bluefox/);
    assert.match(text, /acquisizione-remota\?token=xyz/);
    assert.match(text, /18\/04\/2026 14:30/);
  });
});
```

- [ ] **Step 2: Esegui il test, verifica che fallisce**

```bash
cd gestionale/backend
node --test tests/notificheServiceTemplate.test.js
```

Atteso: 4 test FALLISCONO con errore tipo `TypeError: Cannot read properties of undefined (reading 'subject')` oppure `TypeError: getRemoteCaptureWhatsappText is not a function`.

- [ ] **Step 3: Commit del test failing**

```bash
git add gestionale/backend/tests/notificheServiceTemplate.test.js
git commit -m "test(p1): failing test per template remote_capture_link"
```

---

## Task 3: Backend — Implementa template + helper

**Files:**
- Modify: `gestionale/backend/src/services/notificheService.js`

- [ ] **Step 1: Trova la mappa TEMPLATES**

Apri `gestionale/backend/src/services/notificheService.js` e localizza la dichiarazione `const TEMPLATES = {` (cerca con `grep -n "const TEMPLATES" gestionale/backend/src/services/notificheService.js`).

- [ ] **Step 2: Aggiungi entry `remote_capture_link` in TEMPLATES**

All'interno dell'oggetto `TEMPLATES`, aggiungi (alla fine, prima della `}` di chiusura):

```javascript
  remote_capture_link: {
    subject: (vars = {}) =>
      `${vars.autoscuola || "La tua autoscuola"}: carica foto, firma e documenti`,
    html: (vars = {}) => {
      const tpl = `
<p>Ciao {nome},</p>
<p>{autoscuola} ha bisogno della tua fototessera, firma e copia dei documenti per completare la tua pratica.</p>
<p>Clicca qui per caricarli dal tuo telefono:</p>
<p><a href="{link}" style="display:inline-block;padding:14px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px">📱 Apri il caricamento</a></p>
<p style="font-size:13px;color:#666">Il link scade il <strong>{scadenza}</strong> — bastano 5 minuti.</p>
<p style="font-size:13px;color:#666">Se hai problemi rispondi a questa email.</p>`;
      return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v ?? "")),
        tpl
      );
    },
    text: (vars = {}) => {
      const tpl = `Ciao {nome},
{autoscuola} ti chiede foto, firma e documenti per la pratica.
Carica tutto dal telefono qui (bastano 5 minuti):
{link}
Il link scade il {scadenza}.`;
      return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v ?? "")),
        tpl
      );
    },
  },
```

- [ ] **Step 3: Aggiungi helper `getRemoteCaptureWhatsappText`**

Subito sopra a `module.exports = {` (riga ~260) aggiungi:

```javascript
/**
 * Genera il testo WhatsApp per il link acquisizione remota.
 * Esportato per essere usato anche dal frontend (via API o duplicato).
 * Stesso template di TEMPLATES.remote_capture_link.text.
 */
function getRemoteCaptureWhatsappText(vars = {}) {
  const tpl = `Ciao {nome}! 👋
{autoscuola} ti chiede foto, firma e documenti per la pratica.
Carica tutto dal telefono qui (bastano 5 minuti):
{link}
⏰ Il link scade il {scadenza}`;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v ?? "")),
    tpl
  );
}
```

- [ ] **Step 4: Aggiungi `TEMPLATES` e `getRemoteCaptureWhatsappText` a module.exports**

Modifica `module.exports = { ... }` per esportare anche `TEMPLATES` e `getRemoteCaptureWhatsappText`. Il blocco finale dovrebbe avere queste due aggiunte:

```javascript
module.exports = {
  // ... export esistenti ...
  TEMPLATES,
  getRemoteCaptureWhatsappText,
};
```

- [ ] **Step 5: Esegui i test, verifica che passano**

```bash
cd gestionale/backend
node --test tests/notificheServiceTemplate.test.js
```

Atteso: 4 test passano (`# pass 4`, `# fail 0`).

- [ ] **Step 6: Commit**

```bash
git add gestionale/backend/src/services/notificheService.js
git commit -m "feat(p1): template remote_capture_link + helper WhatsApp

Aggiunto entry 'remote_capture_link' in TEMPLATES con subject/html/text
+ helper getRemoteCaptureWhatsappText() esportato per uso frontend.
Sostituzione segnaposto via String.replaceAll, no template engine."
```

---

## Task 4: Backend — Test failing per endpoint `/deliver`

**Files:**
- Create: `gestionale/backend/tests/remoteCaptureDeliver.test.js`

- [ ] **Step 1: Scrivi il test scaffolding con il primo caso happy-path**

Crea `gestionale/backend/tests/remoteCaptureDeliver.test.js`:

```javascript
"use strict";
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

// ── Mock Supabase + notificheService prima di require server ────────────────
let mockSession = null;       // riga remote_capture_sessions trovata
let mockSessionError = null;
let mockTenantId = "tenant-A-uuid";
let lastInsertedDelivery = null;
let inviaCalledWith = null;
let inviaShouldThrow = null;

const Module = require("module");
const origResolve = Module._resolve_filename || Module._resolveFilename;

// Stub minimo del client Supabase usato dal server
const supabaseStub = {
  from(table) {
    return {
      select() { return this; },
      insert(rows) {
        lastInsertedDelivery = rows && rows[0];
        return {
          select() {
            return {
              maybeSingle: () => Promise.resolve({
                data: { id: "delivery-uuid-123", ...lastInsertedDelivery },
                error: null,
              }),
            };
          },
        };
      },
      eq() { return this; },
      ilike() { return this; },
      gte() { return this; },
      lte() { return this; },
      maybeSingle: () => Promise.resolve({ data: mockSession, error: mockSessionError }),
      single: () => Promise.resolve({ data: mockSession, error: mockSessionError }),
    };
  },
};

require.cache[require.resolve("../src/database/supabase")] = {
  exports: supabaseStub,
};

// Stub del notificheService
const notificheStub = {
  invia: async (opts) => {
    inviaCalledWith = opts;
    if (inviaShouldThrow) throw new Error(inviaShouldThrow);
    return { success: true, esito: "inviata", provider: "brevo-stub" };
  },
  getRemoteCaptureWhatsappText: () => "ciao test",
  TEMPLATES: { remote_capture_link: {} },
};
require.cache[require.resolve("../src/services/notificheService")] = {
  exports: notificheStub,
};

// JWT/auth stub: req.autoscuolaId pre-popolato dal middleware
process.env.AUTH_REQUIRED = "false";
process.env.JWT_SECRET = "test-secret-12345";

// ── Carica l'endpoint deliver come mini-app ─────────────────────────────────
// (NB: lo facciamo isolato dal server.js completo per evitare side effects)
const express = require("express");

function createTestApp() {
  const app = express();
  app.use(express.json());
  // Inietta autoscuolaId fittizio (in prod lo fa requireAuth + attachAuthContext)
  app.use((req, _res, next) => { req.autoscuolaId = mockTenantId; next(); });
  // Carica solo l'handler deliver — pattern: require da server.js NON è ideale,
  // ma siccome è inline in server.js ora, lo importiamo via dynamic require di
  // un mini-modulo dedicato. Vedi Task 5 step "estrai l'handler in un file".
  const deliverHandler = require("../src/server/remoteCaptureDeliverHandler");
  app.post("/api/remote-capture/sessions/:token/deliver", deliverHandler);
  return app;
}

function request(app, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data ? Buffer.byteLength(data) : 0,
          ...headers,
        },
      }, (res) => {
        let chunks = "";
        res.on("data", (c) => { chunks += c; });
        res.on("end", () => {
          server.close();
          let parsed = null;
          try { parsed = JSON.parse(chunks); } catch { parsed = chunks; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe("POST /api/remote-capture/sessions/:token/deliver", () => {
  beforeEach(() => {
    mockSession = null;
    mockSessionError = null;
    lastInsertedDelivery = null;
    inviaCalledWith = null;
    inviaShouldThrow = null;
  });

  it("happy path email: token valido + Brevo OK → 200 + insert delivery", async () => {
    mockSession = {
      token: "tok-123",
      mode: "cie_mobile",
      status: "pending",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-123/deliver", {
      channel: "email",
      recipient: "anna.rossi@example.com",
      candidateName: "Anna Rossi",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.delivery.channel, "email");
    assert.equal(res.body.delivery.status, "sent");
    assert.equal(res.body.delivery.recipient, "anna.rossi@example.com");
    assert.ok(inviaCalledWith, "notificheService.invia non chiamato");
    assert.equal(inviaCalledWith.template_key, "remote_capture_link");
    assert.equal(inviaCalledWith.email_destinatario, "anna.rossi@example.com");
  });
});
```

- [ ] **Step 2: Esegui il test, verifica fallisce**

```bash
cd gestionale/backend
node --test tests/remoteCaptureDeliver.test.js
```

Atteso: FAIL con `Cannot find module '../src/server/remoteCaptureDeliverHandler'`. Questo è il segnale che dobbiamo prima creare il file dell'handler.

- [ ] **Step 3: Commit del test failing**

```bash
git add gestionale/backend/tests/remoteCaptureDeliver.test.js
git commit -m "test(p1): failing test happy-path endpoint /deliver"
```

---

## Task 5: Backend — Implementa handler `/deliver` in modulo dedicato

**Files:**
- Create: `gestionale/backend/src/server/remoteCaptureDeliverHandler.js`
- Modify: `gestionale/backend/src/server.js` (registra l'endpoint)

- [ ] **Step 1: Crea il file dell'handler**

Crea `gestionale/backend/src/server/remoteCaptureDeliverHandler.js`:

```javascript
"use strict";
/**
 * Handler endpoint POST /api/remote-capture/sessions/:token/deliver.
 * Estratto in modulo separato per testabilità isolata.
 *
 * Body: { channel: "email"|"whatsapp", recipient: string, candidateName?: string }
 * Auth: middleware esterno deve aver popolato req.autoscuolaId (via requireAuth).
 */

const supabase = require("../database/supabase");
const notificheService = require("../services/notificheService");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{10,15}$/;
const ALLOWED_CHANNELS = new Set(["email", "whatsapp"]);

async function deliverHandler(req, res) {
  try {
    const token = String(req.params?.token || "").trim();
    const channel = String(req.body?.channel || "").trim().toLowerCase();
    const recipient = String(req.body?.recipient || "").trim();
    const candidateName = String(req.body?.candidateName || "candidato").trim();
    const autoscuolaId = req.autoscuolaId || null;

    // Validazioni input
    if (!token) return res.status(400).json({ ok: false, error: "Token mancante" });
    if (!ALLOWED_CHANNELS.has(channel)) {
      return res.status(400).json({ ok: false, error: `Channel non ammesso: ${channel}` });
    }
    if (!recipient) return res.status(400).json({ ok: false, error: "Recipient mancante" });
    if (channel === "email" && !EMAIL_REGEX.test(recipient)) {
      return res.status(400).json({ ok: false, error: "Email non valida" });
    }
    if (channel === "whatsapp" && !PHONE_REGEX.test(recipient)) {
      return res.status(400).json({ ok: false, error: "Telefono non valido (atteso 10-15 cifre)" });
    }

    // Lookup sessione (tenant filter + scadenza)
    const { data: session, error: errSess } = await supabase
      .from("remote_capture_sessions")
      .select("token, expires_at, autoscuola_id")
      .eq("token", token)
      .maybeSingle();
    if (errSess) return res.status(500).json({ ok: false, error: errSess.message });
    if (!session) return res.status(404).json({ ok: false, error: "Token non trovato" });
    if (autoscuolaId && session.autoscuola_id && String(session.autoscuola_id) !== String(autoscuolaId)) {
      return res.status(403).json({ ok: false, error: "Token appartiene ad altra autoscuola" });
    }
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ ok: false, error: "Token scaduto" });
    }

    // Costruisci link e scadenza human-readable
    const link = buildLinkFromReq(req, token);
    const scadenza = formatItalianDate(session.expires_at);
    const autoscuolaNome = req.autoscuolaNome || req.autoscuola_nome || "La tua autoscuola";

    // Esegui invio (solo email; whatsapp è solo logging)
    let status = "sent";
    let errorMessage = null;
    if (channel === "email") {
      try {
        await notificheService.invia({
          email_destinatario: recipient,
          template_key: "remote_capture_link",
          vars: { nome: candidateName, autoscuola: autoscuolaNome, link, scadenza },
          autoscuola_id: autoscuolaId,
        });
      } catch (e) {
        status = "failed";
        errorMessage = (e && e.message) ? e.message.slice(0, 500) : "Brevo error";
      }
    }

    // Insert delivery
    const { data: inserted, error: errIns } = await supabase
      .from("remote_capture_deliveries")
      .insert([{
        token,
        channel,
        recipient,
        status,
        error_message: errorMessage,
        user_id: req.userId || null,
        autoscuola_id: autoscuolaId,
      }])
      .select("id, token, channel, recipient, sent_at, status, error_message")
      .maybeSingle();
    if (errIns) return res.status(500).json({ ok: false, error: errIns.message });

    return res.json({ ok: true, delivery: inserted });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Errore interno" });
  }
}

function buildLinkFromReq(req, token) {
  // In produzione potrebbe esserci una FRONTEND_URL diversa; usa quella se presente
  const base = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}/acquisizione-remota?token=${encodeURIComponent(token)}`;
}

function formatItalianDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

module.exports = deliverHandler;
module.exports.buildLinkFromReq = buildLinkFromReq;
module.exports.formatItalianDate = formatItalianDate;
```

- [ ] **Step 2: Esegui il test, verifica passa il primo caso**

```bash
cd gestionale/backend
node --test tests/remoteCaptureDeliver.test.js
```

Atteso: 1 test passa (`# pass 1`, `# fail 0`).

- [ ] **Step 3: Registra l'endpoint in server.js**

Apri `gestionale/backend/src/server.js`. Cerca con grep la registrazione esistente di un endpoint remote-capture per trovare il punto di inserimento:

```bash
grep -n "/api/remote-capture/sessions" gestionale/backend/src/server.js
```

Subito DOPO la registrazione di `app.get("/api/remote-capture/sessions/:token", ...)` (intorno alla riga 739), aggiungi:

```javascript
const remoteCaptureDeliverHandler = require("./server/remoteCaptureDeliverHandler");
app.post("/api/remote-capture/sessions/:token/deliver", requireAuth, remoteCaptureDeliverHandler);
```

(Se `requireAuth` non è già importato in cima al file, verifica con `grep -n "requireAuth" gestionale/backend/src/server.js | head -3`. Se manca, importalo dal modulo già usato per gli altri endpoint protetti — ispeziona uno degli `app.post(..., requireAuth, ...)` esistenti per copiare il pattern di import.)

- [ ] **Step 4: Riavvia il backend e fai smoke test manuale**

```bash
cd gestionale/backend
# Se è già in esecuzione, fermalo (Ctrl+C nella sua finestra o taskkill /F /IM node.exe)
node src/server.js
```

In un'altra shell:

```bash
curl -i -X POST http://localhost:3000/api/remote-capture/sessions/fake-token/deliver \
  -H "Content-Type: application/json" \
  -d '{"channel":"email","recipient":"test@example.com"}'
```

Atteso: `HTTP/1.1 401 Unauthorized` (perché manca header JWT). Questo conferma che l'endpoint è registrato e protetto.

- [ ] **Step 5: Commit**

```bash
git add gestionale/backend/src/server/remoteCaptureDeliverHandler.js gestionale/backend/src/server.js
git commit -m "feat(p1): endpoint POST /api/remote-capture/sessions/:token/deliver

Handler estratto in modulo dedicato per testabilità isolata.
Valida tenant + token (404/403/410) + channel + recipient (400),
invia per email tramite notificheService (Brevo), per WhatsApp solo
logging (apertura wa.me lato client). Errori Brevo → status='failed'
ma 200 al frontend (non 500)."
```

---

## Task 6: Backend — Test edge cases (8 casi addizionali)

**Files:**
- Modify: `gestionale/backend/tests/remoteCaptureDeliver.test.js`

- [ ] **Step 1: Aggiungi gli 8 test edge case**

In fondo al `describe(...)` block del test file, prima della `})` di chiusura, aggiungi:

```javascript
  it("token scaduto → 410 Gone", async () => {
    mockSession = {
      token: "tok-expired",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-expired/deliver", {
      channel: "email", recipient: "test@example.com",
    });
    assert.equal(res.status, 410);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /scaduto/i);
    assert.equal(lastInsertedDelivery, null, "non deve insert in deliveries");
  });

  it("token tenant diverso → 403 Forbidden", async () => {
    mockSession = {
      token: "tok-other",
      expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: "ALTRO-tenant-uuid",
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-other/deliver", {
      channel: "email", recipient: "test@example.com",
    });
    assert.equal(res.status, 403);
    assert.equal(lastInsertedDelivery, null);
  });

  it("token inesistente → 404 Not Found", async () => {
    mockSession = null;
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-missing/deliver", {
      channel: "email", recipient: "test@example.com",
    });
    assert.equal(res.status, 404);
    assert.equal(lastInsertedDelivery, null);
  });

  it("channel non ammesso (sms) → 400", async () => {
    mockSession = {
      token: "tok-1", expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-1/deliver", {
      channel: "sms", recipient: "+39333",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /channel/i);
  });

  it("recipient vuoto → 400", async () => {
    mockSession = {
      token: "tok-1", expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-1/deliver", {
      channel: "email", recipient: "",
    });
    assert.equal(res.status, 400);
  });

  it("email malformata → 400", async () => {
    mockSession = {
      token: "tok-1", expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-1/deliver", {
      channel: "email", recipient: "non-una-email",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /email/i);
  });

  it("telefono malformato → 400", async () => {
    mockSession = {
      token: "tok-1", expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-1/deliver", {
      channel: "whatsapp", recipient: "abc123",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /telefono|phone/i);
  });

  it("Brevo throw → 200 con status=failed", async () => {
    mockSession = {
      token: "tok-1", expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    inviaShouldThrow = "Brevo rate limit exceeded";
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-1/deliver", {
      channel: "email", recipient: "test@example.com",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.delivery.status, "failed");
    assert.match(res.body.delivery.error_message, /Brevo rate limit/);
    assert.ok(lastInsertedDelivery, "deve insert in deliveries con status=failed");
    assert.equal(lastInsertedDelivery.status, "failed");
  });

  it("happy path whatsapp: niente chiamata Brevo, solo insert", async () => {
    mockSession = {
      token: "tok-wa", expires_at: new Date(Date.now() + 60000).toISOString(),
      autoscuola_id: mockTenantId,
    };
    const app = createTestApp();
    const res = await request(app, "POST", "/api/remote-capture/sessions/tok-wa/deliver", {
      channel: "whatsapp", recipient: "393331234567",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.delivery.channel, "whatsapp");
    assert.equal(res.body.delivery.status, "sent");
    assert.equal(inviaCalledWith, null, "Brevo non deve essere chiamato per WhatsApp");
    assert.ok(lastInsertedDelivery);
  });
```

- [ ] **Step 2: Esegui tutti i test**

```bash
cd gestionale/backend
node --test tests/remoteCaptureDeliver.test.js
```

Atteso: tutti i 9 test passano (`# pass 9`, `# fail 0`).

- [ ] **Step 3: Commit**

```bash
git add gestionale/backend/tests/remoteCaptureDeliver.test.js
git commit -m "test(p1): 8 edge case test per endpoint /deliver

Coperti: 410 token scaduto, 403 tenant mismatch, 404 inesistente,
400 channel/recipient/email/telefono invalidi, 200 + status=failed
quando Brevo throw, happy path WhatsApp (no Brevo)."
```

---

## Task 7: Frontend — Helper `cleanPhone()`

**Files:**
- Create: `gestionale/frontend/lib/phoneUtils.js`

- [ ] **Step 1: Crea il file con la funzione**

Crea `gestionale/frontend/lib/phoneUtils.js`:

```javascript
/**
 * Normalizza un numero di telefono italiano a formato canonico (solo cifre, prefisso 39).
 *
 * Esempi:
 *   "+39 333 1234567" → "393331234567"
 *   "00 39 333 1234567" → "393331234567"
 *   "333 1234567" → "393331234567"     (mobile italiano senza prefisso)
 *   "0941 123456" → "0941123456"        (fisso italiano senza prefisso → no prepend)
 *   "abc"          → null
 *   ""             → null
 *
 * @param {string} raw — input grezzo da utente
 * @returns {string|null} formato canonico (10-15 cifre) o null se invalido
 */
export function cleanPhone(raw) {
  let s = String(raw || "").replace(/[\s\-\.\(\)]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else if (/^3\d{8,9}$/.test(s)) s = "39" + s; // mobile IT bare
  return /^\d{10,15}$/.test(s) ? s : null;
}

/**
 * Validatore email base.
 */
export function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
```

- [ ] **Step 2: Smoke test inline (script Node temporaneo)**

```bash
cd gestionale/frontend
node --input-type=module -e "
import { cleanPhone, isValidEmail } from './lib/phoneUtils.js';
console.log('+39 333 1234567 →', cleanPhone('+39 333 1234567'));   // 393331234567
console.log('333 1234567 →', cleanPhone('333 1234567'));            // 393331234567
console.log('00 39 333 1234567 →', cleanPhone('00 39 333 1234567')); // 393331234567
console.log('abc →', cleanPhone('abc'));                            // null
console.log('email ok →', isValidEmail('a@b.it'));                   // true
console.log('email ko →', isValidEmail('not-email'));                // false
"
```

Atteso: i primi 3 stampano `393331234567`, quarto `null`, quinto `true`, sesto `false`.

- [ ] **Step 3: Commit**

```bash
git add gestionale/frontend/lib/phoneUtils.js
git commit -m "feat(p1): helper cleanPhone() + isValidEmail()

Utility riusabile per normalizzare telefoni IT a formato canonico
(prefisso 39, solo cifre, 10-15 caratteri totali) e validare email.
Usato da SendLinkPopover, riutilizzabile in P3/P4."
```

---

## Task 8: Frontend — Componente `SendLinkPopover` (skeleton + token)

**Files:**
- Create: `gestionale/frontend/lib/SendLinkPopover.js`

- [ ] **Step 1: Crea il file con scheletro popover + generazione token**

Crea `gestionale/frontend/lib/SendLinkPopover.js`:

```javascript
"use client";

/**
 * SendLinkPopover — popover ancorato per inviare il link acquisizione remota.
 * Genera un token (TTL 24h) on mount e mostra 2 canali: Email (Brevo) e WhatsApp (wa.me).
 *
 * Props:
 *   candidate: { id, cognome, nome, email, telefono, autoscuola_nome }
 *   onClose:   () => void
 *   onSent?:   (delivery) => void
 */
import { useEffect, useState, useCallback } from "react";
import { API_BASE, authHeaders } from "./authClient";
import { useToast } from "./ToastContext";
import { cleanPhone, isValidEmail } from "./phoneUtils";

const TTL_MINUTES = 1440; // 24h

export default function SendLinkPopover({ candidate, onClose, onSent }) {
  const toast = useToast();
  const [session, setSession] = useState(null);     // { token, link, expiresAt }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Genera token on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_BASE}/api/remote-capture/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ mode: "cie_mobile", expiresMinutes: TTL_MINUTES }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setSession({
          token: j.token,
          link: j.link,
          expiresAt: j.expiresAt || j.expires_at,
        });
      } catch (e) {
        if (!cancelled) setError(e.message || "Errore");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="absolute right-0 top-full mt-2 w-[360px] rounded-xl bg-white shadow-2xl ring-1 ring-violet-300 z-50 p-4 text-slate-800">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">📲 Invia link acquisizione</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
      </div>

      {loading && <div className="text-xs text-slate-500">Generazione token in corso…</div>}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-2">
          Errore: {error}
        </div>
      )}
      {session && (
        <>
          <div className="text-[10px] text-slate-500 mb-3">
            Token valido fino a {formatExpiry(session.expiresAt)}
          </div>
          <Channels
            candidate={candidate}
            session={session}
            toast={toast}
            onSent={onSent}
          />
          <CopyLink link={session.link} toast={toast} />
        </>
      )}
    </div>
  );
}

function formatExpiry(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

// Placeholder componenti (implementati nei Task 9, 10, 11)
function Channels({ candidate, session, toast, onSent }) {
  return <div className="text-xs text-slate-500">[canali da implementare]</div>;
}
function CopyLink({ link, toast }) {
  return null;
}
```

- [ ] **Step 2: Verifica che il file compili (Next.js dev server riavvio)**

```bash
cd gestionale/frontend
# Se dev server non in esecuzione: npm run dev (porta 3001)
# Verifica nei log Next.js che non ci siano errori di sintassi.
```

Atteso: nessun errore in console di Next.js. Il componente non è ancora usato da nessuna pagina, quindi non ci aspettiamo render. Solo controllo sintassi.

- [ ] **Step 3: Commit**

```bash
git add gestionale/frontend/lib/SendLinkPopover.js
git commit -m "feat(p1): SendLinkPopover skeleton + generazione token

Componente isolato che genera token TTL 24h on mount.
Layout popover ancorato, gestione loading/error.
I canali Email/WhatsApp e Copia link verranno completati nei task successivi."
```

---

## Task 9: Frontend — Canale Email nel popover

**Files:**
- Modify: `gestionale/frontend/lib/SendLinkPopover.js`

- [ ] **Step 1: Implementa il sub-component `Channels` con riga Email**

In `lib/SendLinkPopover.js` sostituisci la function `Channels` con:

```javascript
function Channels({ candidate, session, toast, onSent }) {
  const [email, setEmail] = useState(candidate?.email || "");
  const [emailDelivery, setEmailDelivery] = useState(null); // { sent_at } se inviata
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState(null);

  const sendEmail = useCallback(async () => {
    if (!isValidEmail(email)) {
      setEmailError("Email non valida");
      return;
    }
    setEmailSending(true);
    setEmailError(null);
    try {
      // Autosave su candidato (silente)
      if (email !== candidate.email) {
        fetch(`${API_BASE}/api/candidates/${candidate.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ email }),
        }).catch(() => {});
      }

      const r = await fetch(
        `${API_BASE}/api/remote-capture/sessions/${session.token}/deliver`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            channel: "email",
            recipient: email,
            candidateName: `${candidate?.nome || ""} ${candidate?.cognome || ""}`.trim() || "candidato",
          }),
        }
      );
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);

      if (j.delivery.status === "failed") {
        setEmailError(j.delivery.error_message || "Invio fallito");
        toast.error(`Email NON inviata: ${j.delivery.error_message || "errore"}`);
      } else {
        setEmailDelivery({ sent_at: j.delivery.sent_at });
        toast.success(`Email inviata a ${email}`);
        if (onSent) onSent(j.delivery);
      }
    } catch (e) {
      setEmailError(e.message);
      toast.error(`Errore: ${e.message}`);
    } finally {
      setEmailSending(false);
    }
  }, [email, candidate, session, toast, onSent]);

  const emailValid = isValidEmail(email);

  return (
    <div className="space-y-3">
      {/* Riga Email */}
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
          📧 Email
        </label>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
            placeholder="indirizzo@email.it"
            className={`flex-1 rounded border px-2 py-1 text-xs ${
              emailError ? "border-red-400" : "border-slate-300"
            }`}
            disabled={emailSending}
          />
          <button
            onClick={sendEmail}
            disabled={!emailValid || emailSending}
            className="rounded bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {emailSending ? "..." : (emailDelivery ? "↻ Reinvia" : "Invia")}
          </button>
        </div>
        {emailError && <div className="text-[10px] text-red-600">{emailError}</div>}
        {emailDelivery && (
          <div className="text-[10px] text-emerald-700">
            ✅ Inviata {formatTime(emailDelivery.sent_at)}
          </div>
        )}
      </div>

      {/* Placeholder WhatsApp (Task 10) */}
      <div className="text-[10px] text-slate-400">[WhatsApp da implementare]</div>
    </div>
  );
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}
```

- [ ] **Step 2: Smoke test rapido**

Dato che il componente non è ancora wired in `/candidati`, faccio un test temporaneo. Crea un file di prova (poi lo cancelli):

```bash
cat > "/c/Users/bluef/booking-engine/gestionale/frontend/app/test-popover/page.js" <<'EOF'
"use client";
import SendLinkPopover from "../../lib/SendLinkPopover";
export default function TestPopoverPage() {
  return (
    <div className="p-8 relative inline-block">
      <button className="bg-violet-600 px-4 py-2 text-white rounded">📲 Invia link</button>
      <SendLinkPopover
        candidate={{ id: "test-id", nome: "Mario", cognome: "Rossi", email: "test@example.com", telefono: "+39 333 1234567" }}
        onClose={() => alert("close")}
      />
    </div>
  );
}
EOF
mkdir -p "/c/Users/bluef/booking-engine/gestionale/frontend/app/test-popover"
```

(Comando bash unico che crea cartella e file. Se la cartella non esiste, prima `mkdir -p`.)

Apri `http://localhost:3001/test-popover` nel browser. Dovresti vedere:
- Il pulsante violetto
- Sotto, il popover con loading → poi token generato → riga Email pre-popolata "test@example.com" + bottone "Invia"

Click "Invia": atteso toast verde "Email inviata a test@example.com" + label "✅ Inviata DD/MM HH:MM". Se Brevo non è configurato (BREVO_API_KEY mancante), vedrai un toast rosso con l'errore — è atteso.

- [ ] **Step 3: Cancella la pagina di test**

```bash
rm -rf "/c/Users/bluef/booking-engine/gestionale/frontend/app/test-popover"
```

- [ ] **Step 4: Commit**

```bash
git add gestionale/frontend/lib/SendLinkPopover.js
git commit -m "feat(p1): canale Email nel SendLinkPopover

Input email pre-popolata con autosave silente su candidato.
Validation regex, button disabled se invalido. Delivery via
endpoint /deliver, toast feedback, label timestamp.
Gestisce status='failed' (Brevo error) mostrando l'errore inline."
```

---

## Task 10: Frontend — Canale WhatsApp nel popover

**Files:**
- Modify: `gestionale/frontend/lib/SendLinkPopover.js`

- [ ] **Step 1: Aggiungi sub-section WhatsApp dopo la sezione Email**

In `lib/SendLinkPopover.js`, all'interno del `Channels` component, sostituisci il placeholder `<div className="text-[10px] text-slate-400">[WhatsApp da implementare]</div>` con:

```javascript
      {/* Riga WhatsApp */}
      <WhatsAppRow
        candidate={candidate}
        session={session}
        toast={toast}
        onSent={onSent}
      />
```

E aggiungi questa nuova function in fondo al file (dopo `formatTime`):

```javascript
function WhatsAppRow({ candidate, session, toast, onSent }) {
  const [phoneRaw, setPhoneRaw] = useState(candidate?.telefono || "");
  const [waDelivery, setWaDelivery] = useState(null);
  const [waOpening, setWaOpening] = useState(false);

  const cleaned = cleanPhone(phoneRaw);
  const isValid = !!cleaned;

  const openWhatsApp = useCallback(async () => {
    if (!cleaned) return;
    setWaOpening(true);

    // Autosave telefono su candidato (silente)
    if (phoneRaw !== candidate.telefono) {
      fetch(`${API_BASE}/api/candidates/${candidate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ telefono: phoneRaw }),
      }).catch(() => {});
    }

    // Costruisci messaggio WhatsApp (template hardcoded — duplicato dal backend per semplicità)
    const nome = (candidate?.nome || "").trim() || "ciao";
    const autoscuola = candidate?.autoscuola_nome || "La tua autoscuola";
    const text = `Ciao ${nome}! 👋\n${autoscuola} ti chiede foto, firma e documenti per la pratica.\nCarica tutto dal telefono qui (bastano 5 minuti):\n${session.link}`;
    const waUrl = `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");

    // Logging in deliveries (non bloccante)
    try {
      const r = await fetch(
        `${API_BASE}/api/remote-capture/sessions/${session.token}/deliver`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            channel: "whatsapp",
            recipient: cleaned,
            candidateName: `${candidate?.nome || ""} ${candidate?.cognome || ""}`.trim() || "candidato",
          }),
        }
      );
      const j = await r.json();
      if (r.ok && j.ok) {
        setWaDelivery({ sent_at: j.delivery.sent_at });
        toast.info(`Aperto WhatsApp per ${cleaned}`);
        if (onSent) onSent(j.delivery);
      }
    } catch (_) {
      // Logging silente: l'apertura wa.me è già avvenuta, l'utente vede comunque il risultato
    } finally {
      setWaOpening(false);
    }
  }, [cleaned, phoneRaw, candidate, session, toast, onSent]);

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
        💬 WhatsApp
      </label>
      <div className="flex gap-2">
        <input
          type="tel"
          value={phoneRaw}
          onChange={(e) => setPhoneRaw(e.target.value)}
          placeholder="+39 333 1234567"
          className={`flex-1 rounded border px-2 py-1 text-xs ${isValid || !phoneRaw ? "border-slate-300" : "border-red-400"}`}
          disabled={waOpening}
        />
        <button
          onClick={openWhatsApp}
          disabled={!isValid || waOpening}
          title={isValid ? "Apri WhatsApp con messaggio precompilato" : "Telefono non valido (atteso es. +39 333 1234567)"}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {waOpening ? "..." : (waDelivery ? "↻ Riapri" : "Apri WA")}
        </button>
      </div>
      {!isValid && phoneRaw && (
        <div className="text-[10px] text-red-600">
          Numero non valido. Atteso es. +39 333 1234567
        </div>
      )}
      {waDelivery && (
        <div className="text-[10px] text-emerald-700">
          📂 Aperto WA {formatTime(waDelivery.sent_at)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Smoke test browser (riusa pattern Task 9)**

Ripeti il test con la pagina `/test-popover` (ricreala se l'hai cancellata) e verifica:
- Telefono `+39 333 1234567` → bottone "Apri WA" attivo
- Click → si apre nuova tab `wa.me/393331234567?text=...`
- Toast info "Aperto WhatsApp per 393331234567"
- Telefono `abc` → bottone disabled, messaggio rosso

Cancella la pagina di test alla fine.

- [ ] **Step 3: Commit**

```bash
git add gestionale/frontend/lib/SendLinkPopover.js
git commit -m "feat(p1): canale WhatsApp con wa.me click

Input telefono normalizzato via cleanPhone(), bottone disabilitato
se invalido. Click apre wa.me in nuova tab con messaggio
precompilato (template hardcoded duplicato dal backend), poi
log silente in /deliver per tracking. Toast info di conferma."
```

---

## Task 11: Frontend — Bottone "Copia link" nel popover

**Files:**
- Modify: `gestionale/frontend/lib/SendLinkPopover.js`

- [ ] **Step 1: Sostituisci la function `CopyLink`**

In `lib/SendLinkPopover.js` sostituisci la function `CopyLink` placeholder con:

```javascript
function CopyLink({ link, toast }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiato negli appunti");
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      toast.error("Impossibile copiare il link");
    }
  }, [link, toast]);

  return (
    <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
      <div className="text-[11px] font-semibold text-slate-700">🔗 Link diretto</div>
      <div className="flex gap-2 items-center">
        <code className="flex-1 truncate text-[10px] text-slate-600 bg-slate-100 px-2 py-1 rounded">
          {link}
        </code>
        <button
          onClick={handleCopy}
          className="rounded bg-slate-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-700"
        >
          {copied ? "✓ Copiato" : "📋 Copia"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifica nel browser (test temporaneo già usato)**

Riapri `/test-popover` → click "📋 Copia" → toast verde "Link copiato negli appunti" + bottone diventa "✓ Copiato" per 2 secondi → puoi incollare il link in un'altra app per verifica.

- [ ] **Step 3: Cancella la pagina di test (definitivamente)**

```bash
rm -rf "/c/Users/bluef/booking-engine/gestionale/frontend/app/test-popover"
```

- [ ] **Step 4: Commit**

```bash
git add gestionale/frontend/lib/SendLinkPopover.js
git commit -m "feat(p1): bottone Copia link nel SendLinkPopover

Fallback universale per copiare URL completo negli appunti via
navigator.clipboard. Feedback visivo con toast + cambio temporaneo
del label del bottone in '✓ Copiato' per 2s."
```

---

## Task 12: Frontend — Wire pulsante in `/candidati`

**Files:**
- Modify: `gestionale/frontend/app/candidati/page.js`

- [ ] **Step 1: Localizza il punto di inserimento**

Apri `gestionale/frontend/app/candidati/page.js` e cerca i pulsanti "Scanner" / "Portale" / "C.I. digitale" nella sidebar destra:

```bash
grep -n 'C.I. digitale\|acquisizione-remota\|"Portale"' gestionale/frontend/app/candidati/page.js | head -5
```

Atteso: 1-2 righe intorno a 1340 con `<Link href="/acquisizione-remota">Portale</Link>` e `<Link href="/acquisizione-remota?tipo=cie">C.I. digitale</Link>`.

- [ ] **Step 2: Aggiungi import**

In cima al file `app/candidati/page.js`, dopo gli altri import, aggiungi:

```javascript
import SendLinkPopover from "../../lib/SendLinkPopover";
```

(Verifica il path relativo: da `app/candidati/page.js` a `lib/` sono 2 livelli sopra.)

- [ ] **Step 3: Aggiungi state per popover**

All'interno del componente principale di pagina (cerca `export default function` o `function CandidatiPage` o equivalente), aggiungi vicino agli altri `useState`:

```javascript
const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
```

- [ ] **Step 4: Aggiungi il pulsante nella sidebar**

Subito DOPO la riga del Link "C.I. digitale" (riga ~1341), aggiungi un wrapper div con il bottone e il popover ancorato:

```javascript
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLinkPopoverOpen((v) => !v)}
                  className="rounded bg-violet-600 px-1.5 py-1 text-[9px] font-semibold text-white hover:bg-violet-700 w-full"
                  title="Genera link e invia al candidato via Email o WhatsApp"
                >
                  📲 Invia link
                </button>
                {linkPopoverOpen && editor && (
                  <SendLinkPopover
                    candidate={{
                      id: editor.id,
                      cognome: editor.cognome,
                      nome: editor.nome,
                      email: editor.email,
                      telefono: editor.telefono,
                      autoscuola_nome: editor.autoscuola_nome || "Autoscuola",
                    }}
                    onClose={() => setLinkPopoverOpen(false)}
                  />
                )}
              </div>
```

(NOTA: il riferimento `editor` è la variabile usata già negli altri pulsanti adiacenti nella sidebar — verifica grep per il nome esatto: `grep -n "editor.id\|editor.cognome" gestionale/frontend/app/candidati/page.js | head -3`. Se il nome è diverso, sostituisci `editor` con il nome corretto.)

- [ ] **Step 5: Smoke test integrato**

```bash
cd gestionale/frontend
# Se non in esecuzione: npm run dev
```

Apri http://localhost:3001/candidati → seleziona un candidato → cerca il pulsante "📲 Invia link" nella sidebar destra → click. Atteso:
- Popover appare ancorato al pulsante
- Token generato in <2s
- Email pre-popolata se candidato ce l'ha
- Telefono pre-popolato se candidato ce l'ha
- Tutti i bottoni funzionano

Click fuori popover NON lo chiude (è lo stato locale, va chiuso col ×). Questo è OK per ora — implementabile in un futuro task.

- [ ] **Step 6: Commit**

```bash
git add gestionale/frontend/app/candidati/page.js
git commit -m "feat(p1): pulsante 'Invia link' integrato in /candidati

Affiancato a Scanner/Portale/CI digitale nella sidebar destra del
candidato selezionato. Click toggle popover SendLinkPopover ancorato.
Pre-popola email e telefono dal candidato corrente."
```

---

## Task 13: Smoke test manuale completo + commit finale

**Files:**
- Nessuno (solo verifica)

- [ ] **Step 1: Esegui la checklist 8-step della spec**

Apri http://localhost:3001/candidati e per ognuno di questi punti spunta o fixa al volo:

1. ☐ Click 📲 Invia link su candidato con email+tel → popover appare con TTL = ora+24h
2. ☐ Email pre-popolata, modifico + perdo focus → in DB il candidato ha la nuova email (verifica con query Supabase)
3. ☐ Click [Invia] → toast verde + label "Inviata HH:MM"
4. ☐ Click [Apri WA] → tab nuova su wa.me + label "Aperto WA"
5. ☐ Refresh pagina → popover non persiste, ma i delivery sì in DB (query: `SELECT * FROM remote_capture_deliveries ORDER BY sent_at DESC LIMIT 5`)
6. ☐ Candidato senza email → popover chiede di aggiungerla, autosave funziona
7. ☐ Token scaduto (manuale: SQL `UPDATE remote_capture_sessions SET expires_at = now() - interval '1 day' WHERE token = '...'`) → click [Invia] → vedo errore "Token scaduto"
8. ☐ Brevo simulated failure (env BREVO_API_KEY temporaneamente errata) → vedo errore "❌ <messaggio>" + retry funziona

- [ ] **Step 2: Esegui suite test completa backend**

```bash
cd gestionale/backend
npm test
```

Atteso: tutti i test passano, inclusi i nuovi `notificheServiceTemplate.test.js` (4) e `remoteCaptureDeliver.test.js` (9).

- [ ] **Step 3: Commit finale (eventuali fix dello smoke test)**

Se durante lo smoke test hai dovuto fixare qualcosa, committa con:

```bash
git add -p   # interattivo per scegliere cosa
git commit -m "fix(p1): correzioni emerse dallo smoke test manuale"
```

Altrimenti salta.

- [ ] **Step 4: Tag della feature completata**

```bash
git tag -a "p1-link-delivery-complete" -m "P1 Link delivery candidato completato e testato (spec+plan superpowers)"
```

(NB: questo è un tag locale, non viene pushato finché non fai `git push --tags`.)

---

## Checklist post-implementazione

- [ ] Backend test suite verde (`npm test`)
- [ ] Migration SQL applicata in Supabase prod (verifica `information_schema.columns`)
- [ ] Smoke test manuale 8/8 verde
- [ ] Frontend build pulita (no warning Next.js in `npm run build`)
- [ ] Spec aggiornata con eventuali deviazioni del plan (se ci sono state)
- [ ] Commit history pulito (1 commit per task, messaggi descrittivi)

## Note di esecuzione

- **Idempotenza**: Tutti i Task 1, 2, 4 sono idempotenti (re-eseguibili senza danno). Task 5 modifica `server.js` — se qualcosa va storto, basta rimuovere le 2 righe aggiunte in Step 3.
- **Rollback rapido**: Se P1 va in produzione e dobbiamo disabilitarlo, basta nascondere il pulsante in `/candidati` (1 commit revert). Endpoint e tabella restano (innocui).
- **No breaking changes**: Tutto il codice è additivo. Nessun endpoint o tabella esistente viene modificata.
