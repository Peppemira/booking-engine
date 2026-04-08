/**
 * praticheController.js
 * =====================
 * CRUD per la tabella pratiche_patente.
 * Equivalente GeCA: gestione pratiche / wizard nuova pratica.
 */

"use strict";

const supabase = require("../database/supabase");

const TABLE = "pratiche_patente";

// ---------------------------------------------------------------------------
// GET /api/pratiche
// Query params: candidate_id, stato, tipo_pratica, limit, offset
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id, candidato_id, stato, tipo_pratica } = req.query;
    const limit  = Math.min(parseInt(req.query.limit || "200", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from(TABLE)
      .select(`
        *,
        candidates:candidato_id (
          id, cognome, nome, codice_fiscale, categoria_patente,
          codice_foglio_rosa, data_nascita, comune_nascita, provincia_nascita
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const cid = candidate_id || candidato_id;
    if (cid) q = q.eq("candidato_id", cid);
    if (stato) q = q.eq("stato", stato);
    if (tipo_pratica) q = q.eq("tipo_pratica", tipo_pratica);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio pratiche" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/pratiche/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase
      .from(TABLE)
      .select("*, candidates:candidato_id (*)")
      .eq("id", id)
      .maybeSingle();
    if (autoscuolaId) q = supabase.from(TABLE).select("*, candidates:candidato_id (*)").eq("id", id).eq("autoscuola_id", autoscuolaId).maybeSingle();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Pratica non trovata" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura pratica" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/pratiche
// Body: { candidato_id, tipo_pratica, categoria, stato?, bollettini?,
//         note?, codice_autoscuola?, tipo_trasmissione?, data_richiesta?,
//         codice_estremi_pagamento? }
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    if (!body.candidato_id) {
      return res.status(400).json({ error: "candidato_id obbligatorio" });
    }

    const TIPO_TRASMISSIONE_MAP = {
      ESAME:             "trasmissione_pratica_conseguimento",
      RINNOVO:           "trasmissione_pratica_rinnovo",
      CQC:               "trasmissione_pratica_conseguimento_cqc",
      RINNOVO_CQC:       "rinnovo_cqc",
      CERTIFICATO_MEDICO:"trasmissione_pratica_rinnovo_medico",
      DUPLICATO:         "trasmissione_pratica_altro",
      GUIDA_ACCOMPAGNATA:"trasmissione_pratica_conseguimento_fase1",
      ALTRO:             "trasmissione_pratica_altro",
    };

    const tipoTrasmissione = body.tipo_trasmissione ||
      TIPO_TRASMISSIONE_MAP[body.tipo_pratica] ||
      "trasmissione_pratica_altro";

    const payload = {
      candidato_id:              body.candidato_id,
      tipo_pratica:              body.tipo_pratica            || "ESAME",
      categoria:                 body.categoria               || body.categoria_patente || null,
      categoria_patente:         body.categoria_patente       || body.categoria        || null,
      stato:                     body.stato                   || "attivo",
      stato_pratica:             body.stato_pratica           || "attivo",
      tipo_trasmissione:         tipoTrasmissione,
      data_richiesta:            body.data_richiesta          || new Date().toISOString().slice(0, 10),
      note:                      body.note                    || null,
      codice_autoscuola:         body.codice_autoscuola       || null,
      codice_estremi_pagamento:  body.codice_estremi_pagamento || null,
      bollettini:                body.bollettini              ? JSON.stringify(body.bollettini) : null,
      ...(autoscuolaId && { autoscuola_id: autoscuolaId }),
    };

    const { data, error } = await supabase.from(TABLE).insert(payload).select("*, candidates:candidato_id (*)").single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, pratica: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione pratica" });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/pratiche/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    const allowed = [
      "tipo_pratica", "categoria", "categoria_patente", "stato", "stato_pratica",
      "tipo_trasmissione", "data_richiesta", "note", "codice_autoscuola",
      "codice_estremi_pagamento", "progressivo_portale", "id_richiesta_portale",
      "data_trasmissione_portale", "messaggio_portale", "bollettini",
      "foto_path", "firma_path", "ultimo_errore_portale",
    ];
    const payload = { updated_at: new Date().toISOString() };
    allowed.forEach((k) => {
      if (body[k] !== undefined) payload[k] = body[k];
    });
    if (payload.bollettini && typeof payload.bollettini === "object") {
      payload.bollettini = JSON.stringify(payload.bollettini);
    }

    let q = supabase.from(TABLE).update(payload).eq("id", id).select().single();
    if (autoscuolaId) q = supabase.from(TABLE).update(payload).eq("id", id).eq("autoscuola_id", autoscuolaId).select().single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Pratica non trovata" });
    res.json({ success: true, pratica: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento pratica" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/pratiche/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase.from(TABLE).delete().eq("id", id).select("id").single();
    if (autoscuolaId) q = supabase.from(TABLE).delete().eq("id", id).eq("autoscuola_id", autoscuolaId).select("id").single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Pratica non trovata" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione pratica" });
  }
}

module.exports = { list, getById, create, update, remove };
