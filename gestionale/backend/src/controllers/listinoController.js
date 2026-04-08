/**
 * listinoController.js
 * CRUD listino prezzi servizi autoscuola.
 * Ispirato a iPatenteCloud Cap 6 — Listino Prezzi.
 */
"use strict";

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/listino
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const { categoria, tipo_servizio, attivo } = req.query;

    let q = supabase
      .from("listino_prezzi")
      .select("*")
      .eq("autoscuola_id", autoscuolaId)
      .order("categoria", { ascending: true })
      .order("ordine", { ascending: true });

    if (categoria)     q = q.eq("categoria", categoria);
    if (tipo_servizio) q = q.eq("tipo_servizio", tipo_servizio);
    if (attivo !== undefined) q = q.eq("attivo", attivo === "true" || attivo === true);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/listino/categorie — lista categorie distinte
// ---------------------------------------------------------------------------
async function categorie(req, res) {
  try {
    const { data, error } = await supabase
      .from("listino_prezzi")
      .select("categoria")
      .eq("autoscuola_id", req.autoscuolaId)
      .eq("attivo", true)
      .order("categoria");

    if (error) return res.status(500).json({ error: error.message });
    const cats = [...new Set((data || []).map((r) => r.categoria))];
    res.json({ data: cats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/listino/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { data, error } = await supabase
      .from("listino_prezzi")
      .select("*")
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();

    if (error) return res.status(404).json({ error: "Voce listino non trovata" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/listino
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const {
      categoria, codice, descrizione, descrizione_estesa, tipo_servizio,
      prezzo_base, iva_pct, prezzo_iva_inclusa,
      rateizzabile, num_rate_default, blocco_morosi,
      attivo, ordine, note
    } = req.body;

    if (!categoria) return res.status(400).json({ error: "Categoria obbligatoria" });
    if (!descrizione) return res.status(400).json({ error: "Descrizione obbligatoria" });

    const { data, error } = await supabase
      .from("listino_prezzi")
      .insert({
        autoscuola_id: autoscuolaId,
        categoria, codice, descrizione, descrizione_estesa,
        tipo_servizio: tipo_servizio || "corso",
        prezzo_base: parseFloat(prezzo_base) || 0,
        iva_pct: parseFloat(iva_pct) || 22,
        prezzo_iva_inclusa: prezzo_iva_inclusa || false,
        rateizzabile: rateizzabile || false,
        num_rate_default: parseInt(num_rate_default) || 1,
        blocco_morosi: blocco_morosi || false,
        attivo: attivo !== false,
        ordine: parseInt(ordine) || 0,
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
// PUT /api/listino/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId;

    const allowed = [
      "categoria","codice","descrizione","descrizione_estesa","tipo_servizio",
      "prezzo_base","iva_pct","prezzo_iva_inclusa",
      "rateizzabile","num_rate_default","blocco_morosi",
      "attivo","ordine","note"
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data, error } = await supabase
      .from("listino_prezzi")
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
// DELETE /api/listino/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { error } = await supabase
      .from("listino_prezzi")
      .delete()
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { list, getById, create, update, remove, categorie };
