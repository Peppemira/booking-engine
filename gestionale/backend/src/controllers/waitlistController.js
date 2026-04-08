/**
 * Controller REST per waitlist (lista d'attesa prenotazione esami).
 * Spostato da server.js inline routes.
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const { resolveCandidateId } = require("../server/candidateHelpers");

// ---------------------------------------------------------------------------
// GET /api/waitlist
// ---------------------------------------------------------------------------
async function list(req, res) {
  const { data, error } = await withTenantFilter(
    supabase.from("waitlist").select("*"),
    req
  ).order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

// ---------------------------------------------------------------------------
// GET /api/waitlist/queue
// ---------------------------------------------------------------------------
async function queue(req, res) {
  try {
    const { data, error } = await withTenantFilter(
      supabase
        .from("waitlist")
        .select("id, candidate_id, status, priority, created_at, candidates(nome, cognome, codice_fiscale, raw_portale)"),
      req
    )
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const rows = Array.isArray(data) ? data : [];
    const normalized = rows.map((row, index) => ({
      id: row.id,
      queueNr: index + 1,
      status: row.status || "pending",
      priority: row.priority ?? index + 1,
      created_at: row.created_at,
      candidate_id: row.candidate_id,
      cognome: String(row?.candidates?.cognome || "").trim(),
      nome: String(row?.candidates?.nome || "").trim(),
      codice_fiscale: String(row?.candidates?.codice_fiscale || "").trim(),
      turnoPreferito: String(row?.candidates?.raw_portale?.turno_esaminatore || "").trim(),
      lingua: String(row?.candidates?.raw_portale?.lingua || row?.candidates?.raw_portale?.codice_lingua || "").trim(),
      supportoAudio: String(row?.candidates?.raw_portale?.supporto_audio || "").trim(),
      esito: String(row?.status || "").trim(),
    }));

    return res.json({ success: true, queue: normalized, total: normalized.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore caricamento coda waitlist" });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/waitlist/:id/priority
// ---------------------------------------------------------------------------
async function updatePriority(req, res) {
  try {
    const { id } = req.params;
    const direction = String(req.body?.direction || "").trim().toLowerCase();
    if (direction !== "up" && direction !== "down") {
      return res.status(400).json({ success: false, error: "direction deve essere 'up' o 'down'" });
    }

    const { data: rows, error } = await withTenantFilter(
      supabase.from("waitlist").select("id, priority, created_at"),
      req
    )
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ success: false, error: error.message });

    const queue = Array.isArray(rows) ? rows : [];
    const currentIndex = queue.findIndex((row) => String(row.id) === String(id));
    if (currentIndex < 0) {
      return res.status(404).json({ success: false, error: "Voce waitlist non trovata" });
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= queue.length) {
      return res.json({ success: true, moved: false, reason: "already-edge" });
    }

    const reordered = queue.slice();
    const [currentRow] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, currentRow);

    for (let index = 0; index < reordered.length; index += 1) {
      const row = reordered[index];
      const nextPriority = index + 1;
      if (Number(row.priority) === nextPriority) continue;
      let updateQuery = supabase.from("waitlist").update({ priority: nextPriority });
      updateQuery = withTenantFilter(updateQuery, req);
      const { error: updateError } = await updateQuery.eq("id", row.id);
      if (updateError) {
        return res.status(500).json({ success: false, error: updateError.message });
      }
    }

    return res.json({ success: true, moved: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore riordino waitlist" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/waitlist/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { id } = req.params;
    let query = supabase.from("waitlist").delete();
    query = withTenantFilter(query, req);
    const { data, error } = await query.eq("id", id).select("id");

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!Array.isArray(data) || !data.length) {
      return res.status(404).json({ success: false, error: "Voce waitlist non trovata" });
    }

    return res.json({ success: true, deleted: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore eliminazione waitlist" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/waitlist/:id/retry
// ---------------------------------------------------------------------------
async function retry(req, res) {
  try {
    const { id } = req.params;
    let query = supabase.from("waitlist").update({ status: "pending", last_error: null, last_attempt_at: null });
    query = withTenantFilter(query, req);
    const { data, error } = await query.eq("id", id).select("id,status").limit(1);

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!Array.isArray(data) || !data.length) {
      return res.status(404).json({ success: false, error: "Voce waitlist non trovata" });
    }

    return res.json({ success: true, row: data[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore reset waitlist" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/waitlist
// ---------------------------------------------------------------------------
async function create(req, res) {
  const { status, priority } = req.body;

  let candidateId;
  try {
    candidateId = await resolveCandidateId(req.body || {}, req);
  } catch (err) {
    return res.status(400).json({ error: err.message || "candidate_id non valido" });
  }

  const { data, error } = await supabase
    .from("waitlist")
    .insert([{
      candidate_id: candidateId,
      status: status || "pending",
      priority: Number.isFinite(priority) ? priority : 100,
      ...tenantField(req),
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

// ---------------------------------------------------------------------------
// PUT /api/waitlist/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  let updateQuery = supabase.from("waitlist").update({ status });
  updateQuery = withTenantFilter(updateQuery, req);
  const { error } = await updateQuery.eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
}

// ---------------------------------------------------------------------------
// POST /api/waitlist/bulk
// ---------------------------------------------------------------------------
async function bulk(req, res) {
  const { candidates } = req.body;

  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: "Deve essere fornito un array di candidati" });
  }

  const candidatesToInsert = [];
  for (const candidate of candidates) {
    const candidateId = await resolveCandidateId(candidate, req);
    candidatesToInsert.push({
      candidate_id: candidateId,
      status: candidate.status || "pending",
      priority: Number.isFinite(candidate.priority) ? candidate.priority : 100,
      created_at: new Date().toISOString(),
      ...tenantField(req),
    });
  }

  const { data, error } = await supabase.from("waitlist").insert(candidatesToInsert).select();
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    success: true,
    message: `${data.length} candidati aggiunti alla lista di attesa`,
    candidates: data,
  });
}

// ---------------------------------------------------------------------------
// POST /api/waitlist/from-portal
// ---------------------------------------------------------------------------
async function fromPortal(req, res) {
  const { candidati } = req.body;

  if (!candidati || !Array.isArray(candidati) || candidati.length === 0) {
    return res.status(400).json({ error: "Deve essere fornito un array di candidati dal portale" });
  }

  const candidatiToInsert = [];
  for (const candidate of candidati) {
    const candidateId = await resolveCandidateId({
      nome: candidate.nome,
      cognome: candidate.cognome,
      codice_fiscale: candidate.codice_fiscale || candidate.codice,
      data_nascita: candidate.data_nascita,
      comune_nascita: candidate.comune_nascita,
      provincia_nascita: candidate.provincia_nascita,
      ...tenantField(req),
    }, req);

    candidatiToInsert.push({
      candidate_id: candidateId,
      status: "pending",
      priority: 100,
      created_at: new Date().toISOString(),
      ...tenantField(req),
    });
  }

  const { data, error } = await supabase.from("waitlist").insert(candidatiToInsert).select();
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    success: true,
    message: `${data.length} candidati aggiunti dal portale`,
    candidati: data,
  });
}

// ---------------------------------------------------------------------------
// POST /api/waitlist/select
// ---------------------------------------------------------------------------
async function select(req, res) {
  const { candidateIds } = req.body;

  if (!Array.isArray(candidateIds) || !candidateIds.length) {
    return res.status(400).json({ error: "candidateIds deve essere un array non vuoto" });
  }

  const normalizedIds = candidateIds.map((id) => String(id).trim()).filter(Boolean);
  const selectedRows = [];

  for (let index = 0; index < normalizedIds.length; index += 1) {
    const candidateId = normalizedIds[index];
    const priority = index + 1;

    const tenantFilter = req?.autoscuolaId ? { autoscuola_id: req.autoscuolaId } : {};

    const { data: existing, error: findError } = await supabase
      .from("waitlist")
      .select("id")
      .eq("candidate_id", candidateId)
      .match(tenantFilter)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) return res.status(500).json({ error: findError.message });

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from("waitlist")
        .update({ status: "pending", priority, last_error: null, last_attempt_at: null })
        .eq("id", existing.id)
        .match(tenantFilter)
        .select("id,candidate_id,priority,status")
        .single();

      if (updateError) return res.status(500).json({ error: updateError.message });
      selectedRows.push(updated);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("waitlist")
      .insert([{ candidate_id: candidateId, priority, status: "pending", ...tenantField(req) }])
      .select("id,candidate_id,priority,status")
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });
    selectedRows.push(inserted);
  }

  res.json({ success: true, selected: selectedRows.length, waitlist: selectedRows });
}

// ---------------------------------------------------------------------------
// GET /api/admin/waitlist-integrity
// ---------------------------------------------------------------------------
async function integrityCheck(req, res) {
  const { data, error } = await withTenantFilter(
    supabase.from("waitlist").select("id, candidate_id, created_at, candidates(id)"),
    req
  ).order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const anomalies = rows.filter((row) => !row.candidate_id || !row.candidates?.id);

  res.json({
    total: rows.length,
    anomalies: anomalies.length,
    ok: anomalies.length === 0,
    details: anomalies,
  });
}

module.exports = {
  list,
  queue,
  updatePriority,
  remove,
  retry,
  create,
  update,
  bulk,
  fromPortal,
  select,
  integrityCheck,
};
