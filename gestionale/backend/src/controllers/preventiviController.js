/**
 * preventiviController.js
 * CRUD preventivi con workflow: bozza → inviato → accettato → pratica.
 * Ispirato a iPatenteCloud Cap 9 — Gestione Clienti (preventivo workflow).
 */
"use strict";

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/preventivi
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const { stato, candidato_id, committente_id, data_da, data_a } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from("preventivi")
      .select(`
        *,
        candidates(id, cognome, nome, codice_fiscale),
        committenti(id, ragione_sociale, tipologia)
      `, { count: "exact" })
      .eq("autoscuola_id", autoscuolaId)
      .order("data_preventivo", { ascending: false })
      .range(offset, offset + limit - 1);

    if (stato)          q = q.eq("stato", stato);
    if (candidato_id)   q = q.eq("candidato_id", candidato_id);
    if (committente_id) q = q.eq("committente_id", committente_id);
    if (data_da)        q = q.gte("data_preventivo", data_da);
    if (data_a)         q = q.lte("data_preventivo", data_a);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/preventivi/statistiche
// ---------------------------------------------------------------------------
async function statistiche(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const anno = req.query.anno || new Date().getFullYear();

    const { data, error } = await supabase
      .from("preventivi")
      .select("stato, totale_finale")
      .eq("autoscuola_id", autoscuolaId)
      .gte("data_preventivo", `${anno}-01-01`)
      .lte("data_preventivo", `${anno}-12-31`);

    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      totale: (data || []).length,
      per_stato: {},
      valore_totale: 0,
      valore_accettati: 0,
      tasso_conversione: 0,
    };
    let accettati = 0;
    for (const p of data || []) {
      stats.per_stato[p.stato] = (stats.per_stato[p.stato] || 0) + 1;
      stats.valore_totale += Number(p.totale_finale || 0);
      if (p.stato === "accettato") {
        stats.valore_accettati += Number(p.totale_finale || 0);
        accettati++;
      }
    }
    stats.tasso_conversione = stats.totale > 0 ? Math.round((accettati / stats.totale) * 100) : 0;
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/preventivi/prossimo-numero
// ---------------------------------------------------------------------------
async function prossimoNumero(req, res) {
  try {
    const anno = new Date().getFullYear();
    const prefix = `PRV-${anno}-`;

    const { data, error } = await supabase
      .from("preventivi")
      .select("numero_preventivo")
      .eq("autoscuola_id", req.autoscuolaId)
      .ilike("numero_preventivo", `${prefix}%`)
      .order("numero_preventivo", { ascending: false })
      .limit(1);

    let next = 1;
    if (!error && data?.length) {
      const last = data[0].numero_preventivo.replace(prefix, "");
      next = parseInt(last, 10) + 1;
      if (isNaN(next)) next = 1;
    }
    res.json({ numero: `${prefix}${String(next).padStart(3, "0")}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/preventivi/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { data, error } = await supabase
      .from("preventivi")
      .select(`*, candidates(id, cognome, nome), committenti(id, ragione_sociale, tipologia)`)
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();

    if (error) return res.status(404).json({ error: "Preventivo non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/preventivi
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    const {
      candidato_id, committente_id, numero_preventivo,
      data_preventivo, data_scadenza, stato,
      totale_imponibile, totale_iva, totale_finale,
      note_interne, note_cliente, voci
    } = req.body;

    const { data, error } = await supabase
      .from("preventivi")
      .insert({
        autoscuola_id: autoscuolaId,
        candidato_id: candidato_id || null,
        committente_id: committente_id || null,
        numero_preventivo: numero_preventivo || null,
        data_preventivo: data_preventivo || new Date().toISOString().split("T")[0],
        data_scadenza: data_scadenza || null,
        stato: stato || "bozza",
        totale_imponibile: totale_imponibile || 0,
        totale_iva: totale_iva || 0,
        totale_finale: totale_finale || 0,
        note_interne: note_interne || null,
        note_cliente: note_cliente || null,
        voci: voci || [],
      })
      .select("*, candidates(id, cognome, nome), committenti(id, ragione_sociale)")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/preventivi/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const allowed = [
      "candidato_id", "committente_id", "numero_preventivo",
      "data_preventivo", "data_scadenza", "stato",
      "totale_imponibile", "totale_iva", "totale_finale",
      "note_interne", "note_cliente", "voci"
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data, error } = await supabase
      .from("preventivi")
      .update(patch)
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId)
      .select("*, candidates(id, cognome, nome), committenti(id, ragione_sociale)")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/preventivi/:id/stato
// ---------------------------------------------------------------------------
async function cambiaStato(req, res) {
  try {
    const { stato } = req.body;
    const validi = ["bozza", "inviato", "accettato", "rifiutato", "scaduto"];
    if (!validi.includes(stato)) {
      return res.status(400).json({ error: `Stato non valido. Valori: ${validi.join(", ")}` });
    }
    const { data, error } = await supabase
      .from("preventivi")
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
// DELETE /api/preventivi/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { error } = await supabase
      .from("preventivi")
      .delete()
      .eq("id", req.params.id)
      .eq("autoscuola_id", req.autoscuolaId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { list, getById, create, update, remove, cambiaStato, statistiche, prossimoNumero };
