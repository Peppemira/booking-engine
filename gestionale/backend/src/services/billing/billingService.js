/**
 * BillingService — commissioni PagoPA della piattaforma (docs/commissioni-pagopa.md).
 *
 * - conteggio di ogni PagoPA usato (idempotente) e invio al meter Stripe
 * - attivazione dell'autoscuola (cliente Stripe + carta/SEPA + abbonamento settimanale a consumo)
 * - controllo preventivo prima di un nuovo PagoPA
 * - gestione dei webhook Stripe: fatture, pagamenti, insoluti, sblocchi
 * - fattura elettronica SDI tramite sdiProvider
 * - job periodici: reinvio eventi non inviati, blocco dopo N giorni di insoluto
 *
 * Le dipendenze (db, stripe, avvisi, sdi, clock) sono iniettabili per i test.
 */

const { getBillingConfig } = require("./config");

const STATI = Object.freeze({
  NON_ATTIVO: "non_attivo",
  ATTIVA: "attiva",
  IN_SOSPESO: "in_sospeso",
  BLOCCATA: "bloccata",
});

const AUTOSCUOLA_COLS =
  "id,nome,email,telefono,indirizzo,partita_iva,ragione_sociale,codice_fiscale,codice_sdi,pec,cap,comune,provincia," +
  "is_admin,billing_esente,stripe_customer_id,stripe_subscription_id,stato_billing,billing_sospeso_dal,billing_aggiornato_il";

const DATI_FISCALI_CAMPI = [
  "ragione_sociale", "partita_iva", "codice_fiscale", "codice_sdi", "pec",
  "indirizzo", "cap", "comune", "provincia", "telefono",
];

const deps = {
  db: null,
  stripe: null,
  config: null,
  avvisi: null,
  sdi: null,
  now: () => new Date(),
};

function _setDeps(overrides = {}) {
  Object.assign(deps, overrides);
}

function _resetDeps() {
  deps.db = null;
  deps.stripe = null;
  deps.config = null;
  deps.avvisi = null;
  deps.sdi = null;
  deps.now = () => new Date();
}

function cfg() {
  return deps.config || getBillingConfig();
}

function db() {
  if (!deps.db) deps.db = require("../../database/supabase");
  return deps.db;
}

function stripe() {
  if (deps.stripe) return deps.stripe;
  const key = cfg().stripeSecretKey;
  if (!key) {
    const err = new Error("Stripe non configurato: manca STRIPE_SECRET_KEY");
    err.status = 503;
    throw err;
  }
  const Stripe = require("stripe");
  deps.stripe = new Stripe(key);
  return deps.stripe;
}

function avvisi() {
  return deps.avvisi || require("./avvisi");
}

function sdi() {
  return deps.sdi || require("./sdiProvider");
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function centsToEuro(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function inizioGiorno(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function inizioSettimana(d) {
  const x = inizioGiorno(d);
  const giorno = (x.getDay() + 6) % 7; // lunedì = 0
  x.setDate(x.getDate() - giorno);
  return x;
}

// ---------------------------------------------------------------------------
// Lettura autoscuola
// ---------------------------------------------------------------------------

async function getAutoscuola(autoscuolaId) {
  const { data, error } = await db().from("autoscuole").select(AUTOSCUOLA_COLS).eq("id", autoscuolaId).maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, "Autoscuola non trovata");
  return data;
}

async function getAutoscuolaByCustomer(customerId) {
  if (!customerId) return null;
  const { data, error } = await db().from("autoscuole").select(AUTOSCUOLA_COLS).eq("stripe_customer_id", customerId).maybeSingle();
  if (error) throw httpError(500, error.message);
  return data || null;
}

async function aggiornaAutoscuola(autoscuolaId, patch) {
  const payload = { ...patch, billing_aggiornato_il: deps.now().toISOString() };
  const { error } = await db().from("autoscuole").update(payload).eq("id", autoscuolaId);
  if (error) throw httpError(500, error.message);
}

function isAdmin(autoscuola, authEmail) {
  if (autoscuola?.is_admin) return true;
  const email = String(authEmail || autoscuola?.email || "").toLowerCase();
  return Boolean(email) && cfg().adminEmails.includes(email);
}

// ---------------------------------------------------------------------------
// Controllo preventivo
// ---------------------------------------------------------------------------

/**
 * Dice se l'autoscuola può creare un nuovo PagoPA.
 * Con BILLING_ENABLED spento risponde sempre consentito (comportamento attuale invariato).
 */
async function controlloPreventivo(autoscuolaId) {
  const c = cfg();
  if (!c.enabled || !autoscuolaId) return { consentito: true };

  const a = await getAutoscuola(autoscuolaId);
  if (a.billing_esente) return { consentito: true };

  if (a.stato_billing === STATI.BLOCCATA) {
    const { data: aperte } = await db()
      .from("fatture_piattaforma")
      .select("link_pagamento")
      .eq("autoscuola_id", autoscuolaId)
      .eq("stato_pagamento", "fallita")
      .order("created_at", { ascending: false })
      .limit(1);
    return {
      consentito: false,
      codice: "billing_bloccata",
      motivo: "Nuovi PagoPA sospesi: c'è una fattura delle commissioni non pagata. Vai su Fatturazione per pagarla.",
      linkPagamento: aperte?.[0]?.link_pagamento || null,
    };
  }

  if (a.stato_billing === STATI.NON_ATTIVO && c.richiediAttivazione) {
    return {
      consentito: false,
      codice: "billing_non_attivo",
      motivo: "Per usare i PagoPA dalla piattaforma attiva prima il metodo di pagamento delle commissioni in Fatturazione.",
    };
  }

  return { consentito: true, inSospeso: a.stato_billing === STATI.IN_SOSPESO };
}

// ---------------------------------------------------------------------------
// Conteggio PagoPA
// ---------------------------------------------------------------------------

function meterIdentifier(row) {
  return `${row.autoscuola_id}:${row.identificativo_pagopa}:${row.quantita > 0 ? "u" : "s"}`.slice(0, 100);
}

async function inviaEventoStripe(row, customerId) {
  const c = cfg();
  if (row.quantita > 0) {
    await stripe().billing.meterEvents.create({
      event_name: c.meterEventName,
      identifier: meterIdentifier(row),
      timestamp: Math.floor(new Date(row.created_at || deps.now()).getTime() / 1000),
      payload: { stripe_customer_id: customerId, value: String(row.quantita) },
    });
  } else {
    // Storno: annulla l'evento originale (Stripe lo consente entro 24 ore).
    await stripe().billing.meterEventAdjustments.create({
      event_name: c.meterEventName,
      type: "cancel",
      cancel: { identifier: meterIdentifier({ ...row, quantita: 1 }) },
    });
  }
}

async function segnaInvio(rowId, ok, errore, tentativiPrecedenti = 0) {
  const patch = ok
    ? { inviato_stripe: true, inviato_il: deps.now().toISOString(), ultimo_errore: null, tentativi_invio: tentativiPrecedenti + 1 }
    : { inviato_stripe: false, ultimo_errore: String(errore || "").slice(0, 500), tentativi_invio: tentativiPrecedenti + 1 };
  await db().from("pagopa_eventi").update(patch).eq("id", rowId);
}

/**
 * Registra un PagoPA usato da un'autoscuola. Idempotente sull'identificativo.
 * Non lancia mai eccezioni verso il chiamante: il gestionale non deve fermarsi
 * per un problema di fatturazione.
 */
async function registraPagoPA({ autoscuolaId, identificativo, praticaRef = null }) {
  const c = cfg();
  if (!c.enabled) return { registrato: false, motivo: "billing_disattivato" };
  if (!autoscuolaId || !identificativo) return { registrato: false, motivo: "dati_mancanti" };

  try {
    const a = await getAutoscuola(autoscuolaId);
    if (a.billing_esente) return { registrato: false, motivo: "esente" };

    const row = {
      autoscuola_id: autoscuolaId,
      identificativo_pagopa: String(identificativo).slice(0, 200),
      pratica_ref: praticaRef ? String(praticaRef).slice(0, 200) : null,
      quantita: 1,
    };
    const { data, error } = await db()
      .from("pagopa_eventi")
      .upsert(row, { onConflict: "autoscuola_id,identificativo_pagopa,quantita", ignoreDuplicates: true })
      .select();
    if (error) return { registrato: false, motivo: "errore_db", errore: error.message };

    const inserito = Array.isArray(data) ? data[0] : null;
    if (!inserito) return { registrato: false, motivo: "gia_contato" };

    if (a.stripe_customer_id && c.stripeSecretKey) {
      try {
        await inviaEventoStripe(inserito, a.stripe_customer_id);
        await segnaInvio(inserito.id, true, null, 0);
        return { registrato: true, inviatoStripe: true, id: inserito.id };
      } catch (e) {
        await segnaInvio(inserito.id, false, e.message, 0);
        return { registrato: true, inviatoStripe: false, id: inserito.id, errore: e.message };
      }
    }
    return { registrato: true, inviatoStripe: false, id: inserito.id };
  } catch (e) {
    console.warn("[Billing] registraPagoPA:", e.message);
    return { registrato: false, motivo: "errore", errore: e.message };
  }
}

/** Storno di un PagoPA contato per errore (solo amministratore). */
async function stornaPagoPA(eventoId) {
  const { data: ev, error } = await db().from("pagopa_eventi").select("*").eq("id", eventoId).maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!ev) throw httpError(404, "Evento non trovato");
  if (ev.quantita < 0 || ev.stornato) throw httpError(409, "Evento già stornato");

  const storno = {
    autoscuola_id: ev.autoscuola_id,
    identificativo_pagopa: ev.identificativo_pagopa,
    pratica_ref: ev.pratica_ref,
    quantita: -1,
  };
  const { data, error: insErr } = await db()
    .from("pagopa_eventi")
    .upsert(storno, { onConflict: "autoscuola_id,identificativo_pagopa,quantita", ignoreDuplicates: true })
    .select();
  if (insErr) throw httpError(500, insErr.message);
  await db().from("pagopa_eventi").update({ stornato: true }).eq("id", eventoId);

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { stornato: true, inviatoStripe: false };

  // Se l'evento originale non è mai arrivato a Stripe, basta non inviarlo.
  if (!ev.inviato_stripe) {
    await db().from("pagopa_eventi").update({ inviato_stripe: true, ultimo_errore: null }).eq("id", ev.id);
    await db().from("pagopa_eventi").update({ inviato_stripe: true, ultimo_errore: null }).eq("id", row.id);
    return { stornato: true, inviatoStripe: false };
  }

  const a = await getAutoscuola(ev.autoscuola_id);
  try {
    await inviaEventoStripe(row, a.stripe_customer_id);
    await segnaInvio(row.id, true, null, 0);
    return { stornato: true, inviatoStripe: true };
  } catch (e) {
    await segnaInvio(row.id, false, e.message, 0);
    return {
      stornato: true,
      inviatoStripe: false,
      avviso: "Stripe accetta l'annullamento solo entro 24 ore: se è passato più tempo, emetti una nota di credito.",
      errore: e.message,
    };
  }
}

/** Job: reinvia a Stripe gli eventi rimasti indietro (rete giù, cliente attivato dopo, ecc.). */
async function reinviaPendenti({ limite = 200 } = {}) {
  const c = cfg();
  if (!c.enabled || !c.stripeSecretKey) return { inviati: 0, falliti: 0 };

  const { data: rows, error } = await db()
    .from("pagopa_eventi")
    .select("*")
    .eq("inviato_stripe", false)
    .lt("tentativi_invio", 20)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw httpError(500, error.message);

  const customerCache = new Map();
  let inviati = 0;
  let falliti = 0;
  for (const row of rows || []) {
    if (!customerCache.has(row.autoscuola_id)) {
      const a = await getAutoscuola(row.autoscuola_id).catch(() => null);
      customerCache.set(row.autoscuola_id, a?.stripe_customer_id || null);
    }
    const customerId = customerCache.get(row.autoscuola_id);
    if (!customerId) continue;
    try {
      await inviaEventoStripe(row, customerId);
      await segnaInvio(row.id, true, null, row.tentativi_invio || 0);
      inviati += 1;
    } catch (e) {
      await segnaInvio(row.id, false, e.message, row.tentativi_invio || 0);
      falliti += 1;
    }
  }
  return { inviati, falliti };
}

// ---------------------------------------------------------------------------
// Stato e pannello autoscuola
// ---------------------------------------------------------------------------

async function contaPagoPA(autoscuolaId, da) {
  const { data, error } = await db()
    .from("pagopa_eventi")
    .select("quantita")
    .eq("autoscuola_id", autoscuolaId)
    .gte("created_at", da.toISOString());
  if (error) throw httpError(500, error.message);
  return (data || []).reduce((s, r) => s + Number(r.quantita || 0), 0);
}

async function getStato(autoscuolaId) {
  const c = cfg();
  const a = await getAutoscuola(autoscuolaId);
  const now = deps.now();
  const [oggi, settimana] = await Promise.all([
    contaPagoPA(autoscuolaId, inizioGiorno(now)),
    contaPagoPA(autoscuolaId, inizioSettimana(now)),
  ]);
  const datiFiscali = {};
  for (const k of DATI_FISCALI_CAMPI) datiFiscali[k] = a[k] ?? "";

  return {
    billingAttivo: c.enabled,
    stato: a.billing_esente ? "esente" : a.stato_billing,
    metodoPagamentoSalvato: Boolean(a.stripe_subscription_id),
    tariffaEuro: c.tariffaEuro,
    aliquotaIva: c.aliquotaIva,
    giorniTolleranza: c.giorniTolleranza,
    sospesoDal: a.billing_sospeso_dal,
    pagopaOggi: oggi,
    pagopaSettimana: settimana,
    maturatoSettimanaEuro: Math.round(settimana * c.tariffaEuro * 100) / 100,
    datiFiscali,
    datiFiscaliCompleti: datiFiscaliCompleti(a),
    isAdmin: isAdmin(a),
  };
}

function datiFiscaliCompleti(a) {
  const ragione = String(a.ragione_sociale || a.nome || "").trim();
  const piva = String(a.partita_iva || "").trim();
  const recapitoSdi = String(a.codice_sdi || "").trim() || String(a.pec || "").trim();
  return Boolean(ragione && piva && recapitoSdi && String(a.indirizzo || "").trim() && String(a.comune || "").trim());
}

function validaDatiFiscali(input) {
  const out = {};
  for (const k of DATI_FISCALI_CAMPI) {
    if (input[k] === undefined) continue;
    out[k] = String(input[k] ?? "").trim() || null;
  }
  if (out.partita_iva && !/^\d{11}$/.test(out.partita_iva.replace(/^IT/i, ""))) {
    throw httpError(400, "Partita IVA non valida (servono 11 cifre)");
  }
  if (out.partita_iva) out.partita_iva = out.partita_iva.replace(/^IT/i, "");
  if (out.codice_sdi && !/^[A-Z0-9]{7}$/i.test(out.codice_sdi)) {
    throw httpError(400, "Codice destinatario SDI non valido (7 caratteri)");
  }
  if (out.codice_sdi) out.codice_sdi = out.codice_sdi.toUpperCase();
  if (out.cap && !/^\d{5}$/.test(out.cap)) throw httpError(400, "CAP non valido");
  if (out.provincia) out.provincia = out.provincia.toUpperCase().slice(0, 2);
  if (out.codice_fiscale) out.codice_fiscale = out.codice_fiscale.toUpperCase();
  return out;
}

async function salvaDatiFiscali(autoscuolaId, input) {
  const patch = validaDatiFiscali(input || {});
  if (Object.keys(patch).length === 0) throw httpError(400, "Nessun dato da salvare");
  await aggiornaAutoscuola(autoscuolaId, patch);

  const a = await getAutoscuola(autoscuolaId);
  if (a.stripe_customer_id && cfg().stripeSecretKey) {
    await stripe().customers.update(a.stripe_customer_id, datiClienteStripe(a)).catch((e) =>
      console.warn("[Billing] aggiornamento cliente Stripe:", e.message)
    );
  }
  return getStato(autoscuolaId);
}

function datiClienteStripe(a) {
  return {
    name: a.ragione_sociale || a.nome,
    email: a.email,
    phone: a.telefono || undefined,
    address: {
      line1: a.indirizzo || undefined,
      postal_code: a.cap || undefined,
      city: a.comune || undefined,
      state: a.provincia || undefined,
      country: "IT",
    },
    metadata: { autoscuola_id: a.id, partita_iva: a.partita_iva || "" },
    preferred_locales: ["it"],
  };
}

// ---------------------------------------------------------------------------
// Attivazione: cliente Stripe + salvataggio carta/SEPA + abbonamento
// ---------------------------------------------------------------------------

async function assicuraClienteStripe(a) {
  if (a.stripe_customer_id) return a.stripe_customer_id;
  const customer = await stripe().customers.create(datiClienteStripe(a), {
    idempotencyKey: `customer-${a.id}`,
  });
  await aggiornaAutoscuola(a.id, { stripe_customer_id: customer.id });
  return customer.id;
}

async function avviaAttivazione(autoscuolaId) {
  const c = cfg();
  if (!c.enabled) throw httpError(409, "La fatturazione delle commissioni non è attiva");
  const a = await getAutoscuola(autoscuolaId);
  if (!datiFiscaliCompleti(a)) throw httpError(400, "Completa prima i dati di fatturazione");

  const customerId = await assicuraClienteStripe(a);
  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "eur",
    payment_method_types: ["card", "sepa_debit"],
    locale: "it",
    success_url: `${c.frontendOrigin}/fatturazione?attivazione=ok`,
    cancel_url: `${c.frontendOrigin}/fatturazione?attivazione=annullata`,
    metadata: { autoscuola_id: a.id, scopo: "commissioni_pagopa" },
    setup_intent_data: { metadata: { autoscuola_id: a.id } },
  });
  return { url: session.url };
}

async function creaAbbonamento(autoscuola, paymentMethodId) {
  const c = cfg();
  if (!c.stripePriceId) throw httpError(503, "Manca STRIPE_PRICE_ID: esegui lo script di configurazione Stripe");

  const customerId = autoscuola.stripe_customer_id;
  if (paymentMethodId) {
    await stripe().customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  }

  if (autoscuola.stripe_subscription_id) {
    await aggiornaAutoscuola(autoscuola.id, {
      stato_billing: autoscuola.stato_billing === STATI.NON_ATTIVO ? STATI.ATTIVA : autoscuola.stato_billing,
    });
    return autoscuola.stripe_subscription_id;
  }

  const params = {
    customer: customerId,
    items: [{ price: c.stripePriceId }],
    collection_method: "charge_automatically",
    metadata: { autoscuola_id: autoscuola.id },
  };
  if (paymentMethodId) params.default_payment_method = paymentMethodId;
  if (c.stripeTaxRateId) params.default_tax_rates = [c.stripeTaxRateId];

  const sub = await stripe().subscriptions.create(params, { idempotencyKey: `subscription-${autoscuola.id}` });
  await aggiornaAutoscuola(autoscuola.id, { stripe_subscription_id: sub.id, stato_billing: STATI.ATTIVA });
  return sub.id;
}

async function portalePagamento(autoscuolaId) {
  const a = await getAutoscuola(autoscuolaId);
  if (!a.stripe_customer_id) throw httpError(409, "Metodo di pagamento non ancora attivato");
  const session = await stripe().billingPortal.sessions.create({
    customer: a.stripe_customer_id,
    return_url: `${cfg().frontendOrigin}/fatturazione`,
    locale: "it",
  });
  return { url: session.url };
}

async function listaFatture(autoscuolaId, { limite = 52 } = {}) {
  const { data, error } = await db()
    .from("fatture_piattaforma")
    .select("*")
    .eq("autoscuola_id", autoscuolaId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw httpError(500, error.message);
  return data || [];
}

// ---------------------------------------------------------------------------
// Webhook Stripe
// ---------------------------------------------------------------------------

function verificaWebhook(rawBody, signature) {
  const secret = cfg().stripeWebhookSecret;
  if (!secret) throw httpError(503, "Manca STRIPE_WEBHOOK_SECRET");
  try {
    return stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    throw httpError(400, `Firma webhook non valida: ${e.message}`);
  }
}

/** Restituisce false se l'evento era già stato elaborato. */
async function segnaEventoElaborato(event) {
  const { data, error } = await db()
    .from("stripe_webhook_eventi")
    .upsert({ id: event.id, tipo: event.type }, { onConflict: "id", ignoreDuplicates: true })
    .select();
  if (error) throw httpError(500, error.message);
  return Array.isArray(data) && data.length > 0;
}

async function dimenticaEvento(eventId) {
  await db().from("stripe_webhook_eventi").delete().eq("id", eventId);
}

function riepilogoInvoice(invoice) {
  const righe = invoice?.lines?.data || [];
  const numeroPagopa = righe.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const imponibile = centsToEuro(invoice.subtotal_excluding_tax ?? invoice.subtotal);
  const totale = centsToEuro(invoice.total);
  const iva = Math.round((totale - imponibile) * 100) / 100;
  const periodo = righe[0]?.period || {};
  return {
    numeroPagopa,
    imponibile,
    iva,
    totale,
    periodoInizio: periodo.start ? new Date(periodo.start * 1000).toISOString() : null,
    periodoFine: periodo.end ? new Date(periodo.end * 1000).toISOString() : null,
  };
}

async function upsertFattura(autoscuola, invoice, patch = {}) {
  const r = riepilogoInvoice(invoice);
  const row = {
    autoscuola_id: autoscuola.id,
    stripe_invoice_id: invoice.id,
    periodo_inizio: r.periodoInizio,
    periodo_fine: r.periodoFine,
    numero_pagopa: r.numeroPagopa,
    imponibile: r.imponibile,
    iva: r.iva,
    totale: r.totale,
    link_pagamento: invoice.hosted_invoice_url || null,
    ...patch,
  };
  const { data, error } = await db()
    .from("fatture_piattaforma")
    .upsert(row, { onConflict: "stripe_invoice_id" })
    .select();
  if (error) throw httpError(500, error.message);
  return (Array.isArray(data) ? data[0] : data) || row;
}

async function getFatturaByInvoice(invoiceId) {
  const { data } = await db().from("fatture_piattaforma").select("*").eq("stripe_invoice_id", invoiceId).maybeSingle();
  return data || null;
}

async function emettiFatturaSdi(fattura, autoscuola, { pagata }) {
  if (!fattura || Number(fattura.totale || 0) <= 0) return { saltata: true };
  if (["inviata", "consegnata"].includes(fattura.stato_sdi)) return { saltata: true };

  const giorno = (iso) => (iso ? String(iso).slice(0, 10) : null);
  const esito = await sdi().emettiFattura({
    cliente: {
      nome: autoscuola.nome,
      ragioneSociale: autoscuola.ragione_sociale,
      partitaIva: autoscuola.partita_iva,
      codiceFiscale: autoscuola.codice_fiscale,
      indirizzo: autoscuola.indirizzo,
      cap: autoscuola.cap,
      comune: autoscuola.comune,
      provincia: autoscuola.provincia,
      pec: autoscuola.pec,
      codiceSdi: autoscuola.codice_sdi,
    },
    numeroPagopa: fattura.numero_pagopa,
    tariffaUnitaria: fattura.numero_pagopa ? Number(fattura.imponibile) / Number(fattura.numero_pagopa) : cfg().tariffaEuro,
    imponibile: fattura.imponibile,
    iva: fattura.iva,
    totale: fattura.totale,
    periodoInizio: giorno(fattura.periodo_inizio),
    periodoFine: giorno(fattura.periodo_fine),
    pagata,
  });

  await db()
    .from("fatture_piattaforma")
    .update({
      stato_sdi: esito.stato,
      numero_sdi: esito.numero || null,
      provider_sdi_id: esito.providerId || null,
      pdf_url: esito.pdfUrl || fattura.pdf_url || null,
      errore_sdi: esito.errore || null,
    })
    .eq("id", fattura.id);
  return esito;
}

async function onCheckoutCompleted(session) {
  if (session.mode !== "setup") return;
  const autoscuolaId = session.metadata?.autoscuola_id;
  const a = autoscuolaId ? await getAutoscuola(autoscuolaId) : await getAutoscuolaByCustomer(session.customer);
  if (!a) return;
  if (!a.stripe_customer_id && session.customer) {
    await aggiornaAutoscuola(a.id, { stripe_customer_id: session.customer });
    a.stripe_customer_id = session.customer;
  }
  let paymentMethodId = null;
  if (session.setup_intent) {
    const si = typeof session.setup_intent === "string"
      ? await stripe().setupIntents.retrieve(session.setup_intent)
      : session.setup_intent;
    paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id || null;
  }
  await creaAbbonamento(a, paymentMethodId);
}

async function onInvoiceFinalized(invoice) {
  const a = await getAutoscuolaByCustomer(invoice.customer);
  if (!a) return;
  const fattura = await upsertFattura(a, invoice);
  if (cfg().momentoFattura === "prima_incasso") {
    await emettiFatturaSdi(fattura, a, { pagata: false });
  }
}

async function onInvoicePaid(invoice) {
  const a = await getAutoscuolaByCustomer(invoice.customer);
  if (!a) return;
  const fattura = await upsertFattura(a, invoice, { stato_pagamento: "pagata" });

  const eraFermo = [STATI.IN_SOSPESO, STATI.BLOCCATA].includes(a.stato_billing);
  if (eraFermo || a.stato_billing === STATI.NON_ATTIVO) {
    // Riattiva solo se non restano altre fatture non pagate.
    const { data: aperte } = await db()
      .from("fatture_piattaforma")
      .select("id")
      .eq("autoscuola_id", a.id)
      .eq("stato_pagamento", "fallita");
    if (!aperte || aperte.length === 0) {
      await aggiornaAutoscuola(a.id, { stato_billing: STATI.ATTIVA, billing_sospeso_dal: null });
      if (eraFermo) await avvisi().inviaAvviso("riattivata", a, { totale: fattura.totale });
    }
  }

  if (cfg().momentoFattura === "dopo_incasso") {
    await emettiFatturaSdi(fattura, a, { pagata: true });
  }
}

async function onInvoicePaymentFailed(invoice) {
  const a = await getAutoscuolaByCustomer(invoice.customer);
  if (!a) return;
  const precedente = await getFatturaByInvoice(invoice.id);
  const fattura = await upsertFattura(a, invoice, {
    stato_pagamento: "fallita",
    tentativi_falliti: Number(precedente?.tentativi_falliti || 0) + 1,
  });

  if (a.stato_billing === STATI.ATTIVA || a.stato_billing === STATI.NON_ATTIVO) {
    await aggiornaAutoscuola(a.id, {
      stato_billing: STATI.IN_SOSPESO,
      billing_sospeso_dal: a.billing_sospeso_dal || deps.now().toISOString(),
    });
  }
  await avvisi().inviaAvviso("pagamento_fallito", a, {
    totale: fattura.totale,
    link: invoice.hosted_invoice_url || `${cfg().frontendOrigin}/fatturazione`,
    giorni: cfg().giorniTolleranza,
  });
}

async function onInvoiceVoided(invoice) {
  const a = await getAutoscuolaByCustomer(invoice.customer);
  if (!a) return;
  await upsertFattura(a, invoice, { stato_pagamento: "annullata" });
}

async function onSubscriptionDeleted(sub) {
  const a = await getAutoscuolaByCustomer(sub.customer);
  if (!a || a.stripe_subscription_id !== sub.id) return;
  await aggiornaAutoscuola(a.id, { stripe_subscription_id: null, stato_billing: STATI.NON_ATTIVO });
}

const HANDLERS = {
  "checkout.session.completed": onCheckoutCompleted,
  "invoice.finalized": onInvoiceFinalized,
  "invoice.paid": onInvoicePaid,
  "invoice.payment_failed": onInvoicePaymentFailed,
  "invoice.voided": onInvoiceVoided,
  "customer.subscription.deleted": onSubscriptionDeleted,
};

async function gestisciEvento(event) {
  const handler = HANDLERS[event.type];
  if (!handler) return { gestito: false };
  const nuovo = await segnaEventoElaborato(event);
  if (!nuovo) return { gestito: false, duplicato: true };
  try {
    await handler(event.data.object);
    return { gestito: true };
  } catch (e) {
    // Così Stripe riproverà l'invio del webhook.
    await dimenticaEvento(event.id).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Job: blocco dopo il periodo di tolleranza
// ---------------------------------------------------------------------------

async function aggiornaBlocchi() {
  const c = cfg();
  if (!c.enabled) return { bloccate: 0 };
  const limite = new Date(deps.now().getTime() - c.giorniTolleranza * 24 * 3600 * 1000).toISOString();
  const { data, error } = await db()
    .from("autoscuole")
    .select(AUTOSCUOLA_COLS)
    .eq("stato_billing", STATI.IN_SOSPESO)
    .lte("billing_sospeso_dal", limite);
  if (error) throw httpError(500, error.message);

  let bloccate = 0;
  for (const a of data || []) {
    if (a.billing_esente) continue;
    await aggiornaAutoscuola(a.id, { stato_billing: STATI.BLOCCATA });
    const { data: aperte } = await db()
      .from("fatture_piattaforma")
      .select("totale,link_pagamento")
      .eq("autoscuola_id", a.id)
      .eq("stato_pagamento", "fallita")
      .order("created_at", { ascending: false })
      .limit(1);
    await avvisi().inviaAvviso("bloccata", a, {
      totale: aperte?.[0]?.totale,
      link: aperte?.[0]?.link_pagamento || `${c.frontendOrigin}/fatturazione`,
    });
    bloccate += 1;
  }
  return { bloccate };
}

// ---------------------------------------------------------------------------
// Amministratore BLUEFOX
// ---------------------------------------------------------------------------

async function adminElencoAutoscuole() {
  const { data: scuole, error } = await db().from("autoscuole").select(AUTOSCUOLA_COLS).order("nome");
  if (error) throw httpError(500, error.message);
  const settimana = inizioSettimana(deps.now());
  const { data: eventi } = await db()
    .from("pagopa_eventi")
    .select("autoscuola_id,quantita")
    .gte("created_at", settimana.toISOString());
  const { data: aperte } = await db()
    .from("fatture_piattaforma")
    .select("autoscuola_id,totale")
    .eq("stato_pagamento", "fallita");

  const perScuola = new Map();
  for (const e of eventi || []) perScuola.set(e.autoscuola_id, (perScuola.get(e.autoscuola_id) || 0) + Number(e.quantita || 0));
  const insoluti = new Map();
  for (const f of aperte || []) insoluti.set(f.autoscuola_id, (insoluti.get(f.autoscuola_id) || 0) + Number(f.totale || 0));

  return (scuole || []).map((a) => ({
    id: a.id,
    nome: a.nome,
    ragioneSociale: a.ragione_sociale,
    email: a.email,
    stato: a.billing_esente ? "esente" : a.stato_billing,
    sospesoDal: a.billing_sospeso_dal,
    pagopaSettimana: perScuola.get(a.id) || 0,
    insolutoEuro: Math.round((insoluti.get(a.id) || 0) * 100) / 100,
    metodoPagamento: Boolean(a.stripe_subscription_id),
    datiFiscaliCompleti: datiFiscaliCompleti(a),
  }));
}

async function adminRiepilogo({ settimane = 8 } = {}) {
  const da = inizioSettimana(new Date(deps.now().getTime() - (settimane - 1) * 7 * 24 * 3600 * 1000));
  const [{ data: eventi, error: e1 }, { data: fatture, error: e2 }] = await Promise.all([
    db().from("pagopa_eventi").select("quantita,created_at").gte("created_at", da.toISOString()),
    db().from("fatture_piattaforma").select("totale,stato_pagamento,stato_sdi,created_at").gte("created_at", da.toISOString()),
  ]);
  if (e1) throw httpError(500, e1.message);
  if (e2) throw httpError(500, e2.message);

  const chiave = (iso) => inizioSettimana(new Date(iso)).toISOString().slice(0, 10);
  const mappa = new Map();
  for (let i = 0; i < settimane; i += 1) {
    const k = new Date(da.getTime() + i * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    mappa.set(chiave(k), { settimana: chiave(k), pagopa: 0, incassato: 0, insoluto: 0 });
  }
  for (const e of eventi || []) {
    const r = mappa.get(chiave(e.created_at));
    if (r) r.pagopa += Number(e.quantita || 0);
  }
  for (const f of fatture || []) {
    const r = mappa.get(chiave(f.created_at));
    if (!r) continue;
    if (f.stato_pagamento === "pagata") r.incassato += Number(f.totale || 0);
    if (f.stato_pagamento === "fallita") r.insoluto += Number(f.totale || 0);
  }
  const daEmettere = (fatture || []).filter((f) => ["da_emettere", "errore", "scartata"].includes(f.stato_sdi) && Number(f.totale) > 0).length;
  return {
    settimane: [...mappa.values()].map((r) => ({ ...r, incassato: Math.round(r.incassato * 100) / 100, insoluto: Math.round(r.insoluto * 100) / 100 })),
    fattureDaEmettere: daEmettere,
  };
}

async function adminFattureDaEmettere() {
  const { data, error } = await db()
    .from("fatture_piattaforma")
    .select("*")
    .in("stato_sdi", ["da_emettere", "errore", "scartata"])
    .gt("totale", 0)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw httpError(500, error.message);
  return data || [];
}

async function adminSblocca(autoscuolaId) {
  await aggiornaAutoscuola(autoscuolaId, { stato_billing: STATI.ATTIVA, billing_sospeso_dal: null });
  return getAutoscuola(autoscuolaId);
}

async function adminImpostaEsente(autoscuolaId, esente) {
  await aggiornaAutoscuola(autoscuolaId, { billing_esente: Boolean(esente) });
  return getAutoscuola(autoscuolaId);
}

async function adminRiemettiSdi(fatturaId) {
  const { data: f, error } = await db().from("fatture_piattaforma").select("*").eq("id", fatturaId).maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!f) throw httpError(404, "Fattura non trovata");
  const a = await getAutoscuola(f.autoscuola_id);
  return emettiFatturaSdi({ ...f, stato_sdi: "da_emettere" }, a, { pagata: f.stato_pagamento === "pagata" });
}

async function adminSegnaSdiManuale(fatturaId, numero) {
  const { error } = await db()
    .from("fatture_piattaforma")
    .update({ stato_sdi: "inviata", numero_sdi: String(numero || "").trim() || null, errore_sdi: null })
    .eq("id", fatturaId);
  if (error) throw httpError(500, error.message);
  return { ok: true };
}

module.exports = {
  STATI,
  controlloPreventivo,
  registraPagoPA,
  stornaPagoPA,
  reinviaPendenti,
  getStato,
  salvaDatiFiscali,
  validaDatiFiscali,
  avviaAttivazione,
  creaAbbonamento,
  portalePagamento,
  listaFatture,
  verificaWebhook,
  gestisciEvento,
  aggiornaBlocchi,
  adminElencoAutoscuole,
  adminRiepilogo,
  adminFattureDaEmettere,
  adminSblocca,
  adminImpostaEsente,
  adminRiemettiSdi,
  adminSegnaSdiManuale,
  isAdmin,
  getAutoscuola,
  riepilogoInvoice,
  inizioSettimana,
  _setDeps,
  _resetDeps,
};
