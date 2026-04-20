"use strict";
/**
 * Test endpoint POST /api/remote-capture/sessions/:token/deliver.
 * Mocking inline di Supabase + notificheService via require.cache override.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");

// ── Stato mockable per ogni test ────────────────────────────────────────────
let mockSession = null;
let mockSessionError = null;
let lastInsertedDelivery = null;
let inviaCalledWith = null;
let inviaShouldThrow = null;
const mockTenantId = "tenant-A-uuid";

// Stub minimo del client Supabase
const supabaseStub = {
  from(_table) {
    const isDeliveryInsert = _table === "remote_capture_deliveries";
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

// Override require.cache PRIMA di require l'handler
const supabasePath = require.resolve("../src/database/supabase");
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: supabaseStub,
};

// Stub notificheService
const notificheStub = {
  notificheService: {
    invia: async (opts) => {
      inviaCalledWith = opts;
      if (inviaShouldThrow) throw new Error(inviaShouldThrow);
      return { success: true, esito: "inviata", provider: "brevo-stub" };
    },
  },
  TEMPLATES: { remote_capture_link: { subject: "x", html: () => "x", text: () => "x" } },
  getRemoteCaptureWhatsappText: () => "ciao test",
};
const notifichePath = require.resolve("../src/services/notificheService");
require.cache[notifichePath] = {
  id: notifichePath,
  filename: notifichePath,
  loaded: true,
  exports: notificheStub,
};

// Ora carica l'handler (usa gli stub)
const deliverHandler = require("../src/server/remoteCaptureDeliverHandler");
const express = require("express");

function createTestApp() {
  const app = express();
  app.use(express.json());
  // Inietta autoscuolaId fittizio (in prod lo fa requireAuth + attachAuthContext)
  app.use((req, _res, next) => { req.autoscuolaId = mockTenantId; next(); });
  app.post("/api/remote-capture/sessions/:token/deliver", deliverHandler);
  return app;
}

function request(app, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: urlPath,
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
});
