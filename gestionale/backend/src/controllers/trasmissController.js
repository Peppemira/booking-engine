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
};
