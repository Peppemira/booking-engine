/**
 * Controller REST per pratiche patente (GeCA Trasmiss, visced, frmpatenti).
 */

const { pratichePatenteService } = require("../services");

async function list(req, res) {
  try {
    const filters = {
      candidato_id: req.query.candidato_id,
      tipo_pratica: req.query.tipo_pratica,
      stato: req.query.stato,
    };
    const { data, error } = await pratichePatenteService.list(req, filters);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio pratiche" });
  }
}

async function getById(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await pratichePatenteService.getById(id, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Pratica non trovata" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura pratica" });
  }
}

async function create(req, res) {
  try {
    const payload = req.body || {};
    const { data, error, created } = await pratichePatenteService.create(payload, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!created) return res.status(400).json({ error: "Creazione pratica non riuscita (tabella pratiche_patente?)" });
    res.status(201).json({ success: true, pratica: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione pratica" });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const { data, error } = await pratichePatenteService.update(id, payload, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Pratica non trovata" });
    res.json({ success: true, pratica: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento pratica" });
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
};
