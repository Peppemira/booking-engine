/**
 * Resoconti (GeCA: conteggi, resocesami, resocon).
 * Conteggio iscrizioni, resoconto esami, resoconto incassi, dati per grafici.
 */

const supabase = require("../database/supabase");
const { withTenantFilter } = require("../server/auth");

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resoconto iscrizioni (conteggi) – candidati creati nel periodo.
 */
async function conteggi(req, res) {
  try {
    const dataini = parseDate(req.query.dataini);
    const datafin = parseDate(req.query.datafin);
    const codiceAutoscuola = String(req.query.codice_autoscuola || "").trim();
    if (!dataini || !datafin) {
      return res.status(400).json({ error: "dataini e datafin obbligatori (YYYY-MM-DD)" });
    }
    const start = toYMD(dataini);
    const end = toYMD(datafin);

    let query = withTenantFilter(
      supabase
        .from("candidates")
        .select("id,cognome,nome,codice_fiscale,patente_numero,codice_autoscuola,categoria_patente,created_at")
        .gte("created_at", `${start}T00:00:00.000Z`)
        .lte("created_at", `${end}T23:59:59.999Z`)
        .order("created_at", { ascending: true }),
      req,
      "autoscuola_id"
    );
    if (codiceAutoscuola) {
      query = query.eq("codice_autoscuola", codiceAutoscuola);
    }
    const { data: rows, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const list = (rows || []).map((r) => ({
      cod_ana: r.id,
      cogn: r.cognome,
      nom: r.nome,
      codice_fiscale: r.codice_fiscale,
      patrich: r.patente_numero,
      codautos: r.codice_autoscuola,
      tipoiscrn: r.categoria_patente || "",
      created_at: r.created_at,
    }));

    res.json({
      success: true,
      dataini: start,
      datafin: end,
      totale: list.length,
      list,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore resoconto iscrizioni" });
  }
}

/**
 * Resoconto esami – prenotazioni nel periodo con esito (idonei/respinti/assenti).
 */
async function resocontoEsami(req, res) {
  try {
    const dataini = parseDate(req.query.dataini);
    const datafin = parseDate(req.query.datafin);
    const codiceAutoscuola = String(req.query.codice_autoscuola || "").trim();
    if (!dataini || !datafin) {
      return res.status(400).json({ error: "dataini e datafin obbligatori (YYYY-MM-DD)" });
    }
    const start = toYMD(dataini);
    const end = toYMD(datafin);

    let query = withTenantFilter(
      supabase
        .from("prenotazioni")
        .select("id,categoria,esito,data_prenotazione,data,created_at,nome,cognome")
        .gte("created_at", `${start}T00:00:00.000Z`)
        .lte("created_at", `${end}T23:59:59.999Z`),
      req,
      "autoscuola_id"
    );
    const { data: rows, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const list = rows || [];
    const byTipo = {};
    list.forEach((r) => {
      const tipo = r.categoria || r.data || "Generico";
      if (!byTipo[tipo]) {
        byTipo[tipo] = { tipo, idonei: 0, respinti: 0, assenti: 0, totale: 0 };
      }
      byTipo[tipo].totale += 1;
      const es = String(r.esito || "").toUpperCase();
      if (es === "I" || es === "IDONEO" || es === "PROMOSSO") byTipo[tipo].idonei += 1;
      else if (es === "R" || es === "RESPINTO" || es === "BOCCIATO") byTipo[tipo].respinti += 1;
      else byTipo[tipo].assenti += 1;
    });

    const riepilogo = Object.values(byTipo);
    const totali = {
      idonei: riepilogo.reduce((s, x) => s + x.idonei, 0),
      respinti: riepilogo.reduce((s, x) => s + x.respinti, 0),
      assenti: riepilogo.reduce((s, x) => s + x.assenti, 0),
      totale: list.length,
    };

    res.json({
      success: true,
      dataini: start,
      datafin: end,
      totali,
      riepilogo,
      list,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore resoconto esami" });
  }
}

/**
 * Resoconto incassi (resocon) – pagamenti nel periodo.
 */
async function resocontoIncassi(req, res) {
  try {
    const dataini = parseDate(req.query.dataini);
    const datafin = parseDate(req.query.datafin);
    if (!dataini || !datafin) {
      return res.status(400).json({ error: "dataini e datafin obbligatori (YYYY-MM-DD)" });
    }
    const start = toYMD(dataini);
    const end = toYMD(datafin);

    let query = withTenantFilter(
      supabase
        .from("pagamenti")
        .select("id,tipo,importo,causale,data_pagamento,created_at,candidato_id")
        .gte("created_at", `${start}T00:00:00.000Z`)
        .lte("created_at", `${end}T23:59:59.999Z`)
        .order("created_at", { ascending: true }),
      req,
      "autoscuola_id"
    );
    const { data: rows, error } = await query;
    if (error) {
      if (/relation.*pagamenti|pagamenti.*does not exist/i.test(String(error.message))) {
        return res.json({
          success: true,
          dataini: start,
          datafin: end,
          totale: 0,
          somma: 0,
          list: [],
          note: "Tabella pagamenti non presente; creare tabella pagamenti per gli incassi.",
        });
      }
      return res.status(500).json({ error: error.message });
    }

    const list = (rows || []).map((r) => ({
      ...r,
      data_rif: r.data_pagamento ? toYMD(new Date(r.data_pagamento)) : toYMD(new Date(r.created_at)),
    })).filter((r) => r.data_rif >= start && r.data_rif <= end);
    const somma = list.reduce((s, r) => s + Number(r.importo || 0), 0);

    res.json({
      success: true,
      dataini: start,
      datafin: end,
      totale: list.length,
      somma: Math.round(somma * 100) / 100,
      list,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore resoconto incassi" });
  }
}

/**
 * Dati per grafici: iscrizioni, esami, incassi per mese (ultimi 12 mesi se non specificato).
 */
async function grafici(req, res) {
  try {
    const dataini = parseDate(req.query.dataini);
    const datafin = parseDate(req.query.datafin);
    const now = new Date();
    const end = datafin || now;
    const start = dataini || new Date(end.getFullYear(), end.getMonth() - 11, 1);
    const startStr = toYMD(start);
    const endStr = toYMD(end);

    const autoscuolaId = req.autoscuolaId;
    const tenantFilter = (q, col = "autoscuola_id") =>
      autoscuolaId ? q.eq(col, autoscuolaId) : q;

    const mesi = [];
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d.setMonth(d.getMonth() + 1)) {
      mesi.push(toYMD(new Date(d.getFullYear(), d.getMonth(), 1)));
    }

    const iscrizioniPerMese = {};
    mesi.forEach((m) => (iscrizioniPerMese[m] = 0));
    let qIsc = supabase
      .from("candidates")
      .select("created_at")
      .gte("created_at", `${startStr}T00:00:00.000Z`)
      .lte("created_at", `${endStr}T23:59:59.999Z`);
    qIsc = tenantFilter(qIsc);
    const { data: iscRows } = await qIsc;
    (iscRows || []).forEach((r) => {
      const key = toYMD(new Date(r.created_at)).slice(0, 7) + "-01";
      if (iscrizioniPerMese[key] !== undefined) iscrizioniPerMese[key]++;
    });

    const esamiPerMese = {};
    mesi.forEach((m) => (esamiPerMese[m] = { idonei: 0, respinti: 0, assenti: 0, totale: 0 }));
    let qEs = supabase
      .from("prenotazioni")
      .select("created_at,esito")
      .gte("created_at", `${startStr}T00:00:00.000Z`)
      .lte("created_at", `${endStr}T23:59:59.999Z`);
    qEs = tenantFilter(qEs);
    const { data: esRows } = await qEs;
    (esRows || []).forEach((r) => {
      const key = toYMD(new Date(r.created_at)).slice(0, 7) + "-01";
      if (esamiPerMese[key]) {
        esamiPerMese[key].totale += 1;
        const es = String(r.esito || "").toUpperCase();
        if (es === "I" || es === "IDONEO" || es === "PROMOSSO") esamiPerMese[key].idonei += 1;
        else if (es === "R" || es === "RESPINTO" || es === "BOCCIATO") esamiPerMese[key].respinti += 1;
        else esamiPerMese[key].assenti += 1;
      }
    });

    let incassiPerMese = {};
    try {
      mesi.forEach((m) => (incassiPerMese[m] = 0));
      let qPag = supabase
        .from("pagamenti")
        .select("importo,data_pagamento,created_at")
        .gte("created_at", `${startStr}T00:00:00.000Z`)
        .lte("created_at", `${endStr}T23:59:59.999Z`);
      qPag = tenantFilter(qPag);
      const { data: pagRows } = await qPag;
      (pagRows || []).forEach((r) => {
        const dataPag = r.data_pagamento ? new Date(r.data_pagamento) : new Date(r.created_at);
        const key = toYMD(dataPag).slice(0, 7) + "-01";
        if (incassiPerMese[key] !== undefined) incassiPerMese[key] += Number(r.importo || 0);
      });
    } catch {
      incassiPerMese = {};
      mesi.forEach((m) => (incassiPerMese[m] = 0));
    }

    res.json({
      success: true,
      dataini: startStr,
      datafin: endStr,
      iscrizioni: mesi.map((m) => ({ mese: m, count: iscrizioniPerMese[m] || 0 })),
      esami: mesi.map((m) => ({ mese: m, ...(esamiPerMese[m] || { idonei: 0, respinti: 0, assenti: 0, totale: 0 }) })),
      incassi: mesi.map((m) => ({ mese: m, importo: incassiPerMese[m] || 0 })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore dati grafici" });
  }
}

module.exports = {
  conteggi,
  resocontoEsami,
  resocontoIncassi,
  grafici,
};
