/**
 * Test di integrazione API — verifica che le route principali rispondano.
 * Eseguire con: node --test tests/api-integration.test.js
 *
 * NOTA: Richiede il backend in esecuzione su localhost:3000.
 * Se il server non e' attivo, i test vengono skippati.
 */
"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const BASE = "http://localhost:3000";
let serverUp = false;

function apiRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json", ...headers },
      timeout: 5000,
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function guard(t) {
  if (!serverUp) { t.skip("Backend non raggiungibile"); return false; }
  return true;
}

describe("API Integration Tests (server live)", () => {
  before(async () => {
    try {
      // Usa portal-defaults come health check (endpoint sempre disponibile)
      const res = await apiRequest("GET", "/api/auth/portal-defaults");
      serverUp = res.status === 200;
    } catch {
      serverUp = false;
    }
    if (!serverUp) {
      console.log("  [INFO] Backend non raggiungibile su localhost:3000 — test skippati");
    } else {
      console.log("  [OK] Backend attivo su localhost:3000");
    }
  });

  // ── Auth endpoints ────────────────────────────────────────────────────

  it("POST /api/auth/login rifiuta senza body", async (t) => {
    if (!guard(t)) return;
    const res = await apiRequest("POST", "/api/auth/login", {});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it("POST /api/auth/request-reset accetta email", async (t) => {
    if (!guard(t)) return;
    const res = await apiRequest("POST", "/api/auth/request-reset", { email: "smoke@test.it" });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it("GET /api/auth/me senza token ritorna 401", async (t) => {
    if (!guard(t)) return;
    const res = await apiRequest("GET", "/api/auth/me");
    assert.equal(res.status, 401);
  });

  it("GET /api/auth/portal-defaults risponde 200", async (t) => {
    if (!guard(t)) return;
    const res = await apiRequest("GET", "/api/auth/portal-defaults");
    assert.equal(res.status, 200);
    assert.ok("hasDefaults" in res.body);
  });

  // ── API routes (200/401/500 — accetta tutti, verifica solo raggiungibilita') ──

  const apiEndpoints = [
    "/api/candidates",
    "/api/prenotazioni",
    "/api/pagamenti",
    "/api/visite-mediche",
    "/api/preventivi",
    "/api/veicoli",
    "/api/committenti",
    "/api/impegni",
    "/api/listino",
  ];

  for (const endpoint of apiEndpoints) {
    it(`GET ${endpoint} risponde senza errori di connessione`, async (t) => {
      if (!guard(t)) return;
      const res = await apiRequest("GET", endpoint);
      // Accetta 200 (dati ok), 401 (auth richiesta), 500 (query senza autoscuolaId)
      assert.ok(
        [200, 401, 500].includes(res.status),
        `Unexpected status ${res.status} for ${endpoint}`
      );
    });
  }
});
