/**
 * Controller REST per sync portale → Supabase.
 * Risolve credenziali portale da autoscuole, effettua login, delega a SyncService.
 */

const supabase = require("../database/supabase");
const { createClient, loginPortale, autentiPin } = require("../connector/portalConnector");
const { PortalService, PORTAL_BASE } = require("../services/portalService");
const { syncService } = require("../services/syncService");
const { syncArchivioCompleto, syncFotoFirmaCandidato } = require("../connector/syncArchivioCompleto");
const { syncArchivioStoricoCompleto } = require("../connector/syncArchivioStorico");
const {
  triggerManual: triggerArchivioScheduler,
  isArchivioSchedulerRunning,
} = require("../services/archivioScheduler");

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

/**
 * POST /api/sync/archivio-storico-completo
 * Scarica TUTTO lo storico dal Portale:
 *   - candidati da verbali esami (4 combinazioni)
 *   - rinnovi patente (tutti gli stati, tutti gli anni)
 *   - rinnovi medici (TT2112)
 *   - rinnovi/conseguimento CQC
 *
 * Body opzionale: {
 *   idAutAg, codUfficioMctc,           // override env vars
 *   includeEsami, includeRinnoviPat,   // flag categorie (default tutti true)
 *   includeRinnoviMed, includeRinnoviCqc,
 *   dataInizio, dataFine,              // YYYY-MM-DD (default 2000-01-01 → oggi)
 *   windowDays,                        // finestra iterazione (default 180)
 *   tipoSync,                          // 'full' | 'incrementale' | 'manuale'
 * }
 *
 * Risposta SSE o JSON come syncArchivioCompletoHandler.
 */
async function syncArchivioStoricoCompletoHandler(req, res) {
  const useSSE = req.headers.accept && req.headers.accept.includes("text/event-stream");

  const {
    idAutAg            = process.env.CODICE_AUTOSCUOLA || "",
    codUfficioMctc     = process.env.PORTAL_UFFICIO_MCTC || "",
    includeEsami       = true,
    includeRinnoviPat  = true,
    includeRinnoviMed  = true,
    includeRinnoviCqc  = true,
    includeStrategiaA,              // se omesso usa default dal modulo (env ARCHIVIO_STRATEGIA_A)
    strategiaAMaxPersone,           // limite persone (0/omesso = nessun limite)
    strategiaADelayMs,              // pausa tra le chiamate portale in ms
    dataInizio,
    dataFine,
    windowDays,
    tipoSync           = "full",
    triggerSource      = "manuale",
  } = req.body || {};

  // Risolvi autoscuolaId dal DB
  let autoscuolaId = req.autoscuolaId || null;
  if (!autoscuolaId && idAutAg) {
    const { data: aut } = await supabase
      .from("autoscuole")
      .select("id")
      .eq("codice_meccanografico", idAutAg)
      .maybeSingle();
    autoscuolaId = aut?.id || null;
  }

  const runOpts = {
    idAutAg,
    codUfficioMctc,
    autoscuolaId,
    includeEsami,
    includeRinnoviPat,
    includeRinnoviMed,
    includeRinnoviCqc,
    dataInizio,
    dataFine,
    windowDays,
    tipoSync,
    triggerSource,
  };
  // Passa gli override Strategia A solo se esplicitamente forniti dal client
  if (includeStrategiaA !== undefined) runOpts.includeStrategiaA = !!includeStrategiaA;
  if (strategiaAMaxPersone !== undefined) runOpts.strategiaAMaxPersone = Number(strategiaAMaxPersone) || 0;
  if (strategiaADelayMs !== undefined) runOpts.strategiaADelayMs = Number(strategiaADelayMs) || 400;

  if (useSSE) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    };

    sendEvent({ event: "start", message: "Avvio sync archivio storico completo..." });

    try {
      const result = await syncArchivioStoricoCompleto({
        ...runOpts,
        onProgress: (p) => sendEvent({ event: "progress", ...p }),
      });
      sendEvent({ event: "done", ...result });
    } catch (err) {
      sendEvent({ event: "error", message: err.message });
    }
    res.end();
  } else {
    try {
      const result = await syncArchivioStoricoCompleto(runOpts);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

/**
 * GET /api/sync/archivio-log
 * Ritorna gli ultimi N run del sync archivio (per dashboard).
 */
async function getArchivioSyncLogHandler(req, res) {
  try {
    const limit = Math.min(parseInt(req.query?.limit || "20", 10) || 20, 100);
    let q = supabase
      .from("archivio_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (req.autoscuolaId) q = q.eq("autoscuola_id", req.autoscuolaId);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, runs: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/sync/archivio-riepilogo
 * Ritorna il riepilogo (dashboard) dell'archivio: conteggi per tipo/stato.
 */
async function getArchivioRiepilogoHandler(req, res) {
  try {
    // NOTA: non usiamo `.select(...).eq("autoscuola_id", ...)` per caricare TUTTE
    // le righe perché Supabase tronca a 1000 righe di default, falsando i conteggi
    // per_tipo (es. mostrava patente=1000 invece di 2890). Usiamo invece una query
    // HEAD+count per ogni metrica.

    const filterAut = (q) =>
      req.autoscuolaId ? q.eq("autoscuola_id", req.autoscuolaId) : q;

    // 1) rinnovi totali (count)
    const { count: rinnoviCount } = await filterAut(
      supabase.from("rinnovi_portale").select("id", { count: "exact", head: true })
    );

    // 2) count per tipo_rinnovo (una query per tipo, tutte head+count)
    const tipi = ["patente", "medico", "cqc"];
    const perTipo = {};
    await Promise.all(
      tipi.map(async (t) => {
        const { count } = await filterAut(
          supabase
            .from("rinnovi_portale")
            .select("id", { count: "exact", head: true })
            .eq("tipo_rinnovo", t)
        );
        perTipo[t] = count || 0;
      })
    );

    // 3) primo e ultimo data_inserimento: ordine + limit 1
    const { data: primoRow } = await filterAut(
      supabase
        .from("rinnovi_portale")
        .select("data_inserimento")
        .not("data_inserimento", "is", null)
        .order("data_inserimento", { ascending: true })
        .limit(1)
    );
    const { data: ultimoRow } = await filterAut(
      supabase
        .from("rinnovi_portale")
        .select("data_inserimento")
        .not("data_inserimento", "is", null)
        .order("data_inserimento", { ascending: false })
        .limit(1)
    );
    const primoInserimento  = primoRow?.[0]?.data_inserimento  || null;
    const ultimoInserimento = ultimoRow?.[0]?.data_inserimento || null;

    // 4) ultimo_sync: max(last_synced_at)
    const { data: syncRow } = await filterAut(
      supabase
        .from("rinnovi_portale")
        .select("last_synced_at")
        .not("last_synced_at", "is", null)
        .order("last_synced_at", { ascending: false })
        .limit(1)
    );
    const ultimoSync = syncRow?.[0]?.last_synced_at || null;

    // 5) conteggio candidati
    const { count: candidatiCount } = await filterAut(
      supabase.from("candidates").select("id", { count: "exact", head: true })
    );

    res.json({
      success: true,
      riepilogo: {
        candidati_totali: candidatiCount || 0,
        rinnovi_totali: rinnoviCount || 0,
        rinnovi_per_tipo: perTipo,
        primo_inserimento: primoInserimento,
        ultimo_inserimento: ultimoInserimento,
        ultimo_sync: ultimoSync,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/sync/archivio-scheduler/trigger
 * Trigger manuale dello scheduler archivio (tipo: incremental|daily|weekly)
 * Body: { type }
 */
async function archivioSchedulerTriggerHandler(req, res) {
  try {
    const type = String(req.body?.type || "incremental").toLowerCase();
    if (!["incremental", "daily", "weekly"].includes(type)) {
      return res.status(400).json({ success: false, error: "type non valido" });
    }
    // Fire-and-forget: il sync può essere lungo, non blocchiamo la risposta
    triggerArchivioScheduler(type).catch((err) =>
      console.error("[archivioScheduler] trigger manuale errore:", err.message)
    );
    res.json({ success: true, started: true, type });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/sync/archivio-scheduler/status
 */
async function archivioSchedulerStatusHandler(req, res) {
  try {
    res.json({
      success: true,
      enabled: String(process.env.ARCHIVIO_SCHEDULER_ENABLED || "false").toLowerCase() === "true",
      running: !!isArchivioSchedulerRunning(),
      config: {
        incremental_min: Number(process.env.ARCHIVIO_SYNC_INCREMENTAL_MIN || 5),
        daily_hour:      Number(process.env.ARCHIVIO_SYNC_DAILY_HOUR || 3),
        weekly_hour:     Number(process.env.ARCHIVIO_SYNC_WEEKLY_HOUR || 2),
        window_days:     Number(process.env.ARCHIVIO_SYNC_WINDOW_DAYS || 180),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  syncPratiche,
  syncCandidati,
  syncCompleto,
  syncArchivioCompletoHandler,
  syncArchivioStoricoCompletoHandler, // FASE E — nuovo endpoint storico
  syncFotoFirmaHandler,
  getArchivioSyncLogHandler,          // FASE E — log run
  getArchivioRiepilogoHandler,        // FASE E — dashboard
  archivioSchedulerTriggerHandler,    // FASE G — trigger manuale scheduler
  archivioSchedulerStatusHandler,     // FASE G — status scheduler
};
