/**
 * Test commissioni PagoPA (node:test) — senza database e senza Stripe reali.
 * Eseguire con: node --test tests/billing.test.js
 *
 * Simula il ciclo completo: attivazione, 10 PagoPA (con un doppione), chiusura
 * settimanale pagata, settimana non pagata (carta scarica), solleciti, blocco
 * dopo 7 giorni, pagamento e sblocco automatico, storno, controllo preventivo.
 */
"use strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || "test";
process.env.NODE_ENV = "test";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");

const billing = require("../src/services/billing/billingService");
const { getBillingConfig } = require("../src/services/billing/config");
const { buildFattureInCloudPayload } = require("../src/services/billing/sdiProvider");
const { normalizzaNumero } = require("../src/services/billing/avvisi");

// ── Mini Supabase in memoria ─────────────────────────────────────────────────
function createMemoryDb() {
  const tables = {};
  const table = (name) => (tables[name] = tables[name] || []);

  function builder(name) {
    const filters = [];
    let op = "select";
    let payload = null;
    let upsertOpts = null;
    let orderBy = null;
    let limitN = null;
    let wantRows = false;

    const apply = (rows) => rows.filter((r) => filters.every((f) => f(r)));

    function run() {
      const rows = table(name);
      if (op === "update") {
        const hit = apply(rows);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "delete") {
        const keep = rows.filter((r) => !filters.every((f) => f(r)));
        tables[name] = keep;
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const keys = String(upsertOpts?.onConflict || "id").split(",").map((s) => s.trim());
        const list = Array.isArray(payload) ? payload : [payload];
        const out = [];
        for (const p of list) {
          const existing = rows.find((r) => keys.every((k) => String(r[k]) === String(p[k])));
          if (existing) {
            if (upsertOpts?.ignoreDuplicates) continue;
            Object.assign(existing, p);
            out.push({ ...existing });
          } else {
            const row = {
              id: p.id || randomUUID(),
              created_at: new Date(clock.now).toISOString(),
              inviato_stripe: false,
              tentativi_invio: 0,
              stornato: false,
              stato_pagamento: "in_attesa",
              stato_sdi: "da_emettere",
              tentativi_falliti: 0,
              ...p,
            };
            rows.push(row);
            out.push({ ...row });
          }
        }
        return { data: out, error: null };
      }
      let res = apply(rows).map((r) => ({ ...r }));
      if (orderBy) {
        const { col, asc } = orderBy;
        res.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (limitN != null) res = res.slice(0, limitN);
      return { data: res, error: null };
    }

    const q = {
      select() { wantRows = true; return q; },
      update(p) { op = "update"; payload = p; return q; },
      delete() { op = "delete"; return q; },
      upsert(p, opts) { op = "upsert"; payload = p; upsertOpts = opts; return q; },
      insert(p) { op = "upsert"; payload = p; upsertOpts = { onConflict: "id" }; return q; },
      eq(c, v) { filters.push((r) => String(r[c]) === String(v)); return q; },
      lt(c, v) { filters.push((r) => r[c] < v); return q; },
      lte(c, v) { filters.push((r) => r[c] != null && r[c] <= v); return q; },
      gt(c, v) { filters.push((r) => r[c] > v); return q; },
      gte(c, v) { filters.push((r) => r[c] >= v); return q; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
      order(col, { ascending = true } = {}) { orderBy = { col, asc: ascending }; return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data || [])[0] || null, error: r.error }); },
      single() { const r = run(); return Promise.resolve({ data: (r.data || [])[0] || null, error: r.error }); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  }

  return { from: builder, tables, table };
}

// ── Stripe finto ─────────────────────────────────────────────────────────────
function createFakeStripe() {
  const calls = { meterEvents: [], adjustments: [], subscriptions: [], customers: [], checkout: [] };
  let failMeter = false;
  return {
    calls,
    setFailMeter(v) { failMeter = v; },
    billing: {
      meterEvents: {
        create: async (p) => {
          if (failMeter) throw new Error("rete non disponibile");
          if (calls.meterEvents.some((e) => e.identifier === p.identifier)) throw new Error("duplicato");
          calls.meterEvents.push(p);
          return { identifier: p.identifier };
        },
      },
      meterEventAdjustments: { create: async (p) => { calls.adjustments.push(p); return p; } },
    },
    customers: {
      create: async (p) => { const c = { id: `cus_${calls.customers.length + 1}`, ...p }; calls.customers.push(c); return c; },
      update: async (id, p) => ({ id, ...p }),
    },
    checkout: {
      sessions: { create: async (p) => { calls.checkout.push(p); return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" }; } },
    },
    setupIntents: { retrieve: async (id) => ({ id, payment_method: "pm_card_1" }) },
    subscriptions: { create: async (p) => { const s = { id: `sub_${calls.subscriptions.length + 1}`, ...p }; calls.subscriptions.push(s); return s; } },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.test/p" }) } },
  };
}

const clock = { now: new Date("2026-12-07T10:00:00+01:00").getTime() };

function setup(envOverrides = {}) {
  const db = createMemoryDb();
  const stripe = createFakeStripe();
  const avvisiInviati = [];
  const sdiChiamate = [];
  const config = getBillingConfig({
    BILLING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_PRICE_ID: "price_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    BILLING_TARIFFA_EURO: "1",
    BILLING_GIORNI_TOLLERANZA: "7",
    FRONTEND_ORIGIN: "https://gestionale.test",
    ...envOverrides,
  });
  billing._setDeps({
    db,
    stripe,
    config,
    now: () => new Date(clock.now),
    avvisi: { inviaAvviso: async (tipo, a, dati) => { avvisiInviati.push({ tipo, autoscuola: a.id, dati }); return {}; } },
    sdi: { emettiFattura: async (d) => { sdiChiamate.push(d); return { stato: "inviata", numero: `${sdiChiamate.length}/P`, providerId: "fic_1" }; } },
  });

  const id = randomUUID();
  db.table("autoscuole").push({
    id,
    nome: "Autoscuola Prova",
    email: "prova@autoscuola.test",
    telefono: "3331234567",
    ragione_sociale: "Autoscuola Prova srl",
    partita_iva: "01234567890",
    codice_sdi: "ABC1234",
    indirizzo: "Via Roma 1",
    cap: "98026",
    comune: "Nizza di Sicilia",
    provincia: "ME",
    is_admin: false,
    billing_esente: false,
    stato_billing: "non_attivo",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    billing_sospeso_dal: null,
  });
  return { db, stripe, avvisiInviati, sdiChiamate, id };
}

function invoice(id, customer, { quantity, totalCents, subtotalCents, status }) {
  return {
    id,
    customer,
    status,
    total: totalCents,
    subtotal: subtotalCents,
    subtotal_excluding_tax: subtotalCents,
    hosted_invoice_url: `https://invoice.stripe.test/${id}`,
    lines: { data: [{ quantity, period: { start: 1764543600, end: 1765148400 } }] },
  };
}

async function evento(type, object, id = `evt_${randomUUID()}`) {
  return billing.gestisciEvento({ id, type, data: { object } });
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe("config", () => {
  it("è spento di default", () => {
    assert.equal(getBillingConfig({}).enabled, false);
    assert.equal(getBillingConfig({}).momentoFattura, "dopo_incasso");
  });
});

describe("billing spento", () => {
  beforeEach(() => setup({ BILLING_ENABLED: "false" }));
  it("non blocca e non conta nulla", async () => {
    const check = await billing.controlloPreventivo(randomUUID());
    assert.equal(check.consentito, true);
    const r = await billing.registraPagoPA({ autoscuolaId: randomUUID(), identificativo: "x" });
    assert.equal(r.registrato, false);
    assert.equal(r.motivo, "billing_disattivato");
  });
});

describe("ciclo completo delle commissioni", () => {
  it("attivazione, conteggio, fattura, insoluto, blocco e sblocco", async () => {
    const { db, stripe, avvisiInviati, sdiChiamate, id } = setup();

    // 1. Senza attivazione i nuovi PagoPA sono bloccati
    let check = await billing.controlloPreventivo(id);
    assert.equal(check.consentito, false);
    assert.equal(check.codice, "billing_non_attivo");

    // 2. Attivazione: cliente Stripe + checkout in modalità setup
    const att = await billing.avviaAttivazione(id);
    assert.match(att.url, /checkout\.stripe\.test/);
    assert.equal(stripe.calls.checkout[0].mode, "setup");
    assert.deepEqual(stripe.calls.checkout[0].payment_method_types, ["card", "sepa_debit"]);
    const customerId = db.table("autoscuole")[0].stripe_customer_id;
    assert.equal(customerId, "cus_1");

    // 3. Webhook checkout completato → abbonamento settimanale
    await evento("checkout.session.completed", {
      mode: "setup", customer: customerId, setup_intent: "seti_1", metadata: { autoscuola_id: id },
    });
    assert.equal(stripe.calls.subscriptions.length, 1);
    assert.equal(stripe.calls.subscriptions[0].default_payment_method, "pm_card_1");
    assert.equal(db.table("autoscuole")[0].stato_billing, "attiva");
    check = await billing.controlloPreventivo(id);
    assert.equal(check.consentito, true);

    // 4. Dieci PagoPA, più un doppione che non deve essere contato
    for (let i = 1; i <= 10; i += 1) {
      const r = await billing.registraPagoPA({ autoscuolaId: id, identificativo: `prenotazione:${i}` });
      assert.equal(r.registrato, true);
      assert.equal(r.inviatoStripe, true);
    }
    const doppione = await billing.registraPagoPA({ autoscuolaId: id, identificativo: "prenotazione:3" });
    assert.equal(doppione.motivo, "gia_contato");
    assert.equal(stripe.calls.meterEvents.length, 10);
    assert.equal(stripe.calls.meterEvents[0].payload.stripe_customer_id, customerId);

    const stato = await billing.getStato(id);
    assert.equal(stato.pagopaSettimana, 10);
    assert.equal(stato.maturatoSettimanaEuro, 10);

    // 5. Chiusura settimanale pagata → fattura SDI emessa
    const inv1 = invoice("in_1", customerId, { quantity: 10, subtotalCents: 1000, totalCents: 1220, status: "paid" });
    await evento("invoice.finalized", inv1);
    await evento("invoice.paid", inv1);
    let f1 = db.table("fatture_piattaforma").find((f) => f.stripe_invoice_id === "in_1");
    assert.equal(f1.stato_pagamento, "pagata");
    assert.equal(f1.numero_pagopa, 10);
    assert.equal(f1.imponibile, 10);
    assert.equal(f1.iva, 2.2);
    assert.equal(f1.stato_sdi, "inviata");
    assert.equal(sdiChiamate.length, 1);
    assert.equal(sdiChiamate[0].pagata, true);

    // Webhook ripetuto dallo stesso evento: nessun effetto doppio
    await evento("invoice.paid", inv1, "evt_dup");
    const dup = await evento("invoice.paid", inv1, "evt_dup");
    assert.equal(dup.duplicato, true);
    assert.equal(sdiChiamate.length, 1);

    // 6. Settimana dopo: carta scarica
    const inv2 = invoice("in_2", customerId, { quantity: 4, subtotalCents: 400, totalCents: 488, status: "open" });
    await evento("invoice.payment_failed", inv2);
    assert.equal(db.table("autoscuole")[0].stato_billing, "in_sospeso");
    assert.equal(avvisiInviati.at(-1).tipo, "pagamento_fallito");
    assert.equal(avvisiInviati.at(-1).dati.link, "https://invoice.stripe.test/in_2");
    check = await billing.controlloPreventivo(id);
    assert.equal(check.consentito, true, "durante la tolleranza si lavora ancora");

    // Secondo tentativo fallito: contatore aggiornato, data di sospensione invariata
    const sospesoDal = db.table("autoscuole")[0].billing_sospeso_dal;
    await evento("invoice.payment_failed", inv2);
    const f2 = db.table("fatture_piattaforma").find((f) => f.stripe_invoice_id === "in_2");
    assert.equal(f2.tentativi_falliti, 2);
    assert.equal(db.table("autoscuole")[0].billing_sospeso_dal, sospesoDal);

    // 7. Dopo 3 giorni non si blocca ancora, dopo 8 sì
    clock.now += 3 * 24 * 3600 * 1000;
    assert.equal((await billing.aggiornaBlocchi()).bloccate, 0);
    clock.now += 5 * 24 * 3600 * 1000;
    assert.equal((await billing.aggiornaBlocchi()).bloccate, 1);
    assert.equal(db.table("autoscuole")[0].stato_billing, "bloccata");
    assert.equal(avvisiInviati.at(-1).tipo, "bloccata");
    check = await billing.controlloPreventivo(id);
    assert.equal(check.consentito, false);
    assert.equal(check.codice, "billing_bloccata");
    assert.equal(check.linkPagamento, "https://invoice.stripe.test/in_2");

    // 8. L'autoscuola ricarica e paga → sblocco automatico
    await evento("invoice.paid", { ...inv2, status: "paid" });
    assert.equal(db.table("autoscuole")[0].stato_billing, "attiva");
    assert.equal(db.table("autoscuole")[0].billing_sospeso_dal, null);
    assert.equal(avvisiInviati.at(-1).tipo, "riattivata");
    check = await billing.controlloPreventivo(id);
    assert.equal(check.consentito, true);
    assert.equal(sdiChiamate.length, 2);
  });

  it("le fatture a zero non vanno allo SDI", async () => {
    const { db, sdiChiamate, id } = setup();
    db.table("autoscuole")[0].stripe_customer_id = "cus_z";
    db.table("autoscuole")[0].stato_billing = "attiva";
    await evento("invoice.paid", invoice("in_0", "cus_z", { quantity: 0, subtotalCents: 0, totalCents: 0, status: "paid" }));
    assert.equal(sdiChiamate.length, 0);
    assert.equal(db.table("fatture_piattaforma")[0].stato_pagamento, "pagata");
  });

  it("con fattura prima dell'incasso la emette alla chiusura", async () => {
    const { db, sdiChiamate } = setup({ BILLING_FATTURA_MOMENTO: "prima_incasso" });
    db.table("autoscuole")[0].stripe_customer_id = "cus_p";
    db.table("autoscuole")[0].stato_billing = "attiva";
    const inv = invoice("in_p", "cus_p", { quantity: 2, subtotalCents: 200, totalCents: 244, status: "open" });
    await evento("invoice.finalized", inv);
    assert.equal(sdiChiamate.length, 1);
    assert.equal(sdiChiamate[0].pagata, false);
    await evento("invoice.paid", inv);
    assert.equal(sdiChiamate.length, 1, "nessuna seconda emissione");
  });
});

describe("robustezza", () => {
  it("se Stripe non risponde l'evento resta da inviare e il job lo recupera", async () => {
    const { db, stripe, id } = setup();
    db.table("autoscuole")[0].stripe_customer_id = "cus_r";
    db.table("autoscuole")[0].stato_billing = "attiva";
    stripe.setFailMeter(true);
    const r = await billing.registraPagoPA({ autoscuolaId: id, identificativo: "iuv-1" });
    assert.equal(r.registrato, true);
    assert.equal(r.inviatoStripe, false);
    assert.equal(db.table("pagopa_eventi")[0].inviato_stripe, false);

    stripe.setFailMeter(false);
    const job = await billing.reinviaPendenti();
    assert.equal(job.inviati, 1);
    assert.equal(db.table("pagopa_eventi")[0].inviato_stripe, true);
    assert.equal((await billing.reinviaPendenti()).inviati, 0);
  });

  it("le autoscuole esenti non vengono contate né bloccate", async () => {
    const { db, id } = setup();
    db.table("autoscuole")[0].billing_esente = true;
    assert.equal((await billing.controlloPreventivo(id)).consentito, true);
    assert.equal((await billing.registraPagoPA({ autoscuolaId: id, identificativo: "a" })).motivo, "esente");
  });

  it("lo storno annulla l'evento su Stripe", async () => {
    const { db, stripe, id } = setup();
    db.table("autoscuole")[0].stripe_customer_id = "cus_s";
    db.table("autoscuole")[0].stato_billing = "attiva";
    const r = await billing.registraPagoPA({ autoscuolaId: id, identificativo: "iuv-s" });
    const s = await billing.stornaPagoPA(r.id);
    assert.equal(s.stornato, true);
    assert.equal(stripe.calls.adjustments.length, 1);
    assert.equal(stripe.calls.adjustments[0].cancel.identifier, stripe.calls.meterEvents[0].identifier);
    assert.equal((await billing.getStato(id)).pagopaSettimana, 0);
    await assert.rejects(() => billing.stornaPagoPA(r.id), /già stornato/);
  });

  it("valida i dati fiscali", () => {
    assert.throws(() => billing.validaDatiFiscali({ partita_iva: "123" }), /Partita IVA/);
    assert.throws(() => billing.validaDatiFiscali({ codice_sdi: "12" }), /SDI/);
    const ok = billing.validaDatiFiscali({ partita_iva: "IT01234567890", codice_sdi: "abc1234", provincia: "me" });
    assert.equal(ok.partita_iva, "01234567890");
    assert.equal(ok.codice_sdi, "ABC1234");
    assert.equal(ok.provincia, "ME");
  });

  it("l'attivazione richiede i dati fiscali completi", async () => {
    const { db, id } = setup();
    db.table("autoscuole")[0].partita_iva = null;
    await assert.rejects(() => billing.avviaAttivazione(id), /dati di fatturazione/);
  });

  it("solo l'amministratore è admin", () => {
    setup({ BILLING_ADMIN_EMAILS: "bluefox.srl@gmail.com" });
    assert.equal(billing.isAdmin({ email: "bluefox.srl@gmail.com" }), true);
    assert.equal(billing.isAdmin({ email: "altra@scuola.it" }), false);
    assert.equal(billing.isAdmin({ email: "x@y.it", is_admin: true }), true);
  });
});

describe("helper", () => {
  it("normalizza i numeri per WhatsApp", () => {
    assert.equal(normalizzaNumero("348 4927204"), "393484927204");
    assert.equal(normalizzaNumero("+39 348 4927204"), "393484927204");
    assert.equal(normalizzaNumero(""), "");
  });

  it("costruisce la fattura per Fatture in Cloud", () => {
    const p = buildFattureInCloudPayload({
      cliente: { ragioneSociale: "Scuola srl", partitaIva: "01234567890", codiceSdi: "ABC1234" },
      numeroPagopa: 10, tariffaUnitaria: 1, totale: 12.2, pagata: true,
    }, { FIC_VAT_ID: "0" });
    assert.equal(p.data.e_invoice, true);
    assert.equal(p.data.items_list[0].qty, 10);
    assert.equal(p.data.payments_list[0].status, "paid");
    assert.equal(p.data.entity.ei_code, "ABC1234");
  });

  it("riepiloga la invoice Stripe", () => {
    const r = billing.riepilogoInvoice(invoice("in_x", "c", { quantity: 3, subtotalCents: 300, totalCents: 366 }));
    assert.deepEqual([r.numeroPagopa, r.imponibile, r.iva, r.totale], [3, 3, 0.66, 3.66]);
  });
});
