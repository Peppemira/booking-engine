/**
 * visiteMedicheController.js
 * CRUD visite mediche con calendario e reminder WhatsApp.
 * Ispirato a iPatenteCloud Cap 14 — Calendario Visite Mediche.
 */
"use strict";

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/visite-mediche
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const { stato, tipo_visita, medico, candidato_id, data_da, data_a } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from("visite_mediche")
      .select("*, candidates(id, cognome, nome, codice_fiscale)", { count: "exact" })
      .eq("autoscuola_id", autoscuolaId)
      .order("data_visita", { ascending: true })
      .order("ora_inizio", { ascending: true })
      .range(offset, offset + limit - 1);

    if (stato)        q = q.eq("stato", stato);
    if (tipo_visita)  q = q.eq("tipo_visita", tipo_visita);
    if (medico)       q = q.ilike("medico", `%${medico}%`);
    if (candidato_id) q = q.eq("candidato_id", candidato_id);
    if (data_da)      q = q.gte("data_visita", data_da);
    if (data_a)       q = q.lte("data_visita", data_a);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/visite-mediche/prossime — visite nei prossimi N giorni
// ---------------------------------------------------------------------------
async function prossime(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const giorni = parseInt(req.query.giorni || "7", 10);
    const oggi = new Date().toISOString().split("T")[0];
    const limite = new Date(Date.now() + giorni * 86400000).toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("visite_mediche")
      .select("*, candidates(id, cognome, nome)")
      .eq("autoscuola_id", autoscuolaId)
      .in("stato", ["prenotata", "confermata"])
      .gte("data_visita", oggi)
      .lte("data_visita", limite)
      .order("data_visita", { ascending: true })
      .order("ora_inizio", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/visite-mediche/statistiche
// ---------------------------------------------------------------------------
async function statistiche(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const anno = req.query.anno || new Date().getFullYear();

    const { data, error } = await supabase
      .from("visite_mediche")
      .select("stato, esito, tipo_visita")
      .eq("autoscuola_id", autoscuolaId)
      .gte("data_visita", `${anno}-01-01`)
      .lte("data_visita", `${anno}-12-31`);

    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      totale: (data || []).length,
      per_stato: {},
      per_esito: {},
      per_tipo: {},
    };
    for (const v of data || []) {
      stats.per_stato[v.stato] = (stats.per_stato[v.stato] || 0) + 1;
      if (v.esito) stats.per_esito[v.esito] = (stats.per_esito[v.esito] || 0) + 1;
      stats.per_tipo[v.tipo_visita] = (stats.per_tipo[v.tipo_visita] || 0) + 1;
    }
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/visite-mediche/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { data, error } = await supabase
      .from("visite_mediche")
      .select("*, candidates(id, cognome, nome, codice_fiscale)")
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();

    if (error) return res.status(404).json({ error: "Visita non trovata" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/visite-mediche
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const {
      candidato_id, data_visita, ora_inizio, ora_fine,
      medico, luogo, tipo_visita, stato, note
    } = req.body;

    if (!data_visita) return res.status(400).json({ error: "Data visita obbligatoria" });

    const { data, error } = await supabase
      .from("visite_mediche")
      .insert({
        autoscuola_id: autoscuolaId,
        candidato_id: candidato_id || null,
        data_visita,
        ora_inizio: ora_inizio || null,
        ora_fine: ora_fine || null,
        medico: medico || null,
        luogo: luogo || null,
        tipo_visita: tipo_visita || "prima_visita",
        stato: stato || "prenotata",
        note: note || null,
      })
      .select("*, candidates(id, cognome, nome)")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/visite-mediche/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const allowed = [
      "candidato_id", "data_visita", "ora_inizio", "ora_fine",
      "medico", "luogo", "tipo_visita", "stato", "esito", "note",
      "reminder_inviato", "reminder_inviato_il"
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data, error } = await supabase
      .from("visite_mediche")
      .update(patch)
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .select("*, candidates(id, cognome, nome)")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/visite-mediche/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { error } = await supabase
      .from("visite_mediche")
      .delete()
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { list, getById, create, update, remove, prossime, statistiche };
