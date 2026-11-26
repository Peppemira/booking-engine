/**
 * Route commissioni PagoPA — /api/billing/...
 * Il webhook Stripe (/api/billing/webhook) è montato a parte in server.js
 * perché ha bisogno del body grezzo per la verifica della firma.
 */

const express = require("express");
const { requireAuth } = require("../server/auth");
const billing = require("../services/billing/billingService");

const router = express.Router();

function wrap(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json({ success: true, ...(out && typeof out === "object" && !Array.isArray(out) ? out : { data: out }) });
    } catch (e) {
      const status = Number(e.status) || 500;
      if (status >= 500) console.warn("[Billing]", req.method, req.originalUrl, e.message);
      if (!res.headersSent) res.status(status).json({ success: false, error: e.message });
    }
  };
}

async function requireBillingAdmin(req, res, next) {
  try {
    const a = await billing.getAutoscuola(req.autoscuolaId);
    if (!billing.isAdmin(a, req.auth?.email)) {
      return res.status(403).json({ success: false, error: "Riservato all'amministratore della piattaforma" });
    }
    return next();
  } catch (e) {
    return res.status(Number(e.status) || 500).json({ success: false, error: e.message });
  }
}

// ── Autoscuola ──────────────────────────────────────────────────────────────
router.get("/stato", requireAuth, wrap((req) => billing.getStato(req.autoscuolaId)));
router.put("/dati-fiscali", requireAuth, wrap((req) => billing.salvaDatiFiscali(req.autoscuolaId, req.body || {})));
router.post("/attiva", requireAuth, wrap((req) => billing.avviaAttivazione(req.autoscuolaId)));
router.post("/portale-pagamento", requireAuth, wrap((req) => billing.portalePagamento(req.autoscuolaId)));
router.get("/fatture", requireAuth, wrap(async (req) => ({ fatture: await billing.listaFatture(req.autoscuolaId) })));
router.get("/controllo", requireAuth, wrap((req) => billing.controlloPreventivo(req.autoscuolaId)));

// Registrazione esplicita di un PagoPA da altri flussi (es. pagamento IUV futuro).
router.post("/pagopa-eventi", requireAuth, wrap(async (req) => {
  const identificativo = String(req.body?.identificativo || "").trim();
  if (!identificativo) {
    const err = new Error("identificativo obbligatorio");
    err.status = 400;
    throw err;
  }
  const check = await billing.controlloPreventivo(req.autoscuolaId);
  if (!check.consentito) {
    const err = new Error(check.motivo);
    err.status = 402;
    throw err;
  }
  return billing.registraPagoPA({
    autoscuolaId: req.autoscuolaId,
    identificativo,
    praticaRef: req.body?.praticaRef || null,
  });
}));

// ── Amministratore BLUEFOX ──────────────────────────────────────────────────
router.get("/admin/autoscuole", requireAuth, requireBillingAdmin, wrap(async () => ({ autoscuole: await billing.adminElencoAutoscuole() })));
router.get("/admin/riepilogo", requireAuth, requireBillingAdmin, wrap((req) =>
  billing.adminRiepilogo({ settimane: Math.min(Math.max(Number(req.query.settimane) || 8, 1), 52) })
));
router.get("/admin/fatture-da-emettere", requireAuth, requireBillingAdmin, wrap(async () => ({ fatture: await billing.adminFattureDaEmettere() })));
router.post("/admin/autoscuole/:id/sblocca", requireAuth, requireBillingAdmin, wrap(async (req) => ({ autoscuola: await billing.adminSblocca(req.params.id) })));
router.post("/admin/autoscuole/:id/esente", requireAuth, requireBillingAdmin, wrap(async (req) => ({
  autoscuola: await billing.adminImpostaEsente(req.params.id, req.body?.esente !== false),
})));
router.post("/admin/fatture/:id/riemetti-sdi", requireAuth, requireBillingAdmin, wrap((req) => billing.adminRiemettiSdi(req.params.id)));
router.post("/admin/fatture/:id/segna-emessa", requireAuth, requireBillingAdmin, wrap((req) => billing.adminSegnaSdiManuale(req.params.id, req.body?.numero)));
router.post("/admin/pagopa-eventi/:id/storno", requireAuth, requireBillingAdmin, wrap((req) => billing.stornaPagoPA(req.params.id)));

/** Handler del webhook Stripe (usato in server.js con express.raw). */
async function stripeWebhookHandler(req, res) {
  try {
    const event = billing.verificaWebhook(req.body, req.headers["stripe-signature"]);
    const esito = await billing.gestisciEvento(event);
    return res.json({ received: true, ...esito });
  } catch (e) {
    const status = Number(e.status) || 500;
    console.warn("[Billing] webhook:", e.message);
    return res.status(status).json({ received: false, error: e.message });
  }
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
