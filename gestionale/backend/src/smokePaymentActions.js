"use strict";

require("dotenv").config();

const API_BASE = process.env.API_BASE || "http://localhost:3001";

async function readJsonSafe(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), raw: text };
  } catch {
    return { json: null, raw: text };
  }
}

async function main() {
  const email = `qa.smoke.${Date.now()}@autoscuola.local`;
  const password = "Test1234!";

  const registerPayload = {
    nome: "QA Smoke",
    email,
    password,
    portal_user: "demo_user",
    portal_pass: "demo_pass",
    portal_pin: "1234",
  };

  const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registerPayload),
  });
  const registerData = await readJsonSafe(registerRes);

  if (!registerRes.ok || !registerData.json?.token) {
    throw new Error(
      `Register failed: status=${registerRes.status} body=${registerData.raw?.slice(0, 220) || ""}`
    );
  }

  const token = registerData.json.token;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const createRes = await fetch(`${API_BASE}/api/prenota-esame`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      nome: "Luca",
      cognome: "Bianchi",
      data: "2026-03-15",
      categoria: "B",
      ora: "10:00",
      luogo: "Milano",
    }),
  });
  const createData = await readJsonSafe(createRes);
  const bookingId = createData.json?.booking?.id;

  if (!createRes.ok || !bookingId) {
    throw new Error(
      `Create booking failed: status=${createRes.status} body=${createData.raw?.slice(0, 220) || ""}`
    );
  }

  let cleanupError = null;

  try {
    const legacyRes = await fetch(`${API_BASE}/api/prenotazioni/${bookingId}/payment-action`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "bollettino" }),
    });
    const legacyData = await readJsonSafe(legacyRes);

    if (legacyRes.status !== 400) {
      throw new Error(
        `Expected bollettino to be rejected with 400, got ${legacyRes.status}. body=${legacyData.raw?.slice(0, 220) || ""}`
      );
    }

    const pagopaRes = await fetch(`${API_BASE}/api/prenotazioni/${bookingId}/payment-action`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "pagopa" }),
    });
    const pagopaData = await readJsonSafe(pagopaRes);

    if (!pagopaRes.ok || !pagopaData.json?.success) {
      throw new Error(
        `Expected pagopa success, got status=${pagopaRes.status}. body=${pagopaData.raw?.slice(0, 220) || ""}`
      );
    }

    console.log("SMOKE_PAYMENT_ACTIONS_OK");
    console.log(`bookingId=${bookingId}`);
    console.log(`legacyStatus=${legacyRes.status}`);
    console.log(`pagopaStatus=${pagopaRes.status}`);
  } finally {
    const deleteRes = await fetch(`${API_BASE}/api/prenotazioni/${bookingId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!deleteRes.ok) {
      const deleteBody = await deleteRes.text();
      cleanupError = `Cleanup delete failed: status=${deleteRes.status} body=${deleteBody.slice(0, 220)}`;
    }
  }

  if (cleanupError) {
    throw new Error(cleanupError);
  }
}

main().catch((error) => {
  console.error("SMOKE_PAYMENT_ACTIONS_FAILED");
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
