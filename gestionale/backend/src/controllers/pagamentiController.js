/**
 * Controller REST per pagamenti (GeCA cassa, pagoPA, satispay).
 */

const { pagamentiService } = require("../services");
const supabase = require("../database/supabase");
const { withTenantFilter } = require("../server/auth");

async function list(req, res) {
  try {
    const filters = {
      candidato_id: req.query.candidato_id,
      tipo: req.query.tipo,
    };
    const { data, error, total } = await pagamentiService.list(req, filters);
    if (error) return res.status(500).json({ error: error.message });
    // Backward compat: se nessun param di paginazione, restituisce array
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const limit  = req.query.limit  ? parseInt(req.query.limit,  10) : null;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
      res.json({ data, total: total ?? data.length, limit, offset });
    } else {
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio pagamenti" });
  }
}

async function getById(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await pagamentiService.getById(id, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Pagamento non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura pagamento" });
  }
}

async function registra(req, res) {
  try {
    const payload = req.body || {};
    const { data, error, created } = await pagamentiService.registra(payload, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!created) return res.status(400).json({ error: "Registrazione pagamento non riuscita (tabella pagamenti?)" });
    res.status(201).json({ success: true, pagamento: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore registrazione pagamento" });
  }
}

async function avviaPagoPA(req, res) {
  try {
    const result = await pagamentiService.avviaPagoPA(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore pagoPA" });
  }
}

async function avviaSatispay(req, res) {
  try {
    const result = await pagamentiService.avviaSatispay(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore Satispay" });
  }
}

/**
 * GET /api/pagamenti/rendiconto?data=YYYY-MM-DD
 * Rendiconto cassa giornaliero — Punto 22.
 * Aggrega i pagamenti della giornata per metodo/tipo.
 */
async function rendiconto(req, res) {
  try {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    const dataInizio = `${data}T00:00:00`;
    const dataFine   = `${data}T23:59:59`;

    let q = supabase
      .from("pagamenti")
      .select("id,candidato_id,importo,tipo,causale,metodo,created_at,candidates(cognome,nome)")
      .gte("created_at", dataInizio)
      .lte("created_at", dataFine)
      .order("created_at", { ascending: true });
    q = withTenantFilter(q, req);

    const { data: righe, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const pagamenti = righe || [];

    // Totale generale
    const totale = pagamenti.reduce((s, p) => s + parseFloat(p.importo || 0), 0);

    // Riepilogo per metodo di pagamento
    const perMetodo = {};
    for (const p of pagamenti) {
      const k = p.metodo || "non specificato";
      if (!perMetodo[k]) perMetodo[k] = { metodo: k, count: 0, totale: 0 };
      perMetodo[k].count++;
      perMetodo[k].totale += parseFloat(p.importo || 0);
    }

    // Riepilogo per causale/tipo servizio
    const perCausale = {};
    for (const p of pagamenti) {
      const k = p.causale || p.tipo || "altro";
      if (!perCausale[k]) perCausale[k] = { causale: k, count: 0, totale: 0 };
      perCausale[k].count++;
      perCausale[k].totale += parseFloat(p.importo || 0);
    }

    res.json({
      data,
      totale: Math.round(totale * 100) / 100,
      count: pagamenti.length,
      pagamenti,
      per_metodo: Object.values(perMetodo).sort((a, b) => b.totale - a.totale),
      per_causale: Object.values(perCausale).sort((a, b) => b.totale - a.totale),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore rendiconto" });
  }
}

module.exports = {
  list,
  getById,
  registra,
  avviaPagoPA,
  avviaSatispay,
  rendiconto,
};
