#!/usr/bin/env node
/**
 * Configurazione una tantum di Stripe per le commissioni PagoPA.
 * Crea (se non esistono): meter "pagopa_usati", prodotto, prezzo settimanale a consumo
 * e aliquota IVA 22%. Stampa le variabili da mettere nel .env / su Railway.
 *
 * Uso:   STRIPE_SECRET_KEY=sk_test_... node scripts/billing-setup-stripe.js
 * Tariffa: BILLING_TARIFFA_EURO (default 1.00, IVA esclusa)
 */

require("dotenv").config({ quiet: true });
const Stripe = require("stripe");

async function main() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) {
    console.error("Imposta STRIPE_SECRET_KEY (usa la chiave di TEST sk_test_... per le prove).");
    process.exit(1);
  }
  const stripe = new Stripe(key);
  const eventName = String(process.env.STRIPE_METER_EVENT_NAME || "pagopa_usati").trim();
  const tariffa = Number(String(process.env.BILLING_TARIFFA_EURO || "1").replace(",", "."));
  const cents = Math.round(tariffa * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error("BILLING_TARIFFA_EURO non valida");

  // Meter
  const meters = await stripe.billing.meters.list({ limit: 100 });
  let meter = meters.data.find((m) => m.event_name === eventName && m.status === "active");
  if (!meter) {
    meter = await stripe.billing.meters.create({
      display_name: "PagoPA gestiti",
      event_name: eventName,
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    });
    console.log("Creato meter", meter.id);
  } else {
    console.log("Meter già presente", meter.id);
  }

  // Prodotto
  const products = await stripe.products.search({ query: "metadata['bluefox']:'commissioni_pagopa'" }).catch(() => ({ data: [] }));
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: "Commissione PagoPA piattaforma",
      description: "Commissione per ogni PagoPA gestito tramite la piattaforma",
      metadata: { bluefox: "commissioni_pagopa" },
    });
    console.log("Creato prodotto", product.id);
  }

  // Prezzo settimanale a consumo
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  let price = prices.data.find((p) =>
    p.unit_amount === cents && p.recurring?.interval === "week" && p.recurring?.meter === meter.id
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: cents,
      tax_behavior: "exclusive",
      recurring: { interval: "week", usage_type: "metered", meter: meter.id },
      nickname: `Commissione PagoPA ${tariffa.toFixed(2)} € / settimana`,
    });
    console.log("Creato prezzo", price.id);
  }

  // IVA 22%
  const rates = await stripe.taxRates.list({ active: true, limit: 100 });
  let rate = rates.data.find((r) => r.percentage === 22 && r.inclusive === false && r.country === "IT");
  if (!rate) {
    rate = await stripe.taxRates.create({
      display_name: "IVA",
      percentage: 22,
      inclusive: false,
      country: "IT",
      jurisdiction: "IT",
      description: "IVA ordinaria 22%",
    });
    console.log("Creata aliquota IVA", rate.id);
  }

  console.log("\nAggiungi queste variabili al backend (.env e Railway):\n");
  console.log(`STRIPE_METER_EVENT_NAME=${eventName}`);
  console.log(`STRIPE_PRICE_ID=${price.id}`);
  console.log(`STRIPE_TAX_RATE_ID=${rate.id}`);
  console.log(`BILLING_TARIFFA_EURO=${tariffa.toFixed(2)}`);
  console.log("\nPoi crea il webhook su Stripe verso https://<backend>/api/billing/webhook con gli eventi:");
  console.log("checkout.session.completed, invoice.finalized, invoice.paid, invoice.payment_failed, invoice.voided, customer.subscription.deleted");
  console.log("e copia la chiave di firma in STRIPE_WEBHOOK_SECRET.");
}

main().catch((e) => {
  console.error("Errore:", e.message);
  process.exit(1);
});
