/**
 * Controller REST per prenotazioni esami (GeCA PrenotatoreService, NAVIGATOREnew, candprep).
 */

const { BookingService } = require("../services");
const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const { addImportHistory } = require("../server/importHistory");
const { sendBookingNotification } = require("../telegra");
const { resolveCandidateId } = require("../server/candidateHelpers");
const { addCandidatesToBookingList } = require("../server/portalHelpers");
const { randomUUID } = require("crypto");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

// ---------------------------------------------------------------------------
// POST /api/prenotazioni-api/prenota  (originale)
// ---------------------------------------------------------------------------
async function prenota(req, res) {
  try {
    const opts = {
      candidati: req.body?.candidati,
      seduta: req.body?.seduta,
      credenziali: req.body?.credenziali || {},
      ...req.body,
    };
    const booking = new BookingService(opts);
    const result = await booking.prenota(opts);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore prenotazione" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/prenotazioni/prenota-esame
// ---------------------------------------------------------------------------
async function prenotaEsame(req, res) {
  const { nome, cognome, data, categoria, ora, luogo } = req.body;

  if (!nome || !cognome || !data || !categoria) {
    return res.status(400).json({
      error: "Mancano dati obbligatori: nome, cognome, data, categoria",
    });
  }

  let saved = null;
  let error = null;

  const candidateId = await resolveCandidateId({ nome, cognome }, req).catch(() => null);
  const normalizedDate = String(data || "").includes("T") ? data : `${data}T00:00:00`;
  const candidatePayload = {
    candidate_id: candidateId,
    sessione_id: randomUUID(),
    data_prenotazione: normalizedDate,
    esito: "inviata",
    ...tenantField(req),
  };

  const payloadAttempts = [
    { nome, cognome, data, categoria, ora, luogo, ...tenantField(req) },
    { nome, cognome, data, ...tenantField(req) },
    candidatePayload,
  ];

  for (const payload of payloadAttempts) {
    ({ data: saved, error } = await supabase.from("prenotazioni").insert([payload]).select());
    if (!error) break;
  }

  if (error && /prenotazioni_sessione_id_fkey/i.test(String(error.message || ""))) {
    try {
      const fallbackCandidateId = await resolveCandidateId({
        nome,
        cognome,
        categoria_patente: categoria || "B",
        codice_fiscale: `BOOKING-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      }, req);
      const linked = await addCandidatesToBookingList([fallbackCandidateId], req);

      const success = await sendBookingNotification({ nome, cognome, data, categoria, ora, luogo });
      if (!success) console.warn("Notifica Telegram non inviata per prenotazione fallback waitlist");

      return res.json({
        success: true,
        booking: { id: linked?.[0]?.id, nome, cognome, data, categoria, ora, luogo, mode: "waitlist-fallback" },
      });
    } catch (fallbackError) {
      return res.status(500).json({ error: fallbackError.message });
    }
  }

  if (error) return res.status(500).json({ error: error.message });

  if (saved && saved.length > 0) {
    const success = await sendBookingNotification({
      nome: saved[0].nome,
      cognome: saved[0].cognome,
      data: saved[0].data,
      categoria: saved[0].categoria || categoria,
      ora: saved[0].ora || ora,
      luogo: saved[0].luogo || luogo,
    });
    if (!success) console.warn("Notifica Telegram non inviata per prenotazione:", saved[0].id);
  }

  res.json({ success: true, booking: saved[0] });
}

// ---------------------------------------------------------------------------
// GET /api/prenotazioni
// ---------------------------------------------------------------------------
async function list(req, res) {
  const { data, error } = await withTenantFilter(
    supabase.from("prenotazioni").select("*, candidates(nome,cognome)"),
    req
  ).order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const normalized = (data || []).map((row) => ({
    ...row,
    nome: row.nome || row.candidates?.nome || null,
    cognome: row.cognome || row.candidates?.cognome || null,
    data: row.data || row.data_prenotazione || null,
    categoria: row.categoria || null,
    ora: row.ora || null,
    luogo: row.luogo || null,
  }));

  res.json(normalized);
}

// ---------------------------------------------------------------------------
// DELETE /api/prenotazioni/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  const { id } = req.params;

  if (!isUuid(id)) {
    let deleteWaitlistQuery = supabase.from("waitlist").delete();
    deleteWaitlistQuery = withTenantFilter(deleteWaitlistQuery, req);
    const { error: waitlistDeleteError } = await deleteWaitlistQuery.eq("id", id);
    if (waitlistDeleteError) return res.status(500).json({ error: waitlistDeleteError.message });
    return res.json({ success: true, message: "Richiesta fallback annullata da waitlist" });
  }

  let deleteBookingQuery = supabase.from("prenotazioni").delete();
  deleteBookingQuery = withTenantFilter(deleteBookingQuery, req);
  const { error } = await deleteBookingQuery.eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: "Prenotazione annullata" });
}

// ---------------------------------------------------------------------------
// PUT /api/prenotazioni/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  const { id } = req.params;
  const { nome, cognome, data, categoria, ora, luogo } = req.body || {};

  if (!isUuid(id)) {
    const nextStatus = String(req.body?.status || "pending").trim() || "pending";
    let updateWaitlistQuery = supabase.from("waitlist").update({ status: nextStatus });
    updateWaitlistQuery = withTenantFilter(updateWaitlistQuery, req);
    const { data: updatedRows, error: waitlistUpdateError } = await updateWaitlistQuery
      .eq("id", id)
      .select()
      .limit(1);

    if (waitlistUpdateError) return res.status(500).json({ error: waitlistUpdateError.message });
    return res.json({
      success: true,
      booking: Array.isArray(updatedRows) ? updatedRows[0] : null,
      mode: "waitlist-fallback",
    });
  }

  const normalizedDate = data
    ? (String(data).includes("T") ? String(data) : `${data}T00:00:00`)
    : null;

  const attempts = [
    { nome, cognome, data, categoria, ora, luogo },
    { nome, cognome, data },
    normalizedDate ? { data_prenotazione: normalizedDate } : null,
  ].filter(Boolean);

  let lastError = null;
  let updated = null;

  for (const payload of attempts) {
    let updateQuery = supabase.from("prenotazioni").update(payload);
    updateQuery = withTenantFilter(updateQuery, req);
    const { data: updatedRows, error } = await updateQuery.eq("id", id).select().limit(1);

    if (!error) {
      updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
      lastError = null;
      break;
    }
    lastError = error;
  }

  if (lastError) return res.status(500).json({ error: lastError.message });
  return res.json({ success: true, booking: updated });
}

// ---------------------------------------------------------------------------
// POST /api/prenotazioni/:id/payment-action
// ---------------------------------------------------------------------------
async function paymentAction(req, res) {
  const { id } = req.params;
  const requestedAction = String(req.body?.action || "").trim().toLowerCase();
  const action = requestedAction;
  const actor = {
    autoscuolaId: req.autoscuolaId || null,
    email: req.auth?.email || null,
    nome: req.auth?.nome || null,
  };

  if (requestedAction === "bollettino") {
    await addImportHistory({
      type: "payment-action",
      status: "error",
      criteria: { id, action: requestedAction, actor },
      errors: 1,
      message: "Azione pagamento legacy non supportata: usare PagoPA",
    });
    return res.status(400).json({
      success: false,
      error: "Azione non valida: usa 'pagopa' al posto di 'bollettino'",
    });
  }

  const allowedActions = new Set(["decurtazione", "pagopa", "ritenta", "recupero_credito"]);
  if (!allowedActions.has(action)) {
    await addImportHistory({
      type: "payment-action",
      status: "error",
      criteria: { id, action, actor },
      errors: 1,
      message: "Azione pagamento non valida",
    });
    return res.status(400).json({ success: false, error: "Azione pagamento non valida" });
  }

  const nextPaymentStatusByAction = {
    decurtazione: "paid",
    pagopa: "pending",
    ritenta: "retrying",
    recupero_credito: "credit_recovered",
  };

  const nextEsitoByAction = {
    decurtazione: "pagamento_ok",
    pagopa: "pagamento_in_attesa",
    ritenta: "pagamento_da_ripetere",
    recupero_credito: "credito_recuperato",
  };

  if (!isUuid(id)) {
    const nextStatus = action === "recupero_credito"
      ? "skipped"
      : action === "decurtazione"
        ? "in_progress"
        : "pending";

    let waitlistUpdateQuery = supabase.from("waitlist").update({ status: nextStatus });
    waitlistUpdateQuery = withTenantFilter(waitlistUpdateQuery, req);
    const { data: updatedRows, error } = await waitlistUpdateQuery.eq("id", id).select().limit(1);

    if (error) {
      await addImportHistory({
        type: "payment-action",
        status: "error",
        criteria: { id, action, mode: "waitlist-fallback", actor },
        errors: 1,
        message: error.message,
      });
      return res.status(500).json({ success: false, error: error.message });
    }

    await addImportHistory({
      type: "payment-action",
      status: "ok",
      criteria: { id, action, mode: "waitlist-fallback", actor },
      imported: 1,
      message: `Pagamento aggiornato (${action}) su fallback waitlist`,
    });

    return res.json({
      success: true,
      mode: "waitlist-fallback",
      paymentStatus: nextPaymentStatusByAction[action],
      esito: nextEsitoByAction[action],
      row: Array.isArray(updatedRows) ? updatedRows[0] : null,
    });
  }

  const attempts = [
    {
      payment_method: action,
      payment_status: nextPaymentStatusByAction[action],
      esito: nextEsitoByAction[action],
    },
    { esito: nextEsitoByAction[action] },
  ];

  let updated = null;
  let lastError = null;

  for (const payload of attempts) {
    let updateQuery = supabase.from("prenotazioni").update(payload);
    updateQuery = withTenantFilter(updateQuery, req);
    const { data, error } = await updateQuery.eq("id", id).select().limit(1);

    if (!error) {
      updated = Array.isArray(data) ? data[0] : null;
      lastError = null;
      break;
    }
    lastError = error;
  }

  if (lastError) {
    await addImportHistory({
      type: "payment-action",
      status: "error",
      criteria: { id, action, mode: "prenotazioni", actor },
      errors: 1,
      message: lastError.message,
    });
    return res.status(500).json({ success: false, error: lastError.message });
  }

  await addImportHistory({
    type: "payment-action",
    status: "ok",
    criteria: { id, action, mode: "prenotazioni", actor },
    imported: 1,
    message: `Pagamento aggiornato (${action}) su prenotazione`,
  });

  return res.json({
    success: true,
    paymentStatus: updated?.payment_status || nextPaymentStatusByAction[action],
    esito: updated?.esito || nextEsitoByAction[action],
    booking: updated,
  });
}

module.exports = {
  prenota,
  prenotaEsame,
  list,
  remove,
  update,
  paymentAction,
};
