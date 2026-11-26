/**
 * Configurazione delle commissioni PagoPA della piattaforma.
 * Tutto è spento finché BILLING_ENABLED non è "true": il resto del gestionale
 * continua a funzionare esattamente come prima.
 */

function bool(value, fallback = false) {
  if (value == null || String(value).trim() === "") return fallback;
  return ["true", "1", "yes", "si", "sì"].includes(String(value).trim().toLowerCase());
}

function num(value, fallback) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function getBillingConfig(env = process.env) {
  return {
    enabled: bool(env.BILLING_ENABLED, false),
    // Se true, un'autoscuola senza carta/mandato attivo non può creare nuovi PagoPA.
    richiediAttivazione: bool(env.BILLING_RICHIEDI_ATTIVAZIONE, true),
    tariffaEuro: num(env.BILLING_TARIFFA_EURO, 1.0),
    aliquotaIva: num(env.BILLING_ALIQUOTA_IVA, 22),
    giorniTolleranza: num(env.BILLING_GIORNI_TOLLERANZA, 7),
    // "dopo_incasso" (default) oppure "prima_incasso": quando emettere la fattura SDI.
    momentoFattura: String(env.BILLING_FATTURA_MOMENTO || "dopo_incasso").trim().toLowerCase() === "prima_incasso"
      ? "prima_incasso"
      : "dopo_incasso",
    adminEmails: String(env.BILLING_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    stripeSecretKey: String(env.STRIPE_SECRET_KEY || "").trim(),
    stripeWebhookSecret: String(env.STRIPE_WEBHOOK_SECRET || "").trim(),
    stripePriceId: String(env.STRIPE_PRICE_ID || "").trim(),
    stripeTaxRateId: String(env.STRIPE_TAX_RATE_ID || "").trim(),
    meterEventName: String(env.STRIPE_METER_EVENT_NAME || "pagopa_usati").trim(),
    frontendOrigin: String(env.FRONTEND_PUBLIC_BASE || env.FRONTEND_ORIGIN || "http://localhost:3001").trim().replace(/\/$/, ""),
    sdiProvider: String(env.SDI_PROVIDER || "manuale").trim().toLowerCase(),
  };
}

module.exports = { getBillingConfig };
