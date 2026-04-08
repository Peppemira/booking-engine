/**
 * Test suite per il modulo auth (node:test).
 * Eseguire con: node --test tests/auth.test.js
 *
 * Testa le funzionalita' di autenticazione SENZA dipendere dal database reale.
 * Le chiamate Supabase vengono mockate inline.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = "test-secret-key-12345";

// ── Mock Supabase ────────────────────────────────────────────────────────────
// Intercept require per iniettare mock prima dell'import di auth.js
let mockSupabaseData = null;
let mockSupabaseError = null;
let lastInsertData = null;
let lastUpdateData = null;

const mockChain = {
  select: () => mockChain,
  eq: () => mockChain,
  ilike: () => mockChain,
  gte: () => mockChain,
  lte: () => mockChain,
  order: () => mockChain,
  limit: () => mockChain,
  range: () => mockChain,
  maybeSingle: () => Promise.resolve({ data: mockSupabaseData, error: mockSupabaseError }),
  single: () => Promise.resolve({ data: mockSupabaseData, error: mockSupabaseError }),
};

const mockInsertChain = {
  select: () => ({
    single: () => Promise.resolve({ data: mockSupabaseData, error: mockSupabaseError }),
  }),
};

const mockUpdateChain = {
  eq: function () { return this; },
  select: () => ({
    single: () => Promise.resolve({ data: mockSupabaseData, error: mockSupabaseError }),
  }),
};

const mockFrom = () => ({
  select: () => mockChain,
  insert: (data) => { lastInsertData = data; return mockInsertChain; },
  update: (data) => { lastUpdateData = data; return mockUpdateChain; },
  delete: () => mockChain,
});

// Override del modulo supabase
require.cache[require.resolve("../src/database/supabase")] = {
  id: require.resolve("../src/database/supabase"),
  filename: require.resolve("../src/database/supabase"),
  loaded: true,
  exports: { from: mockFrom },
};

// Ora importiamo l'auth con il mock
process.env.JWT_SECRET = JWT_SECRET;
process.env.MULTI_AUTOSCUOLA = "false";
process.env.AUTH_REQUIRED = "false";

const {
  attachAuthContext,
  requireAuth,
  registerAutoscuola,
  loginAutoscuola,
  requestPasswordReset,
  resetPassword,
} = require("../src/server/auth");

// ── Utility ──────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(attachAuthContext);
  app.post("/api/auth/register", registerAutoscuola);
  app.post("/api/auth/login", loginAutoscuola);
  app.post("/api/auth/request-reset", requestPasswordReset);
  app.post("/api/auth/reset-password", resetPassword);
  app.get("/api/auth/protected", requireAuth, (req, res) => {
    res.json({ ok: true, autoscuolaId: req.autoscuolaId });
  });
  return app;
}

function request(server, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe("Auth API", () => {
  let server;
  let app;

  before(() => {
    app = createApp();
    server = app.listen(0); // porta random
  });

  after(() => {
    server.close();
  });

  // ── Register ───────────────────────────────────────────────────────────

  describe("POST /api/auth/register", () => {
    it("rifiuta richiesta senza campi obbligatori", async () => {
      mockSupabaseData = null;
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/register", { nome: "Test" });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    it("registra una nuova autoscuola", async () => {
      // La funzione register prima cerca l'email (maybeSingle -> null = non esiste)
      // poi inserisce. Il mock semplice ritorna sempre lo stesso dato;
      // per questo test settiamo mockSupabaseData a null cosi' la prima
      // chiamata (check email) ritorna null, ma dobbiamo intercettare l'insert.
      // Workaround: l'insert ritorna tramite mockInsertChain -> single()
      // che legge mockSupabaseData al momento della chiamata.

      // Prepariamo il mock per restituire null (email non trovata),
      // poi cambiarlo in tempo per l'insert
      const fakeUser = { id: "uuid-1", nome: "Auto Test", email: "test@auto.it" };

      // Override temporaneo di maybeSingle per tornare null una volta
      let callCount = 0;
      const origMaybeSingle = mockChain.maybeSingle;
      mockChain.maybeSingle = () => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: mockSupabaseData, error: mockSupabaseError });
      };

      mockSupabaseData = fakeUser;
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/register", {
        nome: "Auto Test",
        email: "test@auto.it",
        password: "secret123",
      });

      // Ripristina
      mockChain.maybeSingle = origMaybeSingle;

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.token);

      // Verifica che il token JWT sia valido
      const decoded = jwt.verify(res.body.token, JWT_SECRET);
      assert.equal(decoded.autoscuolaId, "uuid-1");
      assert.equal(decoded.email, "test@auto.it");
    });
  });

  // ── Login ──────────────────────────────────────────────────────────────

  describe("POST /api/auth/login", () => {
    it("rifiuta login senza credenziali", async () => {
      const res = await request(server, "POST", "/api/auth/login", {});
      assert.equal(res.status, 400);
    });

    it("rifiuta login con password errata", async () => {
      const hash = await bcrypt.hash("correct-password", 10);
      mockSupabaseData = {
        id: "uuid-2",
        nome: "Auto",
        email: "a@b.it",
        password_hash: hash,
      };
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/login", {
        email: "a@b.it",
        password: "wrong-password",
      });
      assert.equal(res.status, 401);
    });

    it("accetta login con password corretta", async () => {
      const hash = await bcrypt.hash("mypassword", 10);
      mockSupabaseData = {
        id: "uuid-3",
        nome: "AutoOK",
        email: "ok@test.it",
        password_hash: hash,
        codice_autoscuola: "AS001",
      };
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/login", {
        email: "ok@test.it",
        password: "mypassword",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.token);
      assert.equal(res.body.autoscuola.codice_autoscuola, "AS001");
    });
  });

  // ── Token / Middleware ─────────────────────────────────────────────────

  describe("Middleware requireAuth", () => {
    it("blocca accesso senza token", async () => {
      const res = await request(server, "GET", "/api/auth/protected");
      assert.equal(res.status, 401);
    });

    it("permette accesso con token valido", async () => {
      const token = jwt.sign(
        { sub: "uuid-5", autoscuolaId: "uuid-5", email: "x@y.it", nome: "X" },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      const res = await request(server, "GET", "/api/auth/protected", null, {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.autoscuolaId, "uuid-5");
    });

    it("rifiuta token scaduto", async () => {
      const token = jwt.sign(
        { sub: "uuid-6", autoscuolaId: "uuid-6" },
        JWT_SECRET,
        { expiresIn: "-1s" }
      );

      const res = await request(server, "GET", "/api/auth/protected", null, {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(res.status, 401);
    });

    it("rifiuta token con secret errato", async () => {
      const token = jwt.sign({ sub: "uuid-7", autoscuolaId: "uuid-7" }, "wrong-secret");
      const res = await request(server, "GET", "/api/auth/protected", null, {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(res.status, 401);
    });
  });

  // ── Password Reset ─────────────────────────────────────────────────────

  describe("Password Reset Flow", () => {
    it("request-reset risponde 200 anche per email inesistente", async () => {
      mockSupabaseData = null;
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/request-reset", {
        email: "nonexistent@test.it",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });

    it("request-reset genera token per email valida", async () => {
      mockSupabaseData = { id: "uuid-10", nome: "Reset", email: "reset@test.it" };
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/request-reset", {
        email: "reset@test.it",
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.resetToken);

      // Il token deve essere un JWT valido
      const decoded = jwt.verify(res.body.resetToken, JWT_SECRET);
      assert.equal(decoded.purpose, "password-reset");
      assert.equal(decoded.autoscuolaId, "uuid-10");
    });

    it("reset-password rifiuta senza token", async () => {
      const res = await request(server, "POST", "/api/auth/reset-password", {
        newPassword: "newpass123",
      });
      assert.equal(res.status, 400);
    });

    it("reset-password rifiuta password troppo corta", async () => {
      const token = jwt.sign(
        { autoscuolaId: "uuid-10", purpose: "password-reset" },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      const res = await request(server, "POST", "/api/auth/reset-password", {
        token,
        newPassword: "abc",
      });
      assert.equal(res.status, 400);
    });

    it("reset-password rifiuta token con purpose errato", async () => {
      const token = jwt.sign(
        { autoscuolaId: "uuid-10", purpose: "other" },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      const res = await request(server, "POST", "/api/auth/reset-password", {
        token,
        newPassword: "newpassword123",
      });
      assert.equal(res.status, 400);
    });

    it("reset-password aggiorna la password con token valido", async () => {
      const resetToken = jwt.sign(
        { autoscuolaId: "uuid-10", purpose: "password-reset" },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      // Mock: autoscuola esiste con questo token
      mockSupabaseData = { id: "uuid-10", reset_token: resetToken };
      mockSupabaseError = null;

      const res = await request(server, "POST", "/api/auth/reset-password", {
        token: resetToken,
        newPassword: "newpassword123",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });
  });
});
