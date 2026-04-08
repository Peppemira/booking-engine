/**
 * Controller REST per portale (GeCA modConnPort, connessioneportalenew, Portale).
 */

const { getPuntiPatente } = require("../connector/puntiPatente");
const { PortalService } = require("../services");
const { getOrLoginJar } = require("../connector/portalSession");
const {
  makeHttpClient,
  cercaCandidatoPerPatente,
  cercaCandidatoPerProtocolloMedico,
  cercaRichiestaPerMarca,
  cercaRichiesteEsame,
  nuovaIscrizioneEsame,
  foglioRosa,
  rinnovoPatente,
  cercaCQCPerCodFisc,
  cambioCodiceAutoscuola,
} = require("../connector/portalHttp");
const {
  searchCandidates,
  importMassivo,
} = require("../connector/importByPatente");
const supabase = require("../database/supabase");

// =============================================================================
// Helper: ottieni client HTTP con sessione attiva
// =============================================================================
async function getClient() {
  const jar = await getOrLoginJar({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  return makeHttpClient(jar);
}

function getAutoscuolaId(req) {
  return req?.autoscuolaId || req?.autoscuola?.id || null;
}

// =============================================================================
// FUNZIONI ORIGINALI
// =============================================================================

async function puntiPatente(req, res) {
  try {
    const { codice_fiscale, numero_patente } = req.body || {};
    if (!codice_fiscale || !numero_patente) {
      return res.status(400).json({ error: "codice_fiscale e numero_patente obbligatori" });
    }
    const credenziali = req.body?.credenziali || {};
    const result = await getPuntiPatente({
      codiceFiscale: codice_fiscale,
      numeroPatente: numero_patente,
      ...credenziali,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore interrogazione punti patente" });
  }
}

async function login(req, res) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username e password obbligatori" });
    }
    const portal = new PortalService();
    const html = await portal.login(username, password);
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore login portale" });
  }
}

async function validatePin(req, res) {
  try {
    const { pin, goto_link } = req.body || {};
    if (!pin) return res.status(400).json({ error: "pin obbligatorio" });
    const portal = new PortalService();
    const html = await portal.validatePin(pin, goto_link);
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore validazione PIN" });
  }
}

// =============================================================================
// IMPORT — endpoint usati dalla pagina /import
// =============================================================================

/**
 * POST /portal/search-results
 * Cerca candidati sul portale senza salvare nel DB.
 */
async function searchResults(req, res) {
  try {
    const {
      cognome,
      numeroPatente,
      codiceFiscale,
      codiceAutoscuola,
      protocolloCertificatoMedico,
      marcaOperativa,
      statoFiltro,
    } = req.body || {};

    const { results } = await searchCandidates({
      cognome,
      numeroPatente,
      codiceFiscale,
      codiceAutoscuola,
      protocolloCertificatoMedico,
      marcaOperativa,
      statoFiltro,
      portalCredentials: null,
    });

    res.json({ success: true, results, count: results.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore ricerca portale" });
  }
}

/**
 * POST /portal/import-massivo
 * Importa candidati selezionati nel DB.
 */
async function importMassivoCtrl(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    const {
      candidates,
      cognome,
      numeroPatente,
      codiceFiscale,
      codiceAutoscuola,
      marcaOperativa,
      statoFiltro,
      autoSelectForBooking,
    } = req.body || {};

    const result = await importMassivo({
      autoscuolaId,
      candidates,
      cognome,
      numeroPatente,
      codiceFiscale,
      codiceAutoscuola,
      marcaOperativa,
      statoFiltro,
      portalCredentials: null,
    });

    let bookingLinked = 0;
    if (autoSelectForBooking && result.imported?.length) {
      for (const row of result.imported) {
        try {
          const { error: wErr } = await supabase.from("waitlist").upsert(
            [{ candidate_id: row.id, status: "pending", priority: 100 }],
            { onConflict: "candidate_id" }
          );
          if (!wErr) bookingLinked++;
        } catch (_) {}
      }
    }

    res.json({
      success: true,
      imported: result.imported?.length || 0,
      parsed: result.parsed || 0,
      errors: result.errors || [],
      bookingLinked,
      importRows: result.imported || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore import massivo" });
  }
}

/**
 * POST /portal/import-archivio
 * Scarica TUTTI i candidati dell'autoscuola dal portale.
 * Equivalente GeCA: creaarchivio / sistArchivi.
 */
async function importArchivio(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    const { codiceAutoscuola, statoFiltro } = req.body || {};

    if (!codiceAutoscuola) {
      return res.status(400).json({ success: false, error: "codiceAutoscuola obbligatorio" });
    }

    const result = await importMassivo({
      autoscuolaId,
      codiceAutoscuola,
      statoFiltro: statoFiltro || "tutti",
      candidates: null,
      portalCredentials: null,
    });

    let bookingLinked = 0;
    for (const row of result.imported || []) {
      try {
        const { error: wErr } = await supabase.from("waitlist").upsert(
          [{ candidate_id: row.id, status: "pending", priority: 100 }],
          { onConflict: "candidate_id" }
        );
        if (!wErr) bookingLinked++;
      } catch (_) {}
    }

    res.json({
      success: true,
      imported: result.imported?.length || 0,
      parsed: result.parsed || 0,
      errors: result.errors || [],
      bookingLinked,
      importRows: result.imported || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore import archivio" });
  }
}

/**
 * POST /portal/import-candidates
 * Importa candidati dalla sessione quiz attiva.
 */
async function importCandidates(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);

    const result = await importMassivo({
      autoscuolaId,
      candidates: null,
      portalCredentials: null,
    });

    res.json({
      success: true,
      imported: result.imported?.length || 0,
      parsed: result.parsed || 0,
      errors: result.errors || [],
      importRows: result.imported || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore import candidati sessione" });
  }
}

// =============================================================================
// NUOVE FUNZIONI — RichiestaPatenti (replica GeCA)
// =============================================================================

async function cercaCandidatoPatente(req, res) {
  try {
    const { cognome, numero_patente } = req.body || {};
    if (!cognome || !numero_patente) {
      return res.status(400).json({ error: "cognome e numero_patente obbligatori" });
    }
    const trace = [];
    const client = await getClient();
    const result = await cercaCandidatoPerPatente(
      client, { cognome, numeroPatente: numero_patente }, trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore ricerca candidato per patente" });
  }
}

async function cercaCandidatoMedico(req, res) {
  try {
    const { protocollo_medico } = req.body || {};
    if (!protocollo_medico) {
      return res.status(400).json({ error: "protocollo_medico obbligatorio" });
    }
    const trace = [];
    const client = await getClient();
    const result = await cercaCandidatoPerProtocolloMedico(
      client, { protocolloMedico: protocollo_medico }, trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore ricerca candidato per protocollo medico" });
  }
}

async function cercaPerMarca(req, res) {
  try {
    const { marca_operativa } = req.body || {};
    if (!marca_operativa) {
      return res.status(400).json({ error: "marca_operativa obbligatoria" });
    }
    const trace = [];
    const client = await getClient();
    const result = await cercaRichiestaPerMarca(
      client, { marcaOperativa: marca_operativa }, trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore ricerca per marca operativa" });
  }
}

async function cercaRichiesteEsameCtrl(req, res) {
  try {
    const { id_aut_ag, cod_ufficio_mctc, marca_operativa } = req.body || {};
    if (!id_aut_ag) {
      return res.status(400).json({ error: "id_aut_ag obbligatorio" });
    }
    const trace = [];
    const client = await getClient();
    const result = await cercaRichiesteEsame(
      client,
      { idAutAg: id_aut_ag, codUfficioMctc: cod_ufficio_mctc || "", marcaOperativa: marca_operativa || "" },
      trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore ricerca richieste esame" });
  }
}

async function nuovaIscrizioneEsameCtrl(req, res) {
  try {
    const { id_aut_ag, cod_ufficio_mctc, campi } = req.body || {};
    if (!id_aut_ag || !campi) {
      return res.status(400).json({ error: "id_aut_ag e campi obbligatori" });
    }
    const trace = [];
    const client = await getClient();
    const result = await nuovaIscrizioneEsame(
      client,
      { idAutAg: id_aut_ag, codUfficioMctc: cod_ufficio_mctc || "", campi },
      trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore nuova iscrizione esame" });
  }
}

async function foglioRosaCtrl(req, res) {
  try {
    const { token, ristampa } = req.body || {};
    const trace = [];
    const client = await getClient();
    const result = await foglioRosa(
      client, { token: token || "", ristampa: ristampa === true }, trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore foglio rosa" });
  }
}

async function rinnovoPatenteCrl(req, res) {
  try {
    const { numero_patente, codice_motivo } = req.body || {};
    if (!numero_patente) {
      return res.status(400).json({ error: "numero_patente obbligatorio" });
    }
    const trace = [];
    const client = await getClient();
    const result = await rinnovoPatente(
      client,
      { numeroPatente: numero_patente, codiceMotivo: codice_motivo || "R" },
      trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore rinnovo patente" });
  }
}

async function cercaCQC(req, res) {
  try {
    const { codice_fiscale, patente_italiana } = req.body || {};
    if (!codice_fiscale) {
      return res.status(400).json({ error: "codice_fiscale obbligatorio" });
    }
    const trace = [];
    const client = await getClient();
    const result = await cercaCQCPerCodFisc(
      client,
      { codiceFiscale: codice_fiscale, patenteItaliana: patente_italiana || "" },
      trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore ricerca CQC" });
  }
}

async function cambioCodiceCtrl(req, res) {
  try {
    const { marca_operativa, nuovo_codice_autoscuola } = req.body || {};
    if (!marca_operativa || !nuovo_codice_autoscuola) {
      return res.status(400).json({ error: "marca_operativa e nuovo_codice_autoscuola obbligatori" });
    }
    const trace = [];
    const client = await getClient();
    const result = await cambioCodiceAutoscuola(
      client,
      { marcaOperativa: marca_operativa, nuovoCodiceAutoscuola: nuovo_codice_autoscuola },
      trace
    );
    res.json({ ...result, trace });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore cambio codice autoscuola" });
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // originali
  puntiPatente,
  login,
  validatePin,
  // import pagina /import
  searchResults,
  importMassivo: importMassivoCtrl,
  importArchivio,
  importCandidates,
  // RichiestaPatenti
  cercaCandidatoPatente,
  cercaCandidatoMedico,
  cercaPerMarca,
  cercaRichiesteEsame: cercaRichiesteEsameCtrl,
  nuovaIscrizioneEsame: nuovaIscrizioneEsameCtrl,
  foglioRosa: foglioRosaCtrl,
  rinnovoPatente: rinnovoPatenteCrl,
  cercaCQC,
  cambioCodiceAutoscuola: cambioCodiceCtrl,
};
