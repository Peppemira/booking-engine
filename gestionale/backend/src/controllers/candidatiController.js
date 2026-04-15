/**
 * Controller REST per anagrafica candidati (equivalente GeCA anagrafe, ModIscritti).
 */

const { anagraficaCandidatiService } = require("../services");
const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");

async function list(req, res) {
  try {
    const { data, error, total } = await anagraficaCandidatiService.list(req);
    if (error) return res.status(500).json({ error: error.message });
    // Se è richiesta paginazione, rispondi con oggetto {data, total, limit, offset}
    // altrimenti mantieni compatibilità backward (array)
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const limit  = req.query.limit  ? parseInt(req.query.limit,  10) : null;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
      res.json({ data, total: total ?? data.length, limit, offset });
    } else {
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore listaggio candidati" });
  }
}

async function getById(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await anagraficaCandidatiService.getById(id, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Candidato non trovato" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura candidato" });
  }
}

async function create(req, res) {
  try {
    const payload = {
      ...(req.body || {}),
      ...(req.autoscuolaId && { autoscuola_id: req.autoscuolaId }),
    };
    if (!payload.nome || !payload.cognome) {
      return res.status(400).json({ error: "nome e cognome sono obbligatori" });
    }
    const { data, droppedColumns, error } = await anagraficaCandidatiService.create(
      payload,
      req
    );
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({
      success: true,
      candidate: data,
      droppedColumns: droppedColumns || [],
      schemaWarning:
        (droppedColumns || []).length
          ? "Alcuni campi non presenti nello schema DB"
          : undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore creazione candidato" });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "Nessun campo valido da aggiornare" });
    }
    const { data, error } = await anagraficaCandidatiService.update(id, payload, req);
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Candidato non trovato" });
    res.json({ success: true, candidate: data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore modifica candidato" });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;
    const { deleted, error } = await anagraficaCandidatiService.delete(id, req);
    if (error) {
      const msg = String(error.message || "");
      if (/foreign key|violates/i.test(msg)) {
        return res.status(409).json({
          error: "Impossibile eliminare: candidato collegato ad altre pratiche",
        });
      }
      return res.status(500).json({ error: error.message });
    }
    if (!deleted) return res.status(404).json({ error: "Candidato non trovato" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore eliminazione candidato" });
  }
}

async function omonimi(req, res) {
  try {
    const { cognome, nome, data_nascita, exact } = req.body || {};
    const { data, error } = await anagraficaCandidatiService.searchOmonimi(
      { cognome, nome, dataNascita: data_nascita, exact: !!exact },
      req
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, omonimi: data, count: data.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore ricerca omonimi" });
  }
}

/**
 * Sposta candidati in archivio storico o ripristina in archivio attuale.
 * PATCH /api/candidati-api/sposta-archivio
 * PATCH /api/candidates/sposta-archivio
 * Body: { ids: number[], storico: boolean }
 */
async function spostaArchivio(req, res) {
  try {
    const { ids, storico } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "ids obbligatorio (array di id)" });
    }
    const { data, error } = await supabase
      .from("candidates")
      .update({ storico: !!storico })
      .in("id", ids)
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, updated: data?.length || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore sposta archivio" });
  }
}

/**
 * GET /api/candidati-api/:id/storia
 * Aggregazione storia completa candidato:
 * anagrafica, pagamenti, prenotazioni, documenti, waitlist.
 * Equivalente GeCA: frmRiepilogo + esamican + accontinew + VisNote.
 */
async function storia(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;

    // Candidato base
    let candQuery = supabase
      .from("candidates")
      .select("*")
      .eq("id", id);
    if (autoscuolaId) candQuery = candQuery.eq("autoscuola_id", autoscuolaId);
    const { data: candidato, error: errCand } = await candQuery.maybeSingle();
    if (errCand) return res.status(500).json({ error: errCand.message });
    if (!candidato) return res.status(404).json({ error: "Candidato non trovato" });

    // Pagamenti del candidato
    let pagQuery = supabase
      .from("pagamenti")
      .select("id,tipo,importo,causale,data_pagamento,esito,note,created_at")
      .eq("candidato_id", String(id))
      .order("data_pagamento", { ascending: false })
      .limit(50);
    if (autoscuolaId) pagQuery = pagQuery.eq("autoscuola_id", autoscuolaId);
    const { data: pagamenti } = await pagQuery;

    // Prenotazioni / storico esami
    let prenQuery = supabase
      .from("prenotazioni")
      .select("id,data_esame,tipo_esame,sede_esame,esito,note,created_at")
      .eq("candidate_id", String(id))
      .order("data_esame", { ascending: false })
      .limit(50);
    if (autoscuolaId) prenQuery = prenQuery.eq("autoscuola_id", autoscuolaId);
    const { data: prenotazioni } = await prenQuery;

    // Documenti del candidato
    let docQuery = supabase
      .from("documenti")
      .select("id,tipo,nome_file,descrizione,created_at")
      .eq("candidato_id", String(id))
      .order("created_at", { ascending: false })
      .limit(20);
    if (autoscuolaId) docQuery = docQuery.eq("autoscuola_id", autoscuolaId);
    const { data: documenti } = await docQuery;

    // Waitlist del candidato
    let waitQuery = supabase
      .from("waitlist")
      .select("id,status,tipo_esame,categoria_patente,created_at,updated_at,note")
      .eq("candidate_id", String(id))
      .order("created_at", { ascending: false })
      .limit(20);
    if (autoscuolaId) waitQuery = waitQuery.eq("autoscuola_id", autoscuolaId);
    const { data: waitlist } = await waitQuery;

    // Totale incassato
    const totaleIncassato = (pagamenti || [])
      .filter((p) => p.esito === "completato" || !p.esito)
      .reduce((s, p) => s + parseFloat(p.importo || 0), 0);

    res.json({
      candidato,
      pagamenti: pagamenti || [],
      prenotazioni: prenotazioni || [],
      documenti: documenti || [],
      waitlist: waitlist || [],
      totaleIncassato: Math.round(totaleIncassato * 100) / 100,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore storia candidato" });
  }
}

/**
 * GET /api/candidati-api/scadenze
 * Candidati con patente/foglio rosa/documento in scadenza nei prossimi `giorni` giorni.
 * Equivalente GeCA: creascadenze, dettEvidenza.
 */
async function scadenze(req, res) {
  try {
    const giorni = Math.min(parseInt(req.query.giorni || "30", 10), 365);
    const autoscuolaId = req.autoscuolaId || null;
    const oggi = new Date();
    const limite = new Date(oggi);
    limite.setDate(limite.getDate() + giorni);
    const toYMD = (d) => d.toISOString().slice(0, 10);

    let q = supabase
      .from("candidates")
      .select("id,cognome,nome,codice_fiscale,categoria_patente,ppg_data_scadenza,scade_il_documento,scade_il_patente,telefono_1,email_contatto")
      .or(
        `ppg_data_scadenza.lte.${toYMD(limite)},ppg_data_scadenza.gte.${toYMD(oggi)},` +
        `scade_il_documento.lte.${toYMD(limite)},scade_il_documento.gte.${toYMD(oggi)},` +
        `scade_il_patente.lte.${toYMD(limite)},scade_il_patente.gte.${toYMD(oggi)}`
      )
      .order("ppg_data_scadenza", { ascending: true })
      .limit(200);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore scadenze" });
  }
}

/**
 * GET /api/candidati-api/foglio-rosa
 * Lista candidati con codice_foglio_rosa impostato (per ristampa one-click).
 */
async function listConFoglioRosa(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId || null;
    let q = supabase
      .from("candidates")
      .select("id, cognome, nome, codice_fiscale, codice_foglio_rosa, categoria_patente, stato_iscrizione")
      .not("codice_foglio_rosa", "is", null)
      .neq("codice_foglio_rosa", "")
      .order("cognome", { ascending: true });
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lista foglio rosa" });
  }
}

/**
 * GET /api/candidati-api/:id/storico-quiz
 * Storico tentativi quiz (teoria) e guida pratica del candidato.
 * Fonte: tabelle locali `esiti_esami` + `prenotazioni` (tipo teoria/guida).
 * Punto 15 — Storico quiz candidato.
 */
async function storicoQuiz(req, res) {
  try {
    const { id } = req.params;
    const autoscuolaId = req.autoscuolaId || null;

    // Candidato base (per CF e dati display)
    let candQ = supabase.from("candidates").select("id,cognome,nome,codice_fiscale,categoria_patente,tentativi_quiz").eq("id", id);
    if (autoscuolaId) candQ = candQ.eq("autoscuola_id", autoscuolaId);
    const { data: candidato } = await candQ.maybeSingle();

    // Esiti esami locali (storico sincronizzato dal portale)
    let esitiQ = supabase
      .from("esiti_esami")
      .select("id,tipo_esame,data_esame,esito,sede_esame,codice_sessione,commissione,note,id_verbale_portale,data_sync_portale,created_at")
      .eq("candidato_id", id)
      .order("data_esame", { ascending: false })
      .limit(100);
    if (autoscuolaId) esitiQ = esitiQ.eq("autoscuola_id", autoscuolaId);
    const { data: esiti } = await esitiQ;

    // Prenotazioni tipo teoria (quiz) e guida
    let prenQ = supabase
      .from("prenotazioni")
      .select("id,tipo_esame,data_esame,sede_esame,esito,note,created_at")
      .eq("candidate_id", id)
      .order("data_esame", { ascending: false })
      .limit(50);
    if (autoscuolaId) prenQ = prenQ.eq("autoscuola_id", autoscuolaId);
    const { data: prenotazioni } = await prenQ;

    // Suddividi per tipo
    const quiz  = (esiti || []).filter((e) => e.tipo_esame === "teoria" || e.tipo_esame === "quiz");
    const guida = (esiti || []).filter((e) => e.tipo_esame === "guida" || e.tipo_esame === "pratica");
    const altriEsiti = (esiti || []).filter((e) => !["teoria","quiz","guida","pratica"].includes(e.tipo_esame));

    const totaliQuiz = {
      tentativi: quiz.length,
      superati:  quiz.filter((e) => e.esito === "idoneo").length,
      non_idonei:quiz.filter((e) => e.esito === "non_idoneo").length,
      assenti:   quiz.filter((e) => e.esito === "assente").length,
    };
    const totaliGuida = {
      tentativi: guida.length,
      superati:  guida.filter((e) => e.esito === "idoneo").length,
      non_idonei:guida.filter((e) => e.esito === "non_idoneo").length,
      assenti:   guida.filter((e) => e.esito === "assente").length,
    };

    res.json({
      candidato,
      quiz,
      guida,
      altri_esiti: altriEsiti,
      prenotazioni: prenotazioni || [],
      totali_quiz: totaliQuiz,
      totali_guida: totaliGuida,
      tentativi_quiz_anagrafica: candidato?.tentativi_quiz ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore storico quiz" });
  }
}

/**
 * POST /api/candidati-api/sync-portale
 * Sincronizzazione rapida: legge Situazione Candidati dal portale per tutte le combinazioni
 * (Patente Teoria, Patente Guida, CQC Teoria) e upsert nel DB.
 * Il CF non è disponibile dalla lista — si usa cognome+nome+marca come chiave.
 * Dopo il sync, restituisce la lista aggiornata.
 */
async function syncFromPortale(req, res) {
  try {
    const { readSituazioneCandidatiHttp } = require("../connector/portalSituazioneCandidati");

    // Leggi candidati per tutte le combinazioni dal portale
    const combinazioni = [
      { tipoConseguimento: "P", tipoProva: "T" },  // Patente Teoria
      { tipoConseguimento: "P", tipoProva: "G" },  // Patente Guida
      { tipoConseguimento: "Q", tipoProva: "T" },  // CQC Teoria
    ];

    const allRows = [];
    const errorsPortale = [];

    for (const comb of combinazioni) {
      try {
        const result = await readSituazioneCandidatiHttp({
          tipoConseguimento: comb.tipoConseguimento,
          tipoProva: comb.tipoProva,
          statoCandidati: "",  // tutti
        });
        if (result?.rows?.length) {
          allRows.push(...result.rows);
        }
      } catch (e) {
        errorsPortale.push(`${comb.tipoConseguimento}/${comb.tipoProva}: ${e.message}`);
      }
    }

    // Deduplica per marca_operativa (se presente) o cognome+nome
    const seen = new Map();
    const unique = [];
    for (const r of allRows) {
      const key = r.marca_operativa
        ? `M:${r.marca_operativa}`
        : `N:${(r.cognome || "").toUpperCase()}|${(r.nome || "").toUpperCase()}|${r.categoria_patente || ""}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        unique.push(r);
      }
    }

    // Upsert ciascun candidato nel DB
    let inserted = 0, updated = 0;
    const errorsDb = [];
    const autoscuolaId = req.autoscuolaId || null;

    for (const cand of unique) {
      if (!cand.cognome && !cand.nome) continue;
      const cognomeUp = (cand.cognome || "").toUpperCase().trim();
      const nomeUp = (cand.nome || "").toUpperCase().trim();

      // Converti date DD/MM/YYYY → YYYY-MM-DD
      const toIso = (d) => {
        if (!d) return null;
        const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
      };

      try {
        // Cerca candidato esistente per marca_operativa o cognome+nome
        let existing = null;
        if (cand.marca_operativa) {
          let q = supabase.from("candidates").select("id,codice_fiscale").eq("marca_operativa", cand.marca_operativa);
          q = withTenantFilter(q, req);
          const { data: found } = await q.maybeSingle();
          existing = found;
        }
        if (!existing) {
          let q = supabase.from("candidates").select("id,codice_fiscale")
            .ilike("cognome", cognomeUp).ilike("nome", nomeUp);
          q = withTenantFilter(q, req);
          const { data: found } = await q.maybeSingle();
          existing = found;
        }

        const payload = {
          cognome: cand.cognome || "",
          nome: cand.nome || "",
          categoria_patente: cand.categoria_patente || "B",
          marca_operativa: cand.marca_operativa || null,
          codice_statino: cand.codice_statino || null,
          data_iscrizione: toIso(cand.data_iscrizione) || null,
          ppg_data_scadenza: toIso(cand.data_scadenza_statino) || null,
          stato: "attivo",
          stato_iscrizione: "attivo",
          updated_at: new Date().toISOString(),
          raw_portale: {
            tipo_esame: cand.tipo_esame || null,
            data_emissione_statino: cand.data_emissione_statino || null,
            data_scadenza_statino: cand.data_scadenza_statino || null,
          },
        };

        if (existing?.id) {
          // Update — non sovrascrivere CF se già presente
          await supabase.from("candidates").update(payload).eq("id", existing.id);
          updated++;
        } else {
          // Insert — genera CF placeholder se mancante
          payload.codice_fiscale = `PORTAL-${(cand.marca_operativa || `${cognomeUp}-${nomeUp}`).replace(/[^A-Z0-9]/g, "").slice(0, 30)}-${Date.now() % 100000}`;
          if (autoscuolaId) payload.autoscuola_id = autoscuolaId;
          await supabase.from("candidates").insert([payload]);
          inserted++;
        }
      } catch (e) {
        errorsDb.push(`${cand.cognome} ${cand.nome}: ${e.message}`);
      }
    }

    // Restituisci la lista aggiornata
    const { data: lista, error: listError } = await anagraficaCandidatiService.list(req);
    if (listError) throw listError;

    res.json({
      success: true,
      sync: { portale: unique.length, inserted, updated, errorsPortale, errorsDb },
      data: lista,
    });
  } catch (e) {
    // Se il sync fallisce, restituisci comunque i dati dal DB
    try {
      const { data: lista } = await anagraficaCandidatiService.list(req);
      res.json({
        success: false,
        error: e.message,
        data: lista || [],
      });
    } catch (e2) {
      res.status(500).json({ success: false, error: e.message, data: [] });
    }
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  omonimi,
  spostaArchivio,
  storia,
  scadenze,
  listConFoglioRosa,
  storicoQuiz,
  syncFromPortale,
};
