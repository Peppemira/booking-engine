/**
 * Controller REST per sync portale → Supabase.
 * Risolve credenziali portale da autoscuole, effettua login, delega a SyncService.
 */

const supabase = require("../database/supabase");
const { createClient, loginPortale, autentiPin } = require("../connector/portalConnector");
const { PortalService, PORTAL_BASE } = require("../services/portalService");
const { syncService } = require("../services/syncService");
const { syncArchivioCompleto, syncFotoFirmaCandidato } = require("../connector/syncArchivioCompleto");

async function getPortalClientAndLogin(req) {
  let username = process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  let password = process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  let pin = process.env.PORTAL_PIN || null;

  if (req?.autoscuolaId) {
    const { data, error } = await supabase
      .from("autoscuole")
      .select("portal_user,portal_pass,portal_pin")
      .eq("id", req.autoscuolaId)
      .maybeSingle();
    if (!error && data?.portal_user && data?.portal_pass) {
      username = data.portal_user;
      password = data.portal_pass;
      pin = data.portal_pin || pin;
    }
  }

  if (!username || !password) {
    throw new Error("Credenziali portale mancanti. Impostare portal_user/portal_pass in autoscuole o PORTAL_USER/PORTAL_PASS.");
  }

  const client = createClient();
  await loginPortale(client, username, password);
  if (pin) {
    await autentiPin(client, pin, `${PORTAL_BASE}/RichiestaPatenti/richiesta/Read_initAction.action`);
  }
  const portal = new PortalService();
  portal.setClient(client);
  return portal;
}

/**
 * GET/POST /api/sync/pratiche - recupera pratiche dal portale (e opzionalmente salva solo pratiche).
 * Body/query: { query } per getPratichePatente (marcaOperativa, action, ...).
 */
async function syncPratiche(req, res) {
  try {
    const portal = await getPortalClientAndLogin(req);
    const query = req.body?.query || req.query || {};
    const result = await syncService.syncPraticheOnly(portal, query);
    res.json({
      success: true,
      pratiche: result.pratiche,
      candidati: result.candidati,
      count: { pratiche: result.pratiche.length, candidati: result.candidati.length },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore sync pratiche" });
  }
}

/**
 * POST /api/sync/candidati - recupera pratiche dal portale, estrae candidati, salva/aggiorna su Supabase.
 */
async function syncCandidati(req, res) {
  try {
    const portal = await getPortalClientAndLogin(req);
    const query = req.body?.query || req.query || {};
    const result = await syncService.syncCandidatiOnly(portal, req, query);
    res.json({
      success: true,
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore sync candidati" });
  }
}

/**
 * POST /api/sync/completo - sync completo: pratiche → candidati → salva candidati → salva pratiche → collega.
 */
async function syncCompleto(req, res) {
  try {
    const portal = await getPortalClientAndLogin(req);
    const query = req.body?.query || req.query || {};
    const result = await syncService.syncCompleto(portal, req, query);
    res.json({
      success: true,
      pratiche: result.pratiche,
      candidati: result.candidati,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore sync completo" });
  }
}

/**
 * POST /api/sync/archivio-completo
 * Replica completa del sync iPatente: tutti i candidati inclusi storici,
 * con scheda individuale, foto e firma.
 *
 * Body opzionale: {
 *   idAutAg, codUfficioMctc,  // override env vars
 *   fetchDettaglio: true|false  // default true — recupera scheda individuale
 * }
 *
 * Risposta SSE (text/event-stream) se header Accept: text/event-stream,
 * altrimenti JSON al termine.
 */
async function syncArchivioCompletoHandler(req, res) {
  const useSSE = req.headers.accept && req.headers.accept.includes("text/event-stream");

  const {
    idAutAg        = process.env.CODICE_AUTOSCUOLA || process.env.ARCHIVIO_CODICE_AUTOSCUOLA || "",
    codUfficioMctc = process.env.PORTAL_UFFICIO_MCTC || "",
    fetchDettaglio = true,
  } = req.body || {};

  // Risolvi autoscuolaId dal DB (se presente)
  let autoscuolaId = null;
  if (idAutAg) {
    const { data: aut } = await supabase
      .from("autoscuole")
      .select("id")
      .eq("codice_meccanografico", idAutAg)
      .maybeSingle();
    autoscuolaId = aut?.id || null;
  }

  if (useSSE) {
    // Streaming SSE — invia aggiornamenti progressivi
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    };

    sendEvent({ event: "start", message: "Avvio sync archivio completo..." });

    try {
      const result = await syncArchivioCompleto({
        idAutAg,
        codUfficioMctc,
        autoscuolaId,
        fetchDettaglio,
        onProgress: ({ fase, completati, totale, errori }) => {
          sendEvent({ event: "progress", fase, completati, totale, errori });
        },
      });
      sendEvent({ event: "done", ...result });
    } catch (err) {
      sendEvent({ event: "error", message: err.message });
    }

    res.end();
  } else {
    // JSON classico
    try {
      const result = await syncArchivioCompleto({
        idAutAg,
        codUfficioMctc,
        autoscuolaId,
        fetchDettaglio,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

/**
 * POST /api/sync/foto-firma
 * Recupera foto e firma dal portale per un singolo candidato.
 * Body: { marcaOperativa, candidateId }
 */
async function syncFotoFirmaHandler(req, res) {
  const { marcaOperativa, candidateId } = req.body || {};
  if (!marcaOperativa) {
    return res.status(400).json({ success: false, error: "marcaOperativa obbligatoria" });
  }
  try {
    const result = await syncFotoFirmaCandidato({
      marcaOperativa,
      candidateId,
      idAutAg:        process.env.CODICE_AUTOSCUOLA || "",
      codUfficioMctc: process.env.PORTAL_UFFICIO_MCTC || "",
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  syncPratiche,
  syncCandidati,
  syncCompleto,
  syncArchivioCompletoHandler,
  syncFotoFirmaHandler,
};
