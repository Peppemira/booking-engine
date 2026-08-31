"use strict";
/**
 * Handler endpoint POST /api/remote-capture/sessions/:token/deliver.
 * Estratto in modulo separato per testabilità isolata.
 *
 * Body: { channel: "email"|"whatsapp", recipient: string, candidateName?: string }
 * Auth: middleware esterno deve aver popolato req.autoscuolaId (via requireAuth).
 */

const supabase = require("../database/supabase");
const { notificheService } = require("../services/notificheService");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{10,15}$/;
const ALLOWED_CHANNELS = new Set(["email", "whatsapp"]);

async function deliverHandler(req, res) {
  try {
    const token = String(req.params?.token || "").trim();
    const channel = String(req.body?.channel || "").trim().toLowerCase();
    const recipient = String(req.body?.recipient || "").trim();
    const candidateName = String(req.body?.candidateName || "candidato").trim();
    const autoscuolaId = req.autoscuolaId || null;

    // Validazioni input
    if (!token) return res.status(400).json({ ok: false, error: "Token mancante" });
    if (!ALLOWED_CHANNELS.has(channel)) {
      return res.status(400).json({ ok: false, error: `Channel non ammesso: ${channel}` });
    }
    if (!recipient) return res.status(400).json({ ok: false, error: "Recipient mancante" });
    if (channel === "email" && !EMAIL_REGEX.test(recipient)) {
      return res.status(400).json({ ok: false, error: "Email non valida" });
    }
    if (channel === "whatsapp" && !PHONE_REGEX.test(recipient)) {
      return res.status(400).json({ ok: false, error: "Telefono non valido (atteso 10-15 cifre)" });
    }

    // Lookup sessione (tenant filter + scadenza)
    const { data: session, error: errSess } = await supabase
      .from("remote_capture_sessions")
      .select("token, expires_at, autoscuola_id")
      .eq("token", token)
      .maybeSingle();
    if (errSess) return res.status(500).json({ ok: false, error: errSess.message });
    if (!session) return res.status(404).json({ ok: false, error: "Token non trovato" });
    if (autoscuolaId && session.autoscuola_id && String(session.autoscuola_id) !== String(autoscuolaId)) {
      return res.status(403).json({ ok: false, error: "Token appartiene ad altra autoscuola" });
    }
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ ok: false, error: "Token scaduto" });
    }

    // Costruisci link e scadenza human-readable
    const link = buildLinkFromReq(req, token);
    const scadenza = formatItalianDate(session.expires_at);
    const autoscuolaNome = req.autoscuolaNome || req.autoscuola_nome || "La tua autoscuola";

    // Esegui invio (solo email; whatsapp è solo logging)
    let status = "sent";
    let errorMessage = null;
    if (channel === "email") {
      try {
        await notificheService.invia({
          email_destinatario: recipient,
          template_key: "remote_capture_link",
          vars: { nome: candidateName, autoscuola: autoscuolaNome, link, scadenza },
          autoscuola_id: autoscuolaId,
        });
      } catch (e) {
        status = "failed";
        errorMessage = (e && e.message) ? e.message.slice(0, 500) : "Brevo error";
      }
    }

    // Insert delivery
    const { data: inserted, error: errIns } = await supabase
      .from("remote_capture_deliveries")
      .insert([{
        token,
        channel,
        recipient,
        status,
        error_message: errorMessage,
        user_id: req.userId || null,
        autoscuola_id: autoscuolaId,
      }])
      .select("id, token, channel, recipient, sent_at, status, error_message")
      .maybeSingle();
    if (errIns) return res.status(500).json({ ok: false, error: errIns.message });

    return res.json({ ok: true, delivery: inserted });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Errore interno" });
  }
}

function buildLinkFromReq(req, token) {
  // In produzione potrebbe esserci una FRONTEND_URL diversa; usa quella se presente
  const base = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}/acquisizione-remota?token=${encodeURIComponent(token)}`;
}

function formatItalianDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

module.exports = deliverHandler;
module.exports.buildLinkFromReq = buildLinkFromReq;
module.exports.formatItalianDate = formatItalianDate;
