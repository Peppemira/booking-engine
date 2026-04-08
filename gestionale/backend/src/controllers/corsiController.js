/**
 * Controller REST per corsi (GeCorsi, PRESENZECORSI, auleLezioni).
 * Gestisce iscrizioni candidati a corsi e presenze per singola lezione.
 *
 * Tabelle: corsi_sessions, corsi_presenze
 * Equivalente GeCA: GeCorsi, menuCorsi, auleLezioni, gestAule, PRESENZECORSI
 */

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/corsi
// Query: candidate_id, tipo_corso, stato, data_da, data_a, limit, offset
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id, tipo_corso, stato, data_da, data_a } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from("corsi_sessions")
      .select(
        `id, candidate_id, tipo_corso, data_inizio, data_fine,
         ente_organizzatore, sede_corso, ore_totali, ore_frequentate,
         stato, esito, note, created_at, updated_at,
         candidates(id, cognome, nome, categoria_patente, codice_fiscale, patente_numero)`,
        { count: "exact" }
      )
      .order("data_inizio", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (candidate_id) q = q.eq("candidate_id", candidate_id);
    if (tipo_corso) q = q.eq("tipo_corso", tipo_corso);
    if (stato) q = q.eq("stato", stato);
    if (data_da) q = q.gte("data_inizio", data_da);
    if (data_a) q = q.lte("data_inizio", data_a);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio corsi" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/corsi/conteggio
// Conteggio corsi per tipo/stato, opzionalmente filtrato per candidate_id
// ---------------------------------------------------------------------------
async function conteggio(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id, tipo_corso, stato } = req.query;

    let q = supabase
      .from("corsi_sessions")
      .select(
        "id, candidate_id, tipo_corso, stato, esito, ore_totali, ore_frequentate, candidates(id, cognome, nome, categoria_patente)",
        { count: "exact" }
      );

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (candidate_id) q = q.eq("candidate_id", candidate_id);
    if (tipo_corso) q = q.eq("tipo_corso", tipo_corso);
    if (stato) q = q.eq("stato", stato);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];

    if (candidate_id) {
      // Riepilogo per candidato singolo
      const totOreFreq = rows.reduce((s, r) => s + parseFloat(r.ore_frequentate || 0), 0);
      const totOreTot = rows.reduce((s, r) => s + parseFloat(r.ore_totali || 0), 0);
      const byTipo = {};
      rows.forEach((r) => {
        if (!byTipo[r.tipo_corso]) byTipo[r.tipo_corso] = { count: 0, completati: 0, idonei: 0 };
        byTipo[r.tipo_corso].count++;
        if (r.stato === "completato") byTipo[r.tipo_corso].completati++;
        if (r.esito === "idoneo") byTipo[r.tipo_corso].idonei++;
      });
      return res.json({
        totale: rows.length,
        in_corso: rows.filter((r) => r.stato === "in_corso").length,
        completati: rows.filter((r) => r.stato === "completato").length,
        idonei: rows.filter((r) => r.esito === "idoneo").length,
        ore_frequentate: Math.round(totOreFreq * 10) / 10,
        ore_totali: Math.round(totOreTot * 10) / 10,
        per_tipo: byTipo,
      });
    }

    // Conteggio globale per candidato
    const perCandidato = {};
    rows.forEach((r) => {
      const k = r.candidate_id;
      if (!perCandidato[k]) {
        perCandidato[k] = {
          candidate_id: k,
          candidato: r.candidates ? `${r.candidates.cognome} ${r.candidates.nome}` : k,
          categoria: r.candidates?.categoria_patente || "–",
          count: 0,
          completati: 0,
          idonei: 0,
        };
      }
      perCandidato[k].count++;
      if (r.stato === "completato") perCandidato[k].completati++;
      if (r.esito === "idoneo") perCandidato[k].idonei++;
    });

    res.json({
      totale: rows.length,
      perCandidato: Object.values(perCandidato).sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore conteggio corsi" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/corsi/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase
      .from("corsi_sessions")
      .select("*, candidates(id, cognome, nome, categoria_patente, codice_fiscale)")
      .eq("id", id)
      .maybeSingle();
    if (autoscuolaId)
      q = supabase
        .from("corsi_sessions")
        .select("*, candidates(id, cognome, nome, categoria_patente, codice_fiscale)")
        .eq("id", id)
        .eq("autoscuola_id", autoscuolaId)
        .maybeSingle();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Corso non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura corso" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/corsi
// Body: { candidate_id, tipo_corso, data_inizio, data_fine, ente_organizzatore,
//         sede_corso, ore_totali, ore_frequentate, stato, esito, note }
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    if (!body.candidate_id || !body.tipo_corso) {
      return res.status(400).json({ error: "candidate_id e tipo_corso sono obbligatori" });
    }
    const payload = {
      candidate_id: body.candidate_id,
      tipo_corso: body.tipo_corso,
      data_inizio: body.data_inizio || null,
      data_fine: body.data_fine || null,
      ente_organizzatore: body.ente_organizzatore || null,
      sede_corso: body.sede_corso || null,
      ore_totali: body.ore_totali != null ? parseFloat(body.ore_totali) : null,
      ore_frequentate: body.ore_frequentate != null ? parseFloat(body.ore_frequentate) : null,
      stato: body.stato || "in_corso",
      esito: body.esito || null,
      note: body.note || null,
      ...(autoscuolaId && { autoscuola_id: autoscuolaId }),
    };
    const { data, error } = await supabase.from("corsi_sessions").insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, corso: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione corso" });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/corsi/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    const allowed = [
      "tipo_corso", "data_inizio", "data_fine", "ente_organizzatore",
      "sede_corso", "ore_totali", "ore_frequentate", "stato", "esito", "note",
    ];
    const payload = {};
    allowed.forEach((k) => { if (body[k] !== undefined) payload[k] = body[k]; });
    payload.updated_at = new Date().toISOString();

    let q = supabase.from("corsi_sessions").update(payload).eq("id", id).select().single();
    if (autoscuolaId)
      q = supabase.from("corsi_sessions").update(payload).eq("id", id).eq("autoscuola_id", autoscuolaId).select().single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Corso non trovato" });
    res.json({ success: true, corso: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento corso" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/corsi/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase.from("corsi_sessions").delete().eq("id", id).select("id").single();
    if (autoscuolaId)
      q = supabase.from("corsi_sessions").delete().eq("id", id).eq("autoscuola_id", autoscuolaId).select("id").single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Corso non trovato" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione corso" });
  }
}

// ===========================================================================
// PRESENZE
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/corsi/:corsiSessionId/presenze
// ---------------------------------------------------------------------------
async function listPresenze(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { corsiSessionId } = req.params;

    let q = supabase
      .from("corsi_presenze")
      .select("*")
      .eq("corsi_session_id", corsiSessionId)
      .order("data_lezione", { ascending: true });

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio presenze" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/corsi/:corsiSessionId/presenze
// Body: { data_lezione, ora_inizio, ora_fine, argomento, docente, ore, presente, note }
// ---------------------------------------------------------------------------
async function createPresenza(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { corsiSessionId } = req.params;
    const body = req.body || {};

    if (!body.data_lezione) {
      return res.status(400).json({ error: "data_lezione è obbligatoria" });
    }

    // Recupera candidate_id dal corso padre
    const { data: corso } = await supabase
      .from("corsi_sessions")
      .select("candidate_id")
      .eq("id", corsiSessionId)
      .maybeSingle();

    const payload = {
      corsi_session_id: corsiSessionId,
      candidate_id: corso?.candidate_id || null,
      data_lezione: body.data_lezione,
      ora_inizio: body.ora_inizio || null,
      ora_fine: body.ora_fine || null,
      argomento: body.argomento || null,
      docente: body.docente || null,
      ore: body.ore != null ? parseFloat(body.ore) : null,
      presente: body.presente !== undefined ? Boolean(body.presente) : true,
      note: body.note || null,
      ...(autoscuolaId && { autoscuola_id: autoscuolaId }),
    };

    const { data, error } = await supabase.from("corsi_presenze").insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, presenza: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione presenza" });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/corsi/:corsiSessionId/presenze/:id
// ---------------------------------------------------------------------------
async function updatePresenza(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { id } = req.params;
    const body = req.body || {};
    const allowed = ["data_lezione", "ora_inizio", "ora_fine", "argomento", "docente", "ore", "presente", "note"];
    const payload = {};
    allowed.forEach((k) => { if (body[k] !== undefined) payload[k] = body[k]; });

    let q = supabase.from("corsi_presenze").update(payload).eq("id", id).select().single();
    if (autoscuolaId)
      q = supabase.from("corsi_presenze").update(payload).eq("id", id).eq("autoscuola_id", autoscuolaId).select().single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Presenza non trovata" });
    res.json({ success: true, presenza: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento presenza" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/corsi/:corsiSessionId/presenze/:id
// ---------------------------------------------------------------------------
async function removePresenza(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { id } = req.params;
    let q = supabase.from("corsi_presenze").delete().eq("id", id).select("id").single();
    if (autoscuolaId)
      q = supabase.from("corsi_presenze").delete().eq("id", id).eq("autoscuola_id", autoscuolaId).select("id").single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Presenza non trovata" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione presenza" });
  }
}

module.exports = {
  list, conteggio, getById, create, update, remove,
  listPresenze, createPresenza, updatePresenza, removePresenza,
};
