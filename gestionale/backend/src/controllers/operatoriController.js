/**
 * OperatoriController — Punto 24
 * CRUD operatori per sede, login operatore, gestione ruoli.
 * Ruoli: admin | operatore | segreteria | istruttore
 */

const bcrypt   = require("bcryptjs");
const supabase = require("../database/supabase");

const TABLE = "operatori";
const RUOLI_VALIDI = ["admin", "operatore", "segreteria", "istruttore"];

// ─── Helpers ────────────────────────────────────────────────────────────────
function stripPass(op) {
  if (!op) return op;
  const { password_hash, ...rest } = op;
  return rest;
}

// ─── GET /api/operatori ─────────────────────────────────────────────────────
async function list(req, res) {
  try {
    const autoscuola_id = req.autoscuolaId;
    const limit  = Math.min(parseInt(req.query.limit  || "200", 10), 500);
    const offset = Math.max(parseInt(req.query.offset || "0",   10), 0);
    const { ruolo, attivo } = req.query;

    let q = supabase.from(TABLE)
      .select("id,autoscuola_id,email,ruolo,nome,cognome,telefono,istruttore_id,attivo,ultimo_accesso,created_at", { count: "exact" })
      .eq("autoscuola_id", autoscuola_id)
      .order("cognome", { ascending: true })
      .range(offset, offset + limit - 1);

    if (ruolo)  q = q.eq("ruolo", ruolo);
    if (attivo !== undefined) q = q.eq("attivo", attivo !== "false");

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── GET /api/operatori/:id ─────────────────────────────────────────────────
async function getById(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from(TABLE)
      .select("id,autoscuola_id,email,ruolo,nome,cognome,telefono,istruttore_id,attivo,ultimo_accesso,created_at")
      .eq("id", id)
      .eq("autoscuola_id", req.autoscuolaId)
      .single();
    if (error || !data) return res.status(404).json({ error: "Operatore non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/operatori ────────────────────────────────────────────────────
async function create(req, res) {
  try {
    const { email, password, ruolo, nome, cognome, telefono, istruttore_id } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email e password obbligatori" });
    if (!RUOLI_VALIDI.includes(ruolo)) return res.status(400).json({ error: `ruolo non valido: ${ruolo}` });

    // Check email univoca per autoscuola
    const { data: existing } = await supabase.from(TABLE)
      .select("id").eq("autoscuola_id", req.autoscuolaId).eq("email", email.toLowerCase()).maybeSingle();
    if (existing) return res.status(409).json({ error: "Email già registrata per questa autoscuola" });

    const password_hash = await bcrypt.hash(String(password), 10);
    const { data, error } = await supabase.from(TABLE)
      .insert([{
        autoscuola_id: req.autoscuolaId,
        email: email.toLowerCase(),
        password_hash,
        ruolo,
        nome: nome || null,
        cognome: cognome || null,
        telefono: telefono || null,
        istruttore_id: istruttore_id || null,
        attivo: true,
      }])
      .select("id,email,ruolo,nome,cognome,telefono,attivo,created_at")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, operatore: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── PUT /api/operatori/:id ─────────────────────────────────────────────────
async function update(req, res) {
  try {
    const { id } = req.params;
    const { ruolo, nome, cognome, telefono, istruttore_id, attivo, password } = req.body || {};

    if (ruolo && !RUOLI_VALIDI.includes(ruolo)) {
      return res.status(400).json({ error: `ruolo non valido: ${ruolo}` });
    }

    const payload = { updated_at: new Date().toISOString() };
    if (ruolo !== undefined)        payload.ruolo = ruolo;
    if (nome !== undefined)         payload.nome = nome;
    if (cognome !== undefined)      payload.cognome = cognome;
    if (telefono !== undefined)     payload.telefono = telefono;
    if (istruttore_id !== undefined) payload.istruttore_id = istruttore_id;
    if (attivo !== undefined)       payload.attivo = !!attivo;
    if (password)                   payload.password_hash = await bcrypt.hash(String(password), 10);

    const { data, error } = await supabase.from(TABLE)
      .update(payload)
      .eq("id", id)
      .eq("autoscuola_id", req.autoscuolaId)
      .select("id,email,ruolo,nome,cognome,telefono,attivo")
      .single();

    if (error || !data) return res.status(404).json({ error: "Operatore non trovato" });
    res.json({ success: true, operatore: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── DELETE /api/operatori/:id ──────────────────────────────────────────────
async function remove(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from(TABLE)
      .delete()
      .eq("id", id)
      .eq("autoscuola_id", req.autoscuolaId)
      .select("id")
      .single();
    if (error || !data) return res.status(404).json({ error: "Operatore non trovato" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/operatori/login
 * Login operatore — cerca in `operatori`, produce JWT con ruolo.
 */
async function loginOperatore(req, res) {
  try {
    const { email, password, autoscuola_id } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email e password obbligatori" });

    let q = supabase.from(TABLE)
      .select("id,autoscuola_id,email,password_hash,ruolo,nome,cognome,attivo")
      .eq("email", email.toLowerCase())
      .eq("attivo", true)
      .maybeSingle();

    // Se si specifica autoscuola_id, filtra anche per sede
    if (autoscuola_id) q = supabase.from(TABLE)
      .select("id,autoscuola_id,email,password_hash,ruolo,nome,cognome,attivo")
      .eq("email", email.toLowerCase())
      .eq("autoscuola_id", autoscuola_id)
      .eq("attivo", true)
      .maybeSingle();

    const { data: op, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!op) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = await bcrypt.compare(String(password), String(op.password_hash || ""));
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    // Aggiorna ultimo_accesso
    await supabase.from(TABLE).update({ ultimo_accesso: new Date().toISOString() }).eq("id", op.id).catch(() => {});

    // Crea JWT con ruolo — usa il sistema JWT esistente
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
    const token = jwt.sign({
      sub:          op.autoscuola_id,
      autoscuolaId: op.autoscuola_id,
      operatoreId:  op.id,
      ruolo:        op.ruolo,
      email:        op.email,
      nome:         `${op.nome || ""} ${op.cognome || ""}`.trim(),
    }, JWT_SECRET, { expiresIn: "8h" });

    res.json({
      success: true,
      token,
      operatore: { id: op.id, email: op.email, ruolo: op.ruolo, nome: op.nome, cognome: op.cognome },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { list, getById, create, update, remove, loginOperatore };
