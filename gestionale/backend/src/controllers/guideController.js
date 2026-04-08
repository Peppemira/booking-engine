/**
 * Controller REST per sedute guide.
 * Equivalente GeCA: newguide, guiobb, newcontguiall, conguist, valutazioni.
 */

const supabase = require("../database/supabase");

// ---------------------------------------------------------------------------
// GET /api/guide
// Query params: candidate_id, istruttore, data_da, data_a, tipo_guida, esito, limit, offset
// ---------------------------------------------------------------------------
async function list(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id, istruttore, data_da, data_a, tipo_guida, esito } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);
    const offset = parseInt(req.query.offset || "0", 10);

    let q = supabase
      .from("guide_sessions")
      .select(`
        id, candidate_id, data_guida, ora_inizio, ora_fine,
        istruttore, tipo_guida, percorso, km, valutazione,
        note, esito, created_at,
        candidates(id, cognome, nome, categoria_patente, codice_fiscale, patente_numero)
      `, { count: "exact" })
      .order("data_guida", { ascending: false })
      .range(offset, offset + limit - 1);

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (candidate_id) q = q.eq("candidate_id", candidate_id);
    if (istruttore) q = q.ilike("istruttore", `%${istruttore}%`);
    if (data_da) q = q.gte("data_guida", data_da);
    if (data_a) q = q.lte("data_guida", data_a);
    if (tipo_guida) q = q.eq("tipo_guida", tipo_guida);
    if (esito) q = q.eq("esito", esito);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio guide" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/guide/conteggio
// Conteggio guide per candidato (newcontguiall) o istruttore (conguist)
// ---------------------------------------------------------------------------
async function conteggio(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id, istruttore, data_da, data_a } = req.query;

    let q = supabase
      .from("guide_sessions")
      .select("id, candidate_id, istruttore, tipo_guida, esito, km, valutazione, candidates(id, cognome, nome, categoria_patente)", { count: "exact" })
      .eq("esito", "completata");

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (candidate_id) q = q.eq("candidate_id", candidate_id);
    if (istruttore) q = q.ilike("istruttore", `%${istruttore}%`);
    if (data_da) q = q.gte("data_guida", data_da);
    if (data_a) q = q.lte("data_guida", data_a);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];

    if (candidate_id) {
      // Conteggio per candidato singolo
      const normale = rows.filter((r) => r.tipo_guida === "normale" || !r.tipo_guida).length;
      const obbligatoria = rows.filter((r) => r.tipo_guida === "obbligatoria" || r.tipo_guida === "certificata").length;
      const a2a = rows.filter((r) => r.tipo_guida === "A2A" || r.tipo_guida === "A2/A").length;
      const totKm = rows.reduce((s, r) => s + parseFloat(r.km || 0), 0);
      const valutazioni = rows.filter((r) => r.valutazione);
      const mediaValutazione = valutazioni.length
        ? Math.round((valutazioni.reduce((s, r) => s + (r.valutazione || 0), 0) / valutazioni.length) * 10) / 10
        : null;
      return res.json({ totale: rows.length, normale, obbligatoria, a2a, totKm, mediaValutazione });
    }

    if (istruttore) {
      // Conteggio per istruttore
      const perCandidato = {};
      rows.forEach((r) => {
        const k = r.candidate_id;
        if (!perCandidato[k]) {
          perCandidato[k] = {
            candidate_id: k,
            candidato: r.candidates ? `${r.candidates.cognome} ${r.candidates.nome}` : k,
            categoria: r.candidates?.categoria_patente || "–",
            count: 0,
            km: 0,
          };
        }
        perCandidato[k].count++;
        perCandidato[k].km += parseFloat(r.km || 0);
      });
      return res.json({ totale: rows.length, perCandidato: Object.values(perCandidato) });
    }

    // Conteggio globale per candidato
    const perCandidato = {};
    rows.forEach((r) => {
      const k = r.candidate_id;
      if (!perCandidato[k]) {
        perCandidato[k] = {
          candidate_id: k,
          candidato: r.candidates ? `${r.candidates.cognome} ${r.candidates.nome}` : k,
          categoria: r.candidates?.categoria_patente || "–",
          count: 0,
          obbligatorie: 0,
          km: 0,
        };
      }
      perCandidato[k].count++;
      if (r.tipo_guida === "obbligatoria" || r.tipo_guida === "certificata") perCandidato[k].obbligatorie++;
      perCandidato[k].km += parseFloat(r.km || 0);
    });
    res.json({ totale: rows.length, perCandidato: Object.values(perCandidato).sort((a, b) => b.count - a.count) });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore conteggio guide" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/guide/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase.from("guide_sessions").select("*, candidates(id, cognome, nome, categoria_patente, codice_fiscale)").eq("id", id).maybeSingle();
    if (autoscuolaId) q = supabase.from("guide_sessions").select("*, candidates(id, cognome, nome, categoria_patente, codice_fiscale)").eq("id", id).eq("autoscuola_id", autoscuolaId).maybeSingle();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Seduta guida non trovata" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura seduta guida" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/guide
// Body: { candidate_id, data_guida, ora_inizio, ora_fine, istruttore,
//         tipo_guida, percorso, km, valutazione, note, esito }
// ---------------------------------------------------------------------------
async function create(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    if (!body.candidate_id || !body.data_guida) {
      return res.status(400).json({ error: "candidate_id e data_guida sono obbligatori" });
    }
    const payload = {
      candidate_id: body.candidate_id,
      data_guida: body.data_guida,
      ora_inizio: body.ora_inizio || null,
      ora_fine: body.ora_fine || null,
      istruttore: body.istruttore || null,
      tipo_guida: body.tipo_guida || "normale",
      percorso: body.percorso || null,
      km: body.km != null ? parseFloat(body.km) : null,
      valutazione: body.valutazione ? parseInt(body.valutazione, 10) : null,
      note: body.note || null,
      esito: body.esito || "completata",
      // Guida accompagnata (Punto 23)
      accompagnatore_cognome:       body.accompagnatore_cognome      || null,
      accompagnatore_nome:          body.accompagnatore_nome         || null,
      accompagnatore_data_nascita:  body.accompagnatore_data_nascita || null,
      accompagnatore_patente_n:     body.accompagnatore_patente_n    || null,
      accompagnatore_patente_data:  body.accompagnatore_patente_data || null,
      foglio_rosa_numero:           body.foglio_rosa_numero          || null,
      ...(autoscuolaId && { autoscuola_id: autoscuolaId }),
    };
    const { data, error } = await supabase.from("guide_sessions").insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, guida: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione seduta guida" });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/guide/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    const allowed = ["data_guida", "ora_inizio", "ora_fine", "istruttore", "tipo_guida", "percorso", "km", "valutazione", "note", "esito",
      "accompagnatore_cognome", "accompagnatore_nome", "accompagnatore_data_nascita",
      "accompagnatore_patente_n", "accompagnatore_patente_data", "foglio_rosa_numero"];
    const payload = {};
    allowed.forEach((k) => { if (body[k] !== undefined) payload[k] = body[k]; });
    payload.updated_at = new Date().toISOString();

    let q = supabase.from("guide_sessions").update(payload).eq("id", id).select().single();
    if (autoscuolaId) q = supabase.from("guide_sessions").update(payload).eq("id", id).eq("autoscuola_id", autoscuolaId).select().single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Seduta guida non trovata" });
    res.json({ success: true, guida: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento seduta guida" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/guide/:id
// ---------------------------------------------------------------------------
async function remove(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase.from("guide_sessions").delete().eq("id", id).select("id").single();
    if (autoscuolaId) q = supabase.from("guide_sessions").delete().eq("id", id).eq("autoscuola_id", autoscuolaId).select("id").single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Seduta guida non trovata" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione seduta guida" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/guide/esercitazioni  — lista esercitazioni portale per candidato
// Query params: candidate_id (required)
// ---------------------------------------------------------------------------
async function listEsercitazioni(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id } = req.query;
    if (!candidate_id) return res.status(400).json({ error: "candidate_id obbligatorio" });

    let q = supabase
      .from("esercitazioni_guida")
      .select("*")
      .eq("candidate_id", candidate_id)
      .order("data_esercitazione", { ascending: false });

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio esercitazioni" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/guide/esercitazioni
// Body: { candidate_id, pratica_id?, data_esercitazione, ora_inizio?,
//         durata_minuti, tipo_guida, targa_veicolo?, istruttore_nome?,
//         istruttore_cognome?, n_iscrizione?, note? }
// ---------------------------------------------------------------------------
async function createEsercitazione(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const body = req.body || {};
    if (!body.candidate_id || !body.data_esercitazione) {
      return res.status(400).json({ error: "candidate_id e data_esercitazione sono obbligatori" });
    }
    const payload = {
      candidate_id:      body.candidate_id,
      pratica_id:        body.pratica_id        || null,
      data_esercitazione: body.data_esercitazione,
      ora_inizio:        body.ora_inizio         || null,
      durata_minuti:     body.durata_minuti ? parseInt(body.durata_minuti, 10) : null,
      tipo_guida:        body.tipo_guida         || "A",
      targa_veicolo:     body.targa_veicolo      || null,
      istruttore_nome:   body.istruttore_nome    || null,
      istruttore_cognome: body.istruttore_cognome || null,
      n_iscrizione:      body.n_iscrizione       || null,
      note:              body.note               || null,
      trasmessa_portale: false,
      ...(autoscuolaId && { autoscuola_id: autoscuolaId }),
    };
    const { data, error } = await supabase
      .from("esercitazioni_guida")
      .insert(payload)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ success: true, esercitazione: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione esercitazione" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/guide/esercitazioni/:id
// ---------------------------------------------------------------------------
async function deleteEsercitazione(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase
      .from("esercitazioni_guida")
      .delete()
      .eq("id", id)
      .select("id")
      .single();
    if (autoscuolaId)
      q = supabase
        .from("esercitazioni_guida")
        .delete()
        .eq("id", id)
        .eq("autoscuola_id", autoscuolaId)
        .select("id")
        .single();
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Esercitazione non trovata" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione esercitazione" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/guide/accompagnate — Punto 23
// Lista guide con tipo_guida = 'AA' (guida accompagnata)
// ---------------------------------------------------------------------------
async function listAccompagnate(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    const { candidate_id, data_da, data_a } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  || "100", 10), 500);
    const offset = Math.max(parseInt(req.query.offset || "0",   10), 0);

    let q = supabase
      .from("guide_sessions")
      .select(`
        id, candidate_id, data_guida, ora_inizio, ora_fine, istruttore,
        tipo_guida, percorso, km, note, esito,
        accompagnatore_cognome, accompagnatore_nome, accompagnatore_data_nascita,
        accompagnatore_patente_n, accompagnatore_patente_data, foglio_rosa_numero,
        created_at,
        candidates(id, cognome, nome, data_nascita, codice_fiscale, categoria_patente)
      `, { count: "exact" })
      .eq("tipo_guida", "AA")
      .order("data_guida", { ascending: false })
      .range(offset, offset + limit - 1);

    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    if (candidate_id) q = q.eq("candidate_id", candidate_id);
    if (data_da) q = q.gte("data_guida", data_da);
    if (data_a)  q = q.lte("data_guida", data_a);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/guide/:id/foglio-rosa
 * Dati per stampa foglio rosa AA: include validazione vincoli età.
 */
async function foglioRosa(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;

    let q = supabase
      .from("guide_sessions")
      .select(`
        *, candidates(id, cognome, nome, data_nascita, codice_fiscale, categoria_patente, email_contatto)
      `)
      .eq("id", id)
      .single();
    if (autoscuolaId) q = supabase.from("guide_sessions").select("*, candidates(id,cognome,nome,data_nascita,codice_fiscale,categoria_patente,email_contatto)").eq("id", id).eq("autoscuola_id", autoscuolaId).single();

    const { data: guida, error } = await q;
    if (error || !guida) return res.status(404).json({ error: "Seduta non trovata" });

    // Validazioni età
    const warnings = [];
    const oggi = new Date();

    if (guida.candidates?.data_nascita) {
      const etaCandidato = Math.floor((oggi - new Date(guida.candidates.data_nascita)) / (1000 * 60 * 60 * 24 * 365.25));
      if (etaCandidato < 17) {
        warnings.push(`Il candidato ha ${etaCandidato} anni: la guida accompagnata richiede almeno 17 anni.`);
      }
    }

    if (guida.accompagnatore_data_nascita) {
      const etaAcc = Math.floor((oggi - new Date(guida.accompagnatore_data_nascita)) / (1000 * 60 * 60 * 24 * 365.25));
      if (etaAcc < 25) {
        warnings.push(`L'accompagnatore ha ${etaAcc} anni: la guida accompagnata richiede almeno 25 anni.`);
      }
    }

    if (!guida.accompagnatore_patente_data) {
      warnings.push("Data rilascio patente accompagnatore non specificata (richiesta per verifica requisito 10 anni).");
    } else {
      const anniPatente = (oggi - new Date(guida.accompagnatore_patente_data)) / (1000 * 60 * 60 * 24 * 365.25);
      if (anniPatente < 10) {
        warnings.push(`L'accompagnatore possiede la patente da ${Math.floor(anniPatente)} anni: sono richiesti almeno 10 anni.`);
      }
    }

    res.json({ guida, warnings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  list, conteggio, getById, create, update, remove,
  listEsercitazioni, createEsercitazione, deleteEsercitazione,
  listAccompagnate, foglioRosa,
};
