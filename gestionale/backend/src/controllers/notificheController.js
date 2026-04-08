/**
 * NotificheController — Punto 21
 * Endpoint per invio notifiche candidati e storico.
 */

const { notificheService } = require("../services/notificheService");

/**
 * GET /api/notifiche/templates
 * Lista template disponibili.
 */
async function listTemplates(req, res) {
  try {
    const templates = notificheService.getTemplates();
    res.json(templates);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/notifiche/invia
 * Invia notifica a un candidato.
 * Body: { candidato_id, email_destinatario, template_key, vars, note }
 */
async function invia(req, res) {
  try {
    const { candidato_id, email_destinatario, template_key, vars, note } = req.body || {};
    if (!candidato_id)       return res.status(400).json({ error: "candidato_id mancante" });
    if (!email_destinatario) return res.status(400).json({ error: "email_destinatario mancante" });
    if (!template_key)       return res.status(400).json({ error: "template_key mancante" });

    const result = await notificheService.invia({
      candidato_id,
      email_destinatario,
      template_key,
      vars: vars || {},
      autoscuola_id: req.autoscuolaId || null,
      note,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore invio notifica" });
  }
}

/**
 * POST /api/notifiche/invia-bulk
 * Invia notifica a più candidati.
 * Body: { candidati: [{id, nome, cognome, email_contatto, ...}], template_key, vars_base }
 */
async function inviaBulk(req, res) {
  try {
    const { candidati, template_key, vars_base } = req.body || {};
    if (!Array.isArray(candidati) || candidati.length === 0) {
      return res.status(400).json({ error: "candidati[] mancante o vuoto" });
    }
    if (!template_key) return res.status(400).json({ error: "template_key mancante" });

    const results = await notificheService.inviaBulk({
      candidati,
      template_key,
      vars_base: vars_base || {},
      autoscuola_id: req.autoscuolaId || null,
    });

    const inviati = results.filter(r => r.success).length;
    const errori  = results.filter(r => !r.success).length;
    res.json({ success: true, inviati, errori, dettaglio: results });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore invio bulk" });
  }
}

/**
 * GET /api/notifiche/storico?candidato_id=...
 * Storico notifiche di un candidato.
 */
async function storicoPerCandidato(req, res) {
  try {
    const { candidato_id } = req.query;
    if (!candidato_id) return res.status(400).json({ error: "candidato_id mancante" });
    const { data, error } = await notificheService.storicoPerCandidato(
      candidato_id,
      req.autoscuolaId || null
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/notifiche/storico-globale?limit=50&offset=0
 * Storico globale paginato.
 */
async function storicoGlobale(req, res) {
  try {
    const { data, error, total } = await notificheService.storicoGlobale(req);
    if (error) return res.status(500).json({ error: error.message });
    const limit  = req.query.limit  ? parseInt(req.query.limit,  10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    res.json({ data, total, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  listTemplates,
  invia,
  inviaBulk,
  storicoPerCandidato,
  storicoGlobale,
};
