/**
 * Job periodici delle commissioni PagoPA (attivi solo con BILLING_ENABLED=true):
 * - ogni 10 minuti: reinvio a Stripe dei PagoPA non ancora inviati
 * - ogni ora: blocco delle autoscuole in sospeso oltre il periodo di tolleranza
 */

const cron = require("node-cron");
const billing = require("./billingService");

let started = false;

function startBillingJobs() {
  if (started) return;
  started = true;

  cron.schedule("*/10 * * * *", async () => {
    try {
      const r = await billing.reinviaPendenti();
      if (r.inviati || r.falliti) console.log(`[Billing] Reinvio eventi PagoPA: ${r.inviati} inviati, ${r.falliti} falliti`);
    } catch (e) {
      console.warn("[Billing] Reinvio eventi:", e.message);
    }
  });

  cron.schedule("7 * * * *", async () => {
    try {
      const r = await billing.aggiornaBlocchi();
      if (r.bloccate) console.log(`[Billing] Autoscuole bloccate per insoluto: ${r.bloccate}`);
    } catch (e) {
      console.warn("[Billing] Aggiornamento blocchi:", e.message);
    }
  });

  console.log("[Billing] Job commissioni PagoPA avviati");
}

module.exports = { startBillingJobs };
