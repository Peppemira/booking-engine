/**
 * veicoliController.js
 * CRUD parco veicoli autoscuola.
 * Ispirato a iPatenteCloud Cap 5 — Gestione Parco Veicoli.
 */
"use strict";

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/veicoli
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const { stato, tipo, categoria_patente } = req.query;

    let q = supabase
      .from("veicoli")
      .select("*")
      .order("marca", { ascending: true });

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (stato)             q = q.eq("stato", stato);
    if (tipo)              q = q.eq("tipo", tipo);
    if (categoria_patente) q = q.eq("categoria_patente", categoria_patente);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/veicoli/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { data, error } = await supabase
      .from("veicoli")
      .select("*")
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();

    if (error) return res.status(404).json({ error: "Veicolo non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/veicoli
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const {
      targa, marca, modello, colore, anno, tipo, categoria_patente,
      km_acquisto, km_attuali, data_acquisto, data_immatricolazione,
      scadenza_revisione, scadenza_assicurazione, stato, note
    } = req.body;

    if (!targa) return res.status(400).json({ error: "Targa obbligatoria" });

    const { data, error } = await supabase
      .from("veicoli")
      .insert({
        autoscuola_id: autoscuolaId,
        targa: targa.toUpperCase().trim(),
        marca, modello, colore: colore || "#3B82F6",
        anno: anno ? parseInt(anno) : null,
        tipo: tipo || "auto",
        categoria_patente,
        km_acquisto: km_acquisto || 0,
        km_attuali: km_attuali || 0,
        data_acquisto: data_acquisto || null,
        data_immatricolazione: data_immatricolazione || null,
        scadenza_revisione: scadenza_revisione || null,
        scadenza_assicurazione: scadenza_assicurazione || null,
        stato: stato || "attivo",
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
// PUT /api/veicoli/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId;

    const allowed = [
      "targa","marca","modello","colore","anno","tipo","categoria_patente",
      "km_acquisto","km_attuali","data_acquisto","data_immatricolazione",
      "scadenza_revisione","scadenza_assicurazione","stato","note"
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (patch.targa) patch.targa = patch.targa.toUpperCase().trim();

    const { data, error } = await supabase
      .from("veicoli")
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
// DELETE /api/veicoli/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { error } = await supabase
      .from("veicoli")
      .delete()
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { list, getById, create, update, remove };
