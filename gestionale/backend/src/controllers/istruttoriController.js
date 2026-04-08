/**
 * istruttoriController.js
 * =======================
 * CRUD istruttori con qualifiche, orari e abbinamento candidati.
 * Tabella: istruttori (+ guide_sessions.istruttore_id FK)
 * Punto 20.
 */

"use strict";

const supabase = require("../database/supabase");

const TABLE = "istruttori";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function autoscuolaFilter(q, req) {
  const id = req?.autoscuolaId;
  return id ? q.eq("autoscuola_id", id) : q;
}

// ─── List ─────────────────────────────────────────────────────────────────────

async function list(req, res) {
  try {
    const soloAttivi = req.query.attivi !== "0";
    let q = supabase
      .from(TABLE)
      .select("*")
      .order("cognome", { ascending: true });
    q = autoscuolaFilter(q, req);
    if (soloAttivi) q = q.eq("attivo", true);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio istruttori" });
  }
}

// ─── Get by ID ────────────────────────────────────────────────────────────────

async function getById(req, res) {
  try {
    const { id } = req.params;
    let q = supabase.from(TABLE).select("*").eq("id", id);
    q = autoscuolaFilter(q, req);
    const { data, error } = await q.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Istruttore non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura istruttore" });
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

async function create(req, res) {
  try {
    const body = req.body || {};
    if (!body.cognome || !body.nome) {
      return res.status(400).json({ error: "cognome e nome obbligatori" });
    }
    const payload = {
      autoscuola_id:       req.autoscuolaId || null,
      cognome:             String(body.cognome).trim(),
      nome:                String(body.nome).trim(),
      codice_fiscale:      body.codice_fiscale || null,
      data_nascita:        body.data_nascita   || null,
      email:               body.email          || null,
      telefono:            body.telefono        || null,
      qualifiche:          Array.isArray(body.qualifiche) ? body.qualifiche : [],
      data_abilitazione:   body.data_abilitazione || null,
      numero_patente:      body.numero_patente    || null,
      orari_disponibilita: body.orari_disponibilita || null,
      note:                body.note  || null,
      attivo:              body.attivo !== false,
    };
    const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, istruttore: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione istruttore" });
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────

async function update(req, res) {
  try {
    const { id }  = req.params;
    const body    = req.body || {};
    const allowed = [
      "cognome","nome","codice_fiscale","data_nascita","email","telefono",
      "qualifiche","data_abilitazione","numero_patente","orari_disponibilita","note","attivo",
    ];
    const payload = {};
    for (const k of allowed) {
      if (body[k] !== undefined) payload[k] = body[k];
    }
    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "Nessun campo da aggiornare" });
    }
    payload.updated_at = new Date().toISOString();
    let q = supabase.from(TABLE).update(payload).eq("id", id);
    if (req.autoscuolaId) q = q.eq("autoscuola_id", req.autoscuolaId);
    const { data, error } = await q.select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, istruttore: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento istruttore" });
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

async function remove(req, res) {
  try {
    const { id } = req.params;
    let q = supabase.from(TABLE).delete().eq("id", id);
    if (req.autoscuolaId) q = q.eq("autoscuola_id", req.autoscuolaId);
    const { error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione istruttore" });
  }
}

// ─── Guide per istruttore ─────────────────────────────────────────────────────

async function guideIstruttore(req, res) {
  try {
    const { id } = req.params;
    const limit  = Math.min(parseInt(req.query.limit || "100", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);
    const { data, error, count } = await supabase
      .from("guide_sessions")
      .select("id,data_ora,tipo_guida,percorso,km,esito,durata_minuti,candidates(id,cognome,nome,categoria_patente)", { count: "exact" })
      .eq("istruttore_id", id)
      .order("data_ora", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore guide istruttore" });
  }
}

module.exports = { list, getById, create, update, remove, guideIstruttore };
