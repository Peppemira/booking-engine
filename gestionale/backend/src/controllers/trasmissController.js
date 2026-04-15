/**
 * TrasmissController - equivalente GeCA frmTrasmiss, Trasmissioni CED.
 * Gestione invio pratiche al CED tramite SDC (SendDocComm / Agenzia Entrate).
 *
 * Flusso GeCA:
 *   1. Lista pratiche in stato 'pronto_trasmissione'
 *   2. Seleziona pratiche da trasmettere
 *   3. Inserisce credenziali SDC (usr, pwd, pin, piva, tipoincarico)
 *   4. Invia documenti di accompagnamento (SDC)
 *   5. Aggiorna stato pratiche a 'trasmesso' con idtrx/progressivo
 */

const supabase = require("../database/supabase");
const { withTenantFilter } = require("../server/auth");
const { documentiService } = require("../services");
const { runWithSSE } = require("../server/sseProgress");
const {
  trasmettiConseguimentoPatente,
  trasmettiConseguimentoCQC,
  trasmettiRinnCQC,
  trasmettiPrimaFase,
  trasmettiRinnovoPatente,
  trasmettiRinnovoMedico,
  trasmettiPraticaAltro,
  verificaRinnovabilita,
  buildModuloFromCandidato,
  trasmettiGuide,
  stampaAttestatoGuide,
  cercaSessioniEsame,
  prenotaCandidatoEsame,
} = require("../connector/trasmissionePortale");

const TABLE_PRATICHE = "pratiche_patente";
const TABLE_CANDIDATI = "candidates";

// =============================================================================
// LISTA PRATICHE PRONTE PER TRASMISSIONE
// =============================================================================

/**
 * GET /api/trasmiss/pratiche-pronte
 * Ritorna pratiche in stato 'pronto_trasmissione' o 'da_trasmettere'.
 */
async function pratichePronte(req, res) {
  try {
    let q = supabase
      .from(TABLE_PRATICHE)
      .select(`
        *,
        candidates:candidate_id (
          id, nome, cognome, codice_fiscale, categoria_patente,
          data_nascita, comune_nascita, provincia_nascita
        )
      `)
      .in("stato_pratica", ["pronto_trasmissione", "da_trasmettere", "pronto"]);

    // Tenant filter tramite candidates.autoscuola_id o codice_autoscuola
    const autoscuolaId = req.autoscuolaId;
    if (autoscuolaId) {
      // Filtra tramite join su candidates
      q = q.eq("candidates.autoscuola_id", autoscuolaId);
    }

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Filtra righe dove il candidato appartiene all'autoscuola
    const filtered = (data || []).filter(
      (r) => !autoscuolaId || r.candidates?.id
    );

    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura pratiche pronte" });
  }
}

/**
 * GET /api/trasmiss/storico
 * Ritorna pratiche già trasmesse (storico trasmissioni).
 */
async function storico(req, res) {
  try {
    let q = supabase
      .from(TABLE_PRATICHE)
      .select(`
        *,
        candidates:candidate_id (
          id, nome, cognome, codice_fiscale, categoria_patente
        )
      `)
      .eq("stato_pratica", "trasmesso");

    const autoscuolaId = req.autoscuolaId;
    const limit = Math.min(parseInt(req.query.limit || "100"), 500);

    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });

    const filtered = (data || []).filter(
      (r) => !autoscuolaId || r.candidates?.id
    );

    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura storico trasmissioni" });
  }
}

// =============================================================================
// INVIO SINGOLO DOCUMENTO DI ACCOMPAGNAMENTO
// =============================================================================

/**
 * POST /api/trasmiss/invia
 * Invia un documento di accompagnamento (SDC) per una singola pratica.
 * Body: { pratica_id, credenziali: { usr, pwd, pin, piva, tipoincarico }, dc_payload }
 */
async function invia(req, res) {
  try {
    const { pratica_id, credenziali, dc_payload } = req.body || {};

    if (!pratica_id) {
      return res.status(400).json({ error: "pratica_id obbligatorio" });
    }

    // Recupera la pratica dal DB
    const { data: pratica, error: praticaErr } = await supabase
      .from(TABLE_PRATICHE)
      .select("*, candidates:candidate_id(*)")
      .eq("id", pratica_id)
      .maybeSingle();

    if (praticaErr || !pratica) {
      return res.status(404).json({ error: "Pratica non trovata" });
    }

    // Costruisce il payload DC se non fornito esplicitamente
    const payload = dc_payload || buildDcPayload(pratica, credenziali);

    // Invia tramite SDC
    const result = await documentiService.inviaDocumentoAccompagnamento(
      payload,
      {
        baseUrl: process.env.AGENZIAENTRATE_BASE_URL,
        usr: credenziali?.usr || process.env.AGENZIAENTRATE_USR,
        pwd: credenziali?.pwd || process.env.AGENZIAENTRATE_PWD,
        pin: credenziali?.pin || process.env.AGENZIAENTRATE_PIN,
        piva: credenziali?.piva || process.env.AGENZIAENTRATE_PIVA,
        tipoincarico: credenziali?.tipoincarico || process.env.AGENZIAENTRATE_TIPOINCARICO,
      }
    );

    if (!result.esito) {
      return res.status(500).json({
        success: false,
        error: "Trasmissione fallita",
        errori: result.errori,
        pratica_id,
      });
    }

    // Aggiorna stato pratica a 'trasmesso'
    await supabase
      .from(TABLE_PRATICHE)
      .update({
        stato_pratica: "trasmesso",
      })
      .eq("id", pratica_id);

    res.json({
      success: true,
      pratica_id,
      idtrx: result.idtrx,
      progressivo: result.progressivo,
      messaggio: `Pratica trasmessa — IDTrx: ${result.idtrx || "–"}, Progr: ${result.progressivo || "–"}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione" });
  }
}

// =============================================================================
// INVIO MASSIVO
// =============================================================================

/**
 * POST /api/trasmiss/invia-massivo
 * Invia più pratiche in batch.
 * Body: { pratica_ids: string[], credenziali: { usr, pwd, pin, piva, tipoincarico } }
 */
async function inviaMassivo(req, res) {
  try {
    const { pratica_ids, credenziali } = req.body || {};

    if (!Array.isArray(pratica_ids) || pratica_ids.length === 0) {
      return res.status(400).json({ error: "pratica_ids array obbligatorio" });
    }

    const MAX_BATCH = 50;
    if (pratica_ids.length > MAX_BATCH) {
      return res.status(400).json({
        error: `Massimo ${MAX_BATCH} pratiche per invio massivo`,
      });
    }

    // Recupera le pratiche
    const { data: pratiche, error: pratErr } = await supabase
      .from(TABLE_PRATICHE)
      .select("*, candidates:candidate_id(*)")
      .in("id", pratica_ids);

    if (pratErr) {
      return res.status(500).json({ error: pratErr.message });
    }

    const risultati = [];
    const trasmesseIds = [];

    for (const pratica of pratiche || []) {
      try {
        const payload = buildDcPayload(pratica, credenziali);

        const result = await documentiService.inviaDocumentoAccompagnamento(
          payload,
          {
            baseUrl: process.env.AGENZIAENTRATE_BASE_URL,
            usr: credenziali?.usr || process.env.AGENZIAENTRATE_USR,
            pwd: credenziali?.pwd || process.env.AGENZIAENTRATE_PWD,
            pin: credenziali?.pin || process.env.AGENZIAENTRATE_PIN,
            piva: credenziali?.piva || process.env.AGENZIAENTRATE_PIVA,
            tipoincarico: credenziali?.tipoincarico || process.env.AGENZIAENTRATE_TIPOINCARICO,
          }
        );

        if (result.esito) {
          trasmesseIds.push(pratica.id);
          risultati.push({
            pratica_id: pratica.id,
            candidato: `${pratica.candidates?.cognome || ""} ${pratica.candidates?.nome || ""}`.trim(),
            successo: true,
            idtrx: result.idtrx,
            progressivo: result.progressivo,
          });
        } else {
          risultati.push({
            pratica_id: pratica.id,
            candidato: `${pratica.candidates?.cognome || ""} ${pratica.candidates?.nome || ""}`.trim(),
            successo: false,
            errori: result.errori,
          });
        }
      } catch (e) {
        risultati.push({
          pratica_id: pratica.id,
          successo: false,
          errore: e.message,
        });
      }
    }

    // Aggiorna stato pratiche trasmesse con successo
    if (trasmesseIds.length > 0) {
      await supabase
        .from(TABLE_PRATICHE)
        .update({ stato_pratica: "trasmesso" })
        .in("id", trasmesseIds);
    }

    const successi = risultati.filter((r) => r.successo).length;
    const fallite = risultati.filter((r) => !r.successo).length;

    res.json({
      success: true,
      totale: pratica_ids.length,
      trasmesse: successi,
      fallite,
      risultati,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore invio massivo" });
  }
}

// =============================================================================
// AGGIORNA STATO PRATICA (manuale)
// =============================================================================

/**
 * PUT /api/trasmiss/stato/:id
 * Aggiorna manualmente lo stato di una pratica (pronto_trasmissione, trasmesso, ecc.)
 */
async function aggiornaStato(req, res) {
  try {
    const { id } = req.params;
    const { stato_pratica } = req.body || {};

    const STATI_VALIDI = [
      "da_trasmettere",
      "pronto_trasmissione",
      "pronto",
      "trasmesso",
      "approvato",
      "respinto",
      "sospeso",
    ];

    if (!STATI_VALIDI.includes(stato_pratica)) {
      return res.status(400).json({
        error: `stato_pratica non valido. Valori ammessi: ${STATI_VALIDI.join(", ")}`,
      });
    }

    const { error } = await supabase
      .from(TABLE_PRATICHE)
      .update({ stato_pratica })
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, id, stato_pratica });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore aggiornamento stato" });
  }
}

// =============================================================================
// HELPER — Costruisce payload DC da pratica
// =============================================================================

/**
 * Costruisce il payload RootObject/DC per l'invio SDC.
 * Basato sulla struttura DC.cs di GeCA.
 */
function buildDcPayload(pratica, credenziali = {}) {
  const c = pratica?.candidates || {};
  const codiceFiscaleAut = credenziali?.codiceFiscale || process.env.AGENZIAENTRATE_CF || "";

  return {
    datiTrasmissione: {
      codiceDestinatario: credenziali?.codiceDestinatario || "0000000",
      formatoTrasmissione: "FPR12",
      progressivoInvio: pratica?.progressivo || "1",
      contattiTrasmittente: {
        email: credenziali?.email || "",
        telefono: credenziali?.telefono || "",
      },
    },
    identificativiFiscali: {
      codiceFiscale: codiceFiscaleAut,
      pIva: credenziali?.piva || process.env.AGENZIAENTRATE_PIVA || "",
    },
    altriDatiIdentificativi: {
      denominazione: credenziali?.denominazione || "",
      indirizzo: {
        indirizzo: "",
        numeroCivico: "",
        cap: "",
        comune: "",
        provincia: "",
        nazione: "IT",
      },
    },
    pratica: {
      id: pratica?.id,
      tipo_pratica: pratica?.tipo_pratica,
      categoria_patente: pratica?.categoria_patente,
      codice_autoscuola: pratica?.codice_autoscuola,
      codice_statino: pratica?.codice_statino,
      marca_operativa: pratica?.marca_operativa,
      data_iscrizione: pratica?.data_iscrizione,
    },
    candidato: {
      nome: c.nome || "",
      cognome: c.cognome || "",
      codiceFiscale: c.codice_fiscale || "",
      dataNascita: c.data_nascita || "",
      comuneNascita: c.comune_nascita || "",
      provinciaNascita: c.provincia_nascita || "",
    },
  };
}

// =============================================================================
// TRASMISSIONE PORTALE AUTOMOBILISTA
// =============================================================================

/**
 * Ottieni credenziali portale dai parametri della richiesta o dalle env.
 * Priorità: body.credenziali > env vars.
 */
function resolvePortalCredentials(credenziali = {}) {
  return {
    username:  credenziali.username  || process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password:  credenziali.password  || process.env.PORTAL_PASSWORD || process.env.PORTAL_PWD,
    pin:       credenziali.pin       || process.env.PORTAL_PIN,
    codiceAutoscuola: credenziali.codiceAutoscuola || process.env.PORTAL_CODICE_AUTOSCUOLA,
  };
}

/**
 * Carica la pratica con il candidato da Supabase.
 */
async function loadPraticaConCandidato(praticaId) {
  const { data, error } = await supabase
    .from(TABLE_PRATICHE)
    .select("*, candidates:candidate_id(*)")
    .eq("id", praticaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Pratica ${praticaId} non trovata`);
  return data;
}

/**
 * Salva esito trasmissione portale su pratiche_patente.
 */
async function salvaEsitoTrasmissione(praticaId, result) {
  const updates = {};
  if (result.success) {
    updates.stato_pratica = "trasmesso_portale";
    if (result.marcaOperativa)          updates.marca_operativa         = result.marcaOperativa;
    if (result.idRichiesta)             updates.id_richiesta_portale    = result.idRichiesta;
    if (result.codiceEstremiPagamento)  updates.codice_estremi_pagamento = result.codiceEstremiPagamento;
    if (result.progressivo)             updates.progressivo_portale     = result.progressivo;
    updates.data_trasmissione_portale = new Date().toISOString();
  } else {
    updates.ultimo_errore_portale = result.error || "Errore sconosciuto";
    updates.data_ultimo_errore_portale = new Date().toISOString();
  }
  await supabase.from(TABLE_PRATICHE).update(updates).eq("id", praticaId);
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/rinnovabilita
// Verifica rinnovabilità patente (HTTP, non Puppeteer).
// Body: { pratica_id, credenziali? }
// -----------------------------------------------------------------------
async function rinnovabilitaHandler(req, res) {
  try {
    const { pratica_id, credenziali } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    const result = await verificaRinnovabilita({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore verifica rinnovabilità" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/conseguimento
// Trasmette pratica conseguimento patente (A/B/C/D/AM).
// Body: { pratica_id, credenziali?, bollettini?, fotoBase64?, firmaBase64?, extra? }
// -----------------------------------------------------------------------
async function conseguimentoHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    // Aggiorna stato a "in_trasmissione" per feedback UI
    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiConseguimentoPatente({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      bollettini,
      fotoBase64,
      firmaBase64,
      extra,
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
      log: result.log,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione conseguimento" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/cqc
// Trasmette pratica conseguimento CQC.
// -----------------------------------------------------------------------
async function cqcHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiConseguimentoCQC({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      bollettini,
      fotoBase64,
      firmaBase64,
      extra,
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione CQC" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/prima-fase
// Trasmette pratica prima fase (AM/A1/A2/A).
// -----------------------------------------------------------------------
async function primaFaseHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiPrimaFase({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      bollettini,
      fotoBase64,
      firmaBase64,
      extra,
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione prima fase" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/rinnovo
// Trasmette pratica rinnovo patente completo.
// -----------------------------------------------------------------------
async function rinnovoHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiRinnovoPatente({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      bollettini,
      fotoBase64,
      firmaBase64,
      extra,
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione rinnovo" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/rinnovo-medico
// Trasmette pratica rinnovo con TT2112 (certificato medico).
// -----------------------------------------------------------------------
async function rinnovoMedicoHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    // Costruisci modulo con CIA fields dall'extra (codice_cia, ufficio_cia, dati medico)
    const moduloCia = buildModuloFromCandidato(pratica.candidates, extra || {});

    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiRinnovoMedico({
      credentials: creds,
      modulo: moduloCia,
      pratica,
      bollettini,
      fotoBase64,
      firmaBase64,
      marcaOperativaNumero: pratica.marca_operativa || "",
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione rinnovo medico" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/altro
// Trasmette pratica duplicato/smarrimento/deterioramento.
// -----------------------------------------------------------------------
async function altroHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiPraticaAltro({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      bollettini,
      fotoBase64,
      firmaBase64,
      extra,
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione pratica altro" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/guide
// Trasmette esercitazioni di guida sul portale (sezione Esercitazioni Guida).
// Body: { pratica_id, credenziali?, guide: [{ modulo, targa, istruttore_nome, istruttore_cognome, data, ora, durata_minuti, n_iscrizione }] }
// -----------------------------------------------------------------------
async function guideHandler(req, res) {
  try {
    const { pratica_id, credenziali, guide } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });
    if (!Array.isArray(guide) || guide.length === 0) {
      return res.status(400).json({ error: "guide array obbligatorio e non vuoto" });
    }

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    const result = await trasmettiGuide({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      guide,
      onProgress: () => {},
    });

    if (result.success) {
      // Salva guide su Supabase (tabella esercitazioni_guida)
      const guideRecords = guide.map((g) => ({
        autoscuola_id:     pratica.autoscuola_id,
        candidato_id:      pratica.candidato_id || pratica.candidate_id,
        pratica_id:        pratica_id,
        data_esercitazione: g.data
          ? (() => {
              // Converte GG/MM/YYYY → YYYY-MM-DD
              const parts = String(g.data).split("/");
              if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
              return g.data;
            })()
          : null,
        ora_inizio:         g.ora || null,
        durata_minuti:      g.durata_minuti ? parseInt(g.durata_minuti, 10) : null,
        targa_veicolo:      g.targa || null,
        tipo_guida:         g.tipo_guida || "normale",
        istruttore_nome:    `${g.istruttore_nome || ""} ${g.istruttore_cognome || ""}`.trim(),
        trasmessa_portale:  true,
        data_trasmissione:  new Date().toISOString(),
        note:               g.n_iscrizione ? `Iscrizione registro: ${g.n_iscrizione}` : null,
      }));

      await supabase.from("esercitazioni_guida").insert(guideRecords);
    }

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      haStampaAttestato: result.haStampaAttestato,
      log: result.log,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione guide" });
  }
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/stampa-attestato
// Stampa attestato guida sul portale.
// Body: { pratica_id, credenziali? }
// -----------------------------------------------------------------------
async function stampaAttestatoHandler(req, res) {
  try {
    const { pratica_id, credenziali } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);

    const result = await stampaAttestatoGuide({
      credentials: creds,
      pratica,
      candidato: pratica.candidates,
      onProgress: () => {},
    });

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({ success: true, pratica_id, log: result.log });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore stampa attestato" });
  }
}

// -----------------------------------------------------------------------
// GET /api/trasmiss/portale/pratiche-pronte
// Pratiche pronte per trasmissione portale (stato 'pronto_trasmissione')
// con tipo_trasmissione valorizzato.
// -----------------------------------------------------------------------
async function praticheProntePortale(req, res) {
  try {
    const autoscuolaId = req.autoscuolaId;
    let q = supabase
      .from(TABLE_PRATICHE)
      .select(`
        id, tipo_pratica, tipo_trasmissione, stato_pratica,
        marca_operativa, codice_autoscuola, data_iscrizione,
        marca_operativa, id_richiesta_portale, data_trasmissione_portale,
        candidates:candidate_id (
          id, nome, cognome, codice_fiscale, categoria_patente,
          data_nascita, comune_nascita, provincia_nascita
        )
      `)
      .in("stato_pratica", ["pronto_trasmissione", "da_trasmettere", "pronto"]);

    const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });

    const filtered = (data || []).filter(
      (r) => !autoscuolaId || r.candidates?.id
    );

    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura pratiche pronte portale" });
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

// =============================================================================
// SESSIONI ESAME PROGRAMMATO (SGOS/SQI)
// =============================================================================

/**
 * GET /api/trasmiss/portale/sessioni-esame
 * Ricerca sessioni esame disponibili sul portale.
 * Query: data_da, data_a, tipo_sessione (SQI|SGOS), username, password, pin
 */
async function sessioniEsameHandler(req, res) {
  const { data_da, data_a, tipo_sessione = "SQI", username, password, pin } = req.query;
  const credenziali = resolvePortalCredentials(username ? { username, password, pin } : {});
  await runWithSSE(req, res, async (onProgress) => {
    return await cercaSessioniEsame(credenziali, { data_da, data_a, tipo_sessione, onProgress });
  });
}

/**
 * POST /api/trasmiss/portale/prenota-esame
 * Prenota un candidato in una sessione d'esame.
 * Body: { credenziali?, id_verbale, tipo_sessione, cod_foglio_rosa, cognome,
 *         lingua?, audio?, turno?, aula? }
 */
async function prenotaEsameHandler(req, res) {
  const { credenziali, id_verbale, tipo_sessione, cod_foglio_rosa, cognome, lingua, audio, turno, aula } = req.body || {};
  if (!id_verbale) return res.status(400).json({ error: "id_verbale obbligatorio" });
  const creds = resolvePortalCredentials(credenziali || {});
  await runWithSSE(req, res, async (onProgress) => {
    return await prenotaCandidatoEsame(creds, {
      id_verbale, tipo_sessione, cod_foglio_rosa, cognome, lingua, audio, turno, aula, onProgress,
    });
  });
}

// -----------------------------------------------------------------------
// POST /api/trasmiss/portale/rinnovo-cqc
// Trasmette rinnovo CQC (tipoMotivo=R).
// Body: { pratica_id, credenziali?, bollettini?, extra? }
// -----------------------------------------------------------------------
async function rinnCqcHandler(req, res) {
  try {
    const { pratica_id, credenziali, bollettini, fotoBase64, firmaBase64, extra } = req.body || {};
    if (!pratica_id) return res.status(400).json({ error: "pratica_id obbligatorio" });

    const pratica = await loadPraticaConCandidato(pratica_id);
    const creds   = resolvePortalCredentials(credenziali);
    const cf      = pratica?.candidates?.codice_fiscale || "";
    const modulo  = buildModuloFromCandidato(pratica.candidates, extra || {});

    await supabase.from(TABLE_PRATICHE).update({ stato_pratica: "in_trasmissione" }).eq("id", pratica_id);

    const result = await trasmettiRinnCQC({
      credentials: creds,
      modulo,
      bollettini,
      fotoBase64,
      firmaBase64,
      codiceFiscale: cf,
      onProgress: () => {},
    });

    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result.success) {
      return res.status(422).json({ success: false, error: result.error, log: result.log });
    }

    res.json({
      success: true,
      pratica_id,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      messaggioPortale: result.messaggioPortale,
      log: result.log,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore rinnovo CQC" });
  }
}

// =============================================================================
// CANDIDATI-CENTRIC ENDPOINTS (replica GeCA Trasmiss.cs invio_Click logic)
// =============================================================================
// GeCA Trasmiss.cs lavora sempre a partire dall'iscrizione (candidato) e NON
// dalla pratica_patente. Questi endpoint colmano il gap: elencano candidati
// pronti per trasmissione (raggruppati per sigla) e dispatchano verso il
// corretto handler portal a partire dal candidato.

/**
 * Mappa sigla tipo_iscrizione GeCA → chiave operazione.
 * Sigle trasmissibili (15 su 22): IN/PR/RE, CV, CM, D|/Y|/L|/S|/R|, M|/E|,
 * PC, CC, GA.
 * Sigle non trasmissibili al portale automobilista: PN (nautica),
 * RP/CQ/CK/CA (corsi interni), EG/AD/PI/PP (altri).
 */
const SIGLA_TO_OPERAZIONE = {
  // Conseguimento per esame → trasmettiConseguimentoPatente
  IN: "conseguimento",
  PR: "conseguimento",
  RE: "conseguimento",
  // Rinnovo / conferma validita' → trasmettiRinnovoPatente
  CV: "rinnovo",
  // Certificato medico / rinnovo con TT2112 → trasmettiRinnovoMedico
  CM: "rinnovo_medico",
  // Duplicato patente → trasmettiPraticaAltro
  "D|": "altro",
  "Y|": "altro",
  "L|": "altro",
  "S|": "altro",
  "R|": "altro",
  // Conversione patente → trasmettiPraticaAltro
  "M|": "altro",
  "E|": "altro",
  // Patente CQC (conseguimento) → trasmettiConseguimentoCQC
  PC: "cqc",
  // CQC Card (rinnovo CQC) → trasmettiRinnCQC
  CC: "rinn_cqc",
  // Guida Accompagnata → trasmettiPrimaFase (prima fase AM/A1/A2/A)
  GA: "prima_fase",
};

/**
 * Mappa operazione → tipo_pratica (per la tabella pratiche_patente)
 */
const OPERAZIONE_TO_TIPO_PRATICA = {
  conseguimento:  "ESAME",
  rinnovo:        "RINNOVO",
  rinnovo_medico: "CERTIFICATO_MEDICO",
  altro:          "DUPLICATO",
  cqc:            "CQC",
  rinn_cqc:       "RINNOVO_CQC",
  prima_fase:     "GUIDA_ACCOMPAGNATA",
};

/**
 * Etichetta leggibile per operazione (usata in UI).
 */
const OPERAZIONE_LABEL = {
  conseguimento:  "Conseguimento Patente",
  rinnovo:        "Rinnovo Patente",
  rinnovo_medico: "Rinnovo con Cert. Medico",
  altro:          "Duplicato / Conversione",
  cqc:            "Conseguimento CQC",
  rinn_cqc:       "Rinnovo CQC",
  prima_fase:     "Prima Fase (Foglio Rosa)",
};

/**
 * Risolve la sigla dal candidato (campi diretti o raw_portale fallback).
 */
function resolveSiglaFromCandidato(candidato = {}) {
  return (
    candidato.tipo_iscrizione_sigla ||
    candidato.raw_portale?.tipo_iscrizione_sigla ||
    candidato.raw_portale?.sigla ||
    ""
  );
}

/**
 * GET /api/trasmiss/candidati-pronti
 *
 * Query params:
 *   - sigla:  filtra per sigla specifica (opzionale)
 *   - tipo:   filtra per chiave operazione (conseguimento/rinnovo/…) opzionale
 *   - includi_trasmessi: "true" per includere anche candidati già trasmessi
 *
 * Ritorna:
 *   {
 *     success: true,
 *     candidati: [ ... ],          // array di candidati arricchiti con stato pratica
 *     count: N,
 *     gruppi: { IN: 10, CM: 3 },   // conteggi per sigla
 *     gruppi_operazione: { ... },  // conteggi per operazione
 *   }
 */
async function candidatiPronti(req, res) {
  try {
    const siglaFiltro = (req.query.sigla || "").trim();
    const tipoFiltro  = (req.query.tipo || "").trim();
    const includiTrasmessi = String(req.query.includi_trasmessi || "") === "true";

    // 1) Carica candidati (con tenant filter)
    let q = supabase
      .from("candidates")
      .select(
        "id,cognome,nome,codice_fiscale,data_nascita,categoria_patente," +
        "categoria_richiesta,codice_autoscuola,data_iscrizione," +
        "stato_iscrizione,telefono,raw_portale,created_at"
      );
    q = withTenantFilter(q, req);
    // Escludi archiviati (storico)
    q = q.or("storico.is.null,storico.eq.false");
    q = q.order("created_at", { ascending: false }).limit(500);

    const { data: candidatiRaw, error: errCand } = await q;
    if (errCand) return res.status(500).json({ error: errCand.message });

    const candidati = candidatiRaw || [];
    if (candidati.length === 0) {
      return res.json({ success: true, candidati: [], count: 0, gruppi: {}, gruppi_operazione: {} });
    }

    // 2) Carica tutte le pratiche_patente per questi candidati
    const ids = candidati.map((c) => c.id);
    const { data: pratiche, error: errPrat } = await supabase
      .from(TABLE_PRATICHE)
      .select(
        "id,candidate_id,candidato_id,tipo_pratica,tipo_trasmissione," +
        "stato_pratica,marca_operativa,id_richiesta_portale," +
        "data_trasmissione_portale,ultimo_errore_portale,codice_estremi_pagamento"
      )
      .or(`candidate_id.in.(${ids.join(",")}),candidato_id.in.(${ids.join(",")})`);
    if (errPrat && !/column.*does not exist/i.test(String(errPrat.message))) {
      return res.status(500).json({ error: errPrat.message });
    }

    // 3) Mappa candidato_id → pratica (la più recente)
    const praticaPerCandidato = new Map();
    for (const p of pratiche || []) {
      const cid = p.candidate_id || p.candidato_id;
      if (cid && !praticaPerCandidato.has(cid)) {
        praticaPerCandidato.set(cid, p);
      }
    }

    // 4) Arricchisci candidati con stato pratica + determina trasmissibilita'
    const gruppi = {};
    const gruppi_op = {};
    const enriched = [];
    for (const c of candidati) {
      const sigla = resolveSiglaFromCandidato(c);
      const operazione = SIGLA_TO_OPERAZIONE[sigla] || null;
      const pratica = praticaPerCandidato.get(c.id) || null;
      const trasmesso = !!(pratica && pratica.id_richiesta_portale);

      // Filtri
      if (siglaFiltro && sigla !== siglaFiltro) continue;
      if (tipoFiltro && operazione !== tipoFiltro) continue;
      if (!includiTrasmessi && trasmesso) continue;
      // Candidato deve avere una sigla trasmissibile (altrimenti skip)
      if (!operazione) continue;

      gruppi[sigla] = (gruppi[sigla] || 0) + 1;
      gruppi_op[operazione] = (gruppi_op[operazione] || 0) + 1;

      enriched.push({
        id: c.id,
        cognome: c.cognome,
        nome: c.nome,
        codice_fiscale: c.codice_fiscale,
        data_nascita: c.data_nascita,
        telefono: c.telefono,
        categoria_patente: c.categoria_patente,
        categoria_richiesta: c.categoria_richiesta,
        codice_autoscuola: c.codice_autoscuola,
        data_iscrizione: c.data_iscrizione,
        stato_iscrizione: c.stato_iscrizione,
        raw_portale: c.raw_portale,
        // Campi derivati per la trasmissione
        tipo_iscrizione_sigla: sigla,
        operazione,
        operazione_label: OPERAZIONE_LABEL[operazione] || operazione,
        tipo_pratica_suggerito: OPERAZIONE_TO_TIPO_PRATICA[operazione] || "ALTRO",
        // Stato pratica (se esiste)
        pratica_id: pratica?.id || null,
        stato_pratica: pratica?.stato_pratica || "da_creare",
        marca_operativa: pratica?.marca_operativa || null,
        id_richiesta_portale: pratica?.id_richiesta_portale || null,
        data_trasmissione_portale: pratica?.data_trasmissione_portale || null,
        ultimo_errore_portale: pratica?.ultimo_errore_portale || null,
        trasmesso,
      });
    }

    res.json({
      success: true,
      candidati: enriched,
      count: enriched.length,
      gruppi,
      gruppi_operazione: gruppi_op,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura candidati pronti" });
  }
}

/**
 * Helper: cerca o crea una pratica_patente per un candidato+operazione.
 * Replica la logica implicita di GeCA Trasmiss che opera sempre su un candidato.
 */
async function getOrCreatePraticaForCandidato(candidato, operazione, extras = {}) {
  const tipoPratica = OPERAZIONE_TO_TIPO_PRATICA[operazione] || "ALTRO";

  // 1) Cerca pratica esistente per candidato+tipo_pratica (non ancora trasmessa)
  let q = supabase
    .from(TABLE_PRATICHE)
    .select("*")
    .eq("tipo_pratica", tipoPratica)
    .or("id_richiesta_portale.is.null,id_richiesta_portale.eq.")
    .order("created_at", { ascending: false })
    .limit(1);
  q = q.or(`candidate_id.eq.${candidato.id},candidato_id.eq.${candidato.id}`);
  const { data: esistente } = await q;
  if (esistente && esistente.length > 0) return esistente[0];

  // 2) Crea nuova pratica
  const TIPO_TRASMISSIONE_MAP = {
    ESAME:              "trasmissione_pratica_conseguimento",
    RINNOVO:            "trasmissione_pratica_rinnovo",
    CQC:                "trasmissione_pratica_conseguimento_cqc",
    RINNOVO_CQC:        "rinnovo_cqc",
    CERTIFICATO_MEDICO: "trasmissione_pratica_rinnovo_medico",
    DUPLICATO:          "trasmissione_pratica_altro",
    GUIDA_ACCOMPAGNATA: "trasmissione_pratica_conseguimento_fase1",
    ALTRO:              "trasmissione_pratica_altro",
  };

  const payload = {
    candidato_id:      candidato.id,
    candidate_id:      candidato.id,
    tipo_pratica:      tipoPratica,
    categoria:         candidato.categoria_patente || candidato.categoria_richiesta || null,
    categoria_patente: candidato.categoria_patente || candidato.categoria_richiesta || null,
    stato:             "attivo",
    stato_pratica:     "pronto_trasmissione",
    tipo_trasmissione: TIPO_TRASMISSIONE_MAP[tipoPratica] || "trasmissione_pratica_altro",
    data_richiesta:    new Date().toISOString().slice(0, 10),
    codice_autoscuola: candidato.codice_autoscuola || null,
    ...extras,
  };
  // Tenant field opzionale
  if (candidato.autoscuola_id) payload.autoscuola_id = candidato.autoscuola_id;

  // Tentativo insert con fallback se alcuni campi non esistono
  let attempt = { ...payload };
  for (let i = 0; i < 8; i++) {
    const { data, error } = await supabase
      .from(TABLE_PRATICHE)
      .insert([attempt])
      .select("*")
      .single();
    if (!error) return data;
    const m = String(error.message || "").match(/Could not find the '([^']+)' column|column "([^"]+)" of relation|column\s+([a-zA-Z0-9_]+)\s+does not exist/i);
    const missing = m?.[1] || m?.[2] || m?.[3];
    if (!missing || !(missing in attempt)) throw new Error(error.message);
    delete attempt[missing];
  }
  throw new Error("Impossibile creare la pratica_patente: troppi tentativi di fallback colonne");
}

/**
 * POST /api/trasmiss/trasmetti-candidato
 *
 * Dispatcher unificato: dato un candidato, determina la sigla, crea (se serve)
 * una pratica_patente e chiama il giusto handler di trasmissione al portale.
 *
 * Body:
 *   - candidato_id:  (obbligatorio)
 *   - sigla:         override sigla tipo_iscrizione (opzionale)
 *   - credenziali:   credenziali portale (opzionale — fallback a env/default)
 *   - bollettini:    array bollettini di pagamento (opzionale)
 *   - fotoBase64:    base64 foto candidato (opzionale)
 *   - firmaBase64:   base64 firma candidato (opzionale)
 *   - extra:         dati extra specifici (opzionale)
 */
async function trasmettiCandidato(req, res) {
  try {
    const {
      candidato_id,
      sigla: siglaOverride,
      credenziali,
      bollettini,
      fotoBase64,
      firmaBase64,
      extra,
    } = req.body || {};

    if (!candidato_id) {
      return res.status(400).json({ error: "candidato_id obbligatorio" });
    }

    // 1) Carica candidato
    let cq = supabase.from("candidates").select("*").eq("id", candidato_id);
    cq = withTenantFilter(cq, req);
    const { data: candidato, error: errCand } = await cq.maybeSingle();
    if (errCand) return res.status(500).json({ error: errCand.message });
    if (!candidato) return res.status(404).json({ error: "Candidato non trovato" });

    // 2) Determina sigla + operazione
    const sigla = (siglaOverride || resolveSiglaFromCandidato(candidato) || "").trim();
    if (!sigla) {
      return res.status(400).json({ error: "Sigla tipo_iscrizione mancante — impossibile determinare l'operazione" });
    }
    const operazione = SIGLA_TO_OPERAZIONE[sigla];
    if (!operazione) {
      return res.status(400).json({
        error: `Sigla '${sigla}' non trasmissibile al portale automobilista`,
        sigla,
        trasmissibile: false,
      });
    }

    // 3) Ottieni o crea pratica_patente
    const pratica = await getOrCreatePraticaForCandidato(candidato, operazione);
    const pratica_id = pratica.id;

    // Collega il candidato alla pratica per i successivi loadPraticaConCandidato
    const praticaConCandidato = { ...pratica, candidates: candidato };

    // 4) Aggiorna stato a in_trasmissione (UI feedback)
    await supabase
      .from(TABLE_PRATICHE)
      .update({ stato_pratica: "in_trasmissione" })
      .eq("id", pratica_id);

    // 5) Risolvi credenziali
    const creds = resolvePortalCredentials(credenziali);

    // 6) Dispatch all'handler corretto in base a operazione
    let result;
    switch (operazione) {
      case "conseguimento":
        result = await trasmettiConseguimentoPatente({
          credentials: creds,
          pratica: praticaConCandidato,
          candidato,
          bollettini,
          fotoBase64,
          firmaBase64,
          extra,
          onProgress: () => {},
        });
        break;
      case "rinnovo":
        result = await trasmettiRinnovoPatente({
          credentials: creds,
          pratica: praticaConCandidato,
          candidato,
          bollettini,
          fotoBase64,
          firmaBase64,
          extra,
          onProgress: () => {},
        });
        break;
      case "rinnovo_medico": {
        const moduloCia = buildModuloFromCandidato(candidato, extra || {});
        result = await trasmettiRinnovoMedico({
          credentials: creds,
          pratica: praticaConCandidato,
          candidato,
          modulo: moduloCia,
          bollettini,
          fotoBase64,
          firmaBase64,
          extra,
          onProgress: () => {},
        });
        break;
      }
      case "altro":
        result = await trasmettiPraticaAltro({
          credentials: creds,
          pratica: praticaConCandidato,
          candidato,
          bollettini,
          fotoBase64,
          firmaBase64,
          extra,
          onProgress: () => {},
        });
        break;
      case "cqc":
        result = await trasmettiConseguimentoCQC({
          credentials: creds,
          pratica: praticaConCandidato,
          candidato,
          bollettini,
          fotoBase64,
          firmaBase64,
          extra,
          onProgress: () => {},
        });
        break;
      case "rinn_cqc": {
        const moduloCqc = buildModuloFromCandidato(candidato, extra || {});
        result = await trasmettiRinnCQC({
          credentials: creds,
          modulo: moduloCqc,
          bollettini,
          fotoBase64,
          firmaBase64,
          codiceFiscale: candidato.codice_fiscale || "",
          onProgress: () => {},
        });
        break;
      }
      case "prima_fase":
        result = await trasmettiPrimaFase({
          credentials: creds,
          pratica: praticaConCandidato,
          candidato,
          bollettini,
          fotoBase64,
          firmaBase64,
          extra,
          onProgress: () => {},
        });
        break;
      default:
        return res.status(400).json({ error: `Operazione '${operazione}' non implementata` });
    }

    // 7) Salva esito e rispondi
    await salvaEsitoTrasmissione(pratica_id, result);

    if (!result || !result.success) {
      return res.status(422).json({
        success: false,
        pratica_id,
        sigla,
        operazione,
        error: result?.error || "Errore trasmissione",
        log: result?.log || null,
      });
    }

    return res.json({
      success: true,
      candidato_id: candidato.id,
      pratica_id,
      sigla,
      operazione,
      operazione_label: OPERAZIONE_LABEL[operazione] || operazione,
      marcaOperativa: result.marcaOperativa,
      idRichiesta: result.idRichiesta,
      codiceEstremiPagamento: result.codiceEstremiPagamento,
      messaggioPortale: result.messaggioPortale,
      log: result.log,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore trasmissione candidato" });
  }
}

/**
 * GET /api/trasmiss/candidato-operazioni
 * Ritorna la mappa SIGLA_TO_OPERAZIONE + etichette per il frontend.
 */
function candidatoOperazioni(req, res) {
  res.json({
    success: true,
    sigla_to_operazione: SIGLA_TO_OPERAZIONE,
    operazione_label: OPERAZIONE_LABEL,
    operazione_to_tipo_pratica: OPERAZIONE_TO_TIPO_PRATICA,
    sigle_non_trasmissibili: [
      "PN", "RP", "CQ", "CK", "CA", "EG", "AD", "PI", "PP",
    ],
  });
}

module.exports = {
  pratichePronte,
  storico,
  invia,
  inviaMassivo,
  aggiornaStato,
  // Portale trasmissione
  rinnovabilitaHandler,
  conseguimentoHandler,
  cqcHandler,
  rinnCqcHandler,
  primaFaseHandler,
  rinnovoHandler,
  rinnovoMedicoHandler,
  altroHandler,
  praticheProntePortale,
  guideHandler,
  stampaAttestatoHandler,
  // Sessioni esame programmato
  sessioniEsameHandler,
  prenotaEsameHandler,
  // Candidati-centric (replica GeCA Trasmiss.cs flow)
  candidatiPronti,
  trasmettiCandidato,
  candidatoOperazioni,
};
