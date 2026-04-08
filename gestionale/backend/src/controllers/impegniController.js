/**
 * impegniController.js
 * CRUD impegni e scadenze (task, promemoria, appuntamenti).
 * Ispirato a iPatenteCloud Cap 15 — Impegni e Scadenze.
 */
"use strict";

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/impegni
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const { stato, tipo, priorita, candidato_id, collaboratore_id, data_da, data_a } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from("impegni_scadenze")
      .select(`
        *,
        candidates(id, cognome, nome),
        collaboratori(id, cognome, nome)
      `, { count: "exact" })
      .eq("autoscuola_id", autoscuolaId)
      .order("data_scadenza", { ascending: true })
      .range(offset, offset + limit - 1);

    if (stato)           q = q.eq("stato", stato);
    if (tipo)            q = q.eq("tipo", tipo);
    if (priorita)        q = q.eq("priorita", priorita);
    if (candidato_id)    q = q.eq("candidato_id", candidato_id);
    if (collaboratore_id) q = q.eq("collaboratore_id", collaboratore_id);
    if (data_da)         q = q.gte("data_scadenza", data_da);
    if (data_a)          q = q.lte("data_scadenza", data_a);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/impegni/in-scadenza — impegni aperti con scadenza entro N giorni
// ---------------------------------------------------------------------------
async function inScadenza(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const giorni = parseInt(req.query.giorni || "7", 10);
    const oggi = new Date().toISOString().split("T")[0];
    const limite = new Date(Date.now() + giorni * 86400000).toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("impegni_scadenze")
      .select(`*, candidates(id, cognome, nome)`)
      .eq("autoscuola_id", autoscuolaId)
      .in("stato", ["aperto", "in_corso"])
      .gte("data_scadenza", oggi)
      .lte("data_scadenza", limite)
      .order("data_scadenza", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/impegni/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { data, error } = await supabase
      .from("impegni_scadenze")
      .select(`*, candidates(id, cognome, nome), collaboratori(id, cognome, nome)`)
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();

    if (error) return res.status(404).json({ error: "Impegno non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/impegni
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const {
      titolo, descrizione, tipo, data_inizio, data_fine, data_scadenza,
      priorita, stato, notifica_abilitata, notifica_minuti,
      candidato_id, collaboratore_id, note
    } = req.body;

    if (!titolo) return res.status(400).json({ error: "Titolo obbligatorio" });

    const { data, error } = await supabase
      .from("impegni_scadenze")
      .insert({
        autoscuola_id: autoscuolaId,
        titolo, descrizione, tipo: tipo || "promemoria",
        data_inizio: data_inizio || null,
        data_fine: data_fine || null,
        data_scadenza: data_scadenza || null,
        priorita: priorita || "normale",
        stato: stato || "aperto",
        notifica_abilitata: notifica_abilitata || false,
        notifica_minuti: notifica_minuti || 60,
        notifica_inviata: false,
        candidato_id: candidato_id || null,
        collaboratore_id: collaboratore_id || null,
        note
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/impegni/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId;

    const allowed = [
      "titolo","descrizione","tipo","data_inizio","data_fine","data_scadenza",
      "priorita","stato","notifica_abilitata","notifica_minuti","notifica_inviata",
      "candidato_id","collaboratore_id","note"
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data, error } = await supabase
      .from("impegni_scadenze")
      .update(patch)
      .eq("id", id)
      .eq("autoscuola_id", autoscuolaId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/impegni/:id/stato — cambio rapido stato
// ---------------------------------------------------------------------------
async function cambiaStato(req, res) {
  try {
    const { stato } = req.body;
    const validi = ["aperto","in_corso","completato","annullato","scaduto"];
    if (!validi.includes(stato)) {
      return res.status(400).json({ error: "Stato non valido" });
    }
    const { data, error } = await supabase
      .from("impegni_scadenze")
      .update({ stato })
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/impegni/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { error } = await supabase
      .from("impegni_scadenze")
      .delete()
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { list, getById, create, update, remove, inScadenza, cambiaStato };
