/**
 * committentiController.js
 * CRUD committenti (terzi: aziende, enti, altre autoscuole).
 * Ispirato a iPatenteCloud Cap 11 — Committenti.
 */
"use strict";

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/committenti
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const { tipologia, search, attivo } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from("committenti")
      .select("*", { count: "exact" })
      .eq("autoscuola_id", autoscuolaId)
      .order("ragione_sociale", { ascending: true })
      .range(offset, offset + limit - 1);

    if (tipologia) q = q.eq("tipologia", tipologia);
    if (attivo !== undefined) q = q.eq("attivo", attivo === "true");
    if (search) {
      q = q.or(
        `ragione_sociale.ilike.%${search}%,partita_iva.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/committenti/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { data, error } = await supabase
      .from("committenti")
      .select("*")
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();

    if (error) return res.status(404).json({ error: "Committente non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/committenti
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const {
      tipologia, ragione_sociale, nome_referente, cognome_referente,
      codice_fiscale, partita_iva, email, telefono,
      indirizzo, cap, comune, provincia,
      codice_destinatario, pec, note
    } = req.body;

    if (!ragione_sociale) {
      return res.status(400).json({ error: "Ragione sociale obbligatoria" });
    }

    const { data, error } = await supabase
      .from("committenti")
      .insert({
        autoscuola_id: autoscuolaId,
        tipologia: tipologia || "AZIENDA",
        ragione_sociale, nome_referente, cognome_referente,
        codice_fiscale, partita_iva, email, telefono,
        indirizzo, cap, comune, provincia,
        codice_destinatario, pec, note,
        attivo: true
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
// PUT /api/committenti/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId;

    const allowed = [
      "tipologia","ragione_sociale","nome_referente","cognome_referente",
      "codice_fiscale","partita_iva","email","telefono",
      "indirizzo","cap","comune","provincia",
      "codice_destinatario","pec","note","attivo"
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data, error } = await supabase
      .from("committenti")
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
// DELETE /api/committenti/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { error } = await supabase
      .from("committenti")
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
