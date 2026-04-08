"use strict";

require("dotenv").config();

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const AUTH_TOKEN = process.env.SMOKE_AUTH_TOKEN || "";

async function readTextSafe(res) {
  const text = await res.text();
  return text;
}

async function readJsonSafe(res) {
  const text = await readTextSafe(res);
  try {
    return { json: JSON.parse(text), raw: text };
  } catch {
    return { json: null, raw: text };
  }
}

function fail(message, code = 1) {
  console.error("SMOKE_PAYMENT_HISTORY_READONLY_FAILED");
  console.error(message);
  process.exit(code);
}

async function main() {
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthBody = await readTextSafe(healthRes);

  if (!healthRes.ok) {
    fail(`Health check failed: status=${healthRes.status} body=${healthBody.slice(0, 220)}`);
  }

  if (!AUTH_TOKEN) {
    fail("Missing SMOKE_AUTH_TOKEN env var. This read-only smoke test requires an existing Bearer token.", 2);
  }

  const authHeaders = {
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };

  const historyUrl = `${API_BASE}/api/import-history?type=payment-action&limit=50&action=pagopa`;
  const historyRes = await fetch(historyUrl, { headers: authHeaders });
  const historyData = await readJsonSafe(historyRes);

  if (!historyRes.ok || !historyData.json?.success || !Array.isArray(historyData.json?.history)) {
    fail(`History request failed: status=${historyRes.status} body=${historyData.raw.slice(0, 260)}`);
  }

  const legacyActionFound = historyData.json.history.some(
    (row) => String(row?.criteria?.action || "").toLowerCase() === "bollettino"
  );
  if (legacyActionFound) {
    fail("History contains legacy action 'bollettino' after normalization.");
  }

  const legacyMessageFound = historyData.json.history.some((row) => /\bbollettino\b/i.test(String(row?.message || "")));
  if (legacyMessageFound) {
    fail("History contains legacy message text 'bollettino' after normalization.");
  }

  const exportUrl = `${API_BASE}/api/import-history/export?type=payment-action&format=csv&action=pagopa`;
  const exportRes = await fetch(exportUrl, { headers: authHeaders });
  const csv = await readTextSafe(exportRes);

  if (!exportRes.ok) {
    fail(`CSV export failed: status=${exportRes.status} body=${csv.slice(0, 260)}`);
  }

  if (!csv.toLowerCase().includes("action")) {
    fail("CSV export does not contain expected header column 'action'.");
  }

  if (/\bbollettino\b/i.test(csv)) {
    fail("CSV export still contains legacy text 'bollettino'.");
  }

  console.log("SMOKE_PAYMENT_HISTORY_READONLY_OK");
  console.log(`historyRows=${historyData.json.history.length}`);
  console.log(`healthStatus=${healthRes.status}`);
  console.log(`historyStatus=${historyRes.status}`);
  console.log(`exportStatus=${exportRes.status}`);
}

main().catch((error) => {
  fail(error?.stack || error?.message || String(error));
});
