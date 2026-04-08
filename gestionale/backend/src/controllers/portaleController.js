/**
 * Controller REST per portale (GeCA modConnPort, connessioneportalenew, Portale).
 */

const { getPuntiPatente } = require("../connector/puntiPatente");
const { PortalService } = require("../services");
const {
  loginAndGetJar,
  getOrLoginJar,
  getOrLoginJarFast,
  invalidatePortalSession,
  readSessioniQuizInterneViaBrowser,
  readPortalSearchViaBrowser,
  readSituazioneCandidatiListViaBrowser,
  readSessioneDettaglioViaBrowser,
} = require("../connector/portalSession");
const {
  makeHttpClient,
  loadMenu,
  warmPrenotazioneContext,
  readSessioniQuizInterne,
  serializePayloadRaw,
  getSessionPageDiagnostics,
  readSituazioneCandidati,
  readVerbali,
  readSessioniApprovate,
  readSessioniCqc,
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
  importByPatente,
  importCandidate,
} = require("../connector/importByPatente");
const {
  prenotaSessione,
  cercaCandidatoInDettaglio,
  confermaNuovoCandidato,
  modificaCandidatoPrenotazione,
  eliminaCandidatoPrenotazione,
  sostituisciCandidatoPrenotazione,
  prenotazioneDirectUrl,
} = require("../connector/booking");
const { parsePortalCandidates } = require("../parser/candidateParser");
const { parseSessioni, parseSessioniReadOnly } = require("../parser/sessionParser");
const { addImportHistory } = require("../server/importHistory");
const { resolvePortalCredentials, addCandidatesToBookingList } = require("../server/portalHelpers");
const supabase = require("../database/supabase");

// =============================================================================
// Helper: ottieni client HTTP con sessione attiva
// =============================================================================
async function getClient() {
  // Usa il login diretto HTTP (< 300ms) con fallback Puppeteer automatico
  const jar = await getOrLoginJarFast({
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
  const trace = [];
  try {
    const {
      cognome,
      numeroPatente,
      codiceFiscale,
      codiceAutoscuola,
      protocolloCertificatoMedico,
      marcaOperativa,
      statoFiltro,
      // Filtri per Situazione Candidati (dal frontend PanelloSituazioneCandidati)
      tipoConseguimento,
      tipoProva,
      statoCandidati,
    } = req.body || {};

    const creds = await resolvePortalCredentials(req);
    const skipHttp = String(process.env.PORTAL_BROWSER_PERSISTENT || "").toLowerCase() === "true";

    let results = [];
    let httpError = null;

    // Tentativo HTTP (saltato se browser persistent è attivo)
    if (!skipHttp) {
      try {
        const { results: httpResults } = await searchCandidates({
          cognome,
          numeroPatente,
          codiceFiscale,
          codiceAutoscuola: codiceAutoscuola || process.env.CODICE_AUTOSCUOLA || "",
          protocolloCertificatoMedico,
          marcaOperativa,
          statoFiltro,
          portalCredentials: creds.username ? creds : null,
        });
        results = httpResults;
      } catch (err) {
        httpError = err;
        trace.push({ at: new Date().toISOString(), step: "searchResults.http.error", message: String(err?.message || "").slice(0, 300) });
      }
    } else {
      httpError = new Error("skipped");
    }

    // Browser fallback: usa readSituazioneCandidatiListViaBrowser
    if (httpError || !results.length) {
      try {
        trace.push({ at: new Date().toISOString(), step: "searchResults.browser.start" });
        const browserHtml = await readSituazioneCandidatiListViaBrowser({
          ...creds,
          tipoConseguimento: tipoConseguimento || "P",
          tipoProva: tipoProva || "",
          statoCandidati: statoCandidati || "",
          trace,
        });

        // Parse HTML per estrarre intestazioni e righe dalla tabella
        const cheerio = require("cheerio");
        const $ = cheerio.load(browserHtml || "");

        // Cerca la tabella dei risultati — priorità agli ID specifici del portale
        let dataTable = $("#elencoSituazioneCandidati").first();
        if (!dataTable.length) dataTable = $("#listTable").first();
        if (!dataTable.length) {
          // Fallback: tabella con più righe nel tbody tra quelle con >= 3 headers
          let bestCount = 0;
          $("table").each((_, tbl) => {
            const headers = $(tbl).find("thead th, thead td, tr:first-child th");
            const bodyRows = $(tbl).find("tbody tr");
            if (headers.length >= 3 && bodyRows.length > bestCount) {
              bestCount = bodyRows.length;
              dataTable = $(tbl);
            }
          });
        }

        const intestazioni = [];
        const righe = [];

        if (dataTable.length) {
          // Leggi intestazioni
          dataTable.find("thead tr th, thead tr td").each((_, th) => {
            intestazioni.push($(th).text().replace(/\s+/g, " ").trim());
          });
          // Se non ci sono intestazioni nel thead, prova la prima riga con th
          if (!intestazioni.length) {
            dataTable.find("tr:first-child th").each((_, th) => {
              intestazioni.push($(th).text().replace(/\s+/g, " ").trim());
            });
          }

          // Leggi righe
          dataTable.find("tbody tr").each((_, tr) => {
            const celle = [];
            $(tr).find("td").each((_, td) => celle.push($(td).text().replace(/\s+/g, " ").trim()));
            if (celle.length > 2) righe.push(celle);
          });
        }

        const message = !righe.length
          ? ($(".alert, .errors, .errore, #messaggioRicerca").first().text().trim() || "Nessun candidato trovato")
          : "";

        trace.push({ at: new Date().toISOString(), step: "searchResults.browser.done", count: righe.length, ints: intestazioni.length });

        // Se il browser ha trovato righe, restituiamo nel formato tabella generico
        // (intestazioni + righe) — compatibile con TabellaPortale del frontend
        return res.json({
          success: true,
          ok: true,
          intestazioni,
          righe,
          results: righe.map(row => {
            // Mappa le colonne a un oggetto per retrocompatibilità
            const obj = {};
            intestazioni.forEach((h, i) => { obj[h] = row[i] || ""; });
            // Normalizza i campi più comuni
            const pickCol = (...keys) => {
              for (const k of keys) {
                const found = Object.entries(obj).find(([h]) => h.toLowerCase().includes(k.toLowerCase()));
                if (found && found[1]) return found[1];
              }
              return "";
            };
            return {
              cognome: pickCol("cognome"),
              nome: pickCol("nome"),
              codiceFiscale: pickCol("codice fiscale", "cod. fisc", "cf"),
              numeroPatente: pickCol("patente", "numero patente"),
              categoria: pickCol("abilitazione", "categoria", "tipo iscrizione"),
              stato: pickCol("stato"),
              dataIscrizione: pickCol("data iscrizione", "data domanda", "data emissione", "data statino"),
            };
          }),
          count: righe.length,
          message,
          trace,
        });
      } catch (browserErr) {
        trace.push({ at: new Date().toISOString(), step: "searchResults.browser.error", message: String(browserErr?.message || "").slice(0, 300) });
      }
    }

    res.json({ success: true, results, count: results.length, trace });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore ricerca portale", trace });
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
// NUOVE FUNZIONI — spostate da server.js inline routes
// =============================================================================

/**
 * POST /portal/sessioni-preview
 * Legge le sedute dal portale (modalità read-only + filtri).
 */
async function sessioniPreview(req, res) {
  try {
    const startedAt = Date.now();
    const viewOnly = req.body?.viewOnly !== false;
    const browserOnly = req.body?.browserOnly === true || process.env.PORTAL_SESSIONI_BROWSER_ONLY === "true";
    const includeCandidates = req.body?.includeCandidates === true;
    const traceEnabled = req.body?.trace === true || true; // sempre attivo per debug
    const portalTrace = traceEnabled ? [] : null;
    // Accept both nested { filters: {...} } and flat { dataDa, dataA, stato } formats
    const rawFilters = (req.body?.filters && typeof req.body.filters === "object")
      ? req.body.filters
      : {
        dataDa:    String(req.body?.dataDa    || "").trim(),
        dataA:     String(req.body?.dataA     || "").trim(),
        stato:     String(req.body?.stato     || "").trim(),
        tipoEsame: String(req.body?.tipoEsame || "").trim(),
        orario:    String(req.body?.orario    || "").trim(),
      };
    const requestedPortalState = String(rawFilters?.stato || "").trim().toUpperCase();

    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({
        success: false,
        error: "Credenziali portale mancanti (portal_user/portal_pass)",
      });
    }

    let html = "";
    let parsedReadOnly = [];
    let pageDiagnostics = {};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isTransientPortalError = (error) => {
      const message = String(error?.message || "").toLowerCase();
      const status = Number(error?.response?.status || 0);
      if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
      return (
        message.includes("econnreset") ||
        message.includes("socket hang up") ||
        message.includes("etimedout") ||
        message.includes("timeout") ||
        message.includes("network error")
      );
    };

    // Quando PORTAL_BROWSER_PERSISTENT è attivo, saltiamo il tentativo HTTP
    // perché il POST HTTP fallisce sempre (Struts2 DMI filter → 404) ed è lento.
    // Andiamo direttamente al browser fallback che è più veloce con sessione persistente.
    const skipHttpAttempt = String(process.env.PORTAL_BROWSER_PERSISTENT || "").toLowerCase() === "true";

    if (browserOnly) {
      if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.browser-only.start" });

      html = await readSessioniQuizInterneViaBrowser({ ...creds, trace: portalTrace, searchFilters: { stato: requestedPortalState, dataDa: rawFilters.dataDa || "", dataA: rawFilters.dataA || "" } });
      parsedReadOnly = parseSessioniReadOnly(html);
      pageDiagnostics = getSessionPageDiagnostics(html);

      if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.browser-only.done", total: parsedReadOnly.length, diagnostics: pageDiagnostics });
    } else if (!skipHttpAttempt) {
      let httpLastError = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const jar = await getOrLoginJarFast(creds);
          const client = makeHttpClient(jar);
          try { await loadMenu(client); } catch (_menuError) {}

          html = await readSessioniQuizInterne(client, {
            trace: portalTrace,
            pin: creds.pin || process.env.PORTAL_PIN || null,
            searchFilters: {
              stato:     requestedPortalState,
              dataDa:    rawFilters.dataDa    || "",
              dataA:     rawFilters.dataA     || "",
              tipoEsame: rawFilters.tipoEsame || "",
            },
          });
          parsedReadOnly = parseSessioniReadOnly(html);
          pageDiagnostics = getSessionPageDiagnostics(html);
          httpLastError = null;
          break;
        } catch (httpError) {
          httpLastError = httpError;
          if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.http.error", attempt, message: String(httpError?.message || "").slice(0, 500), status: httpError?.response?.status || null });
          if (!isTransientPortalError(httpError) || attempt >= 2) break;
          await sleep(700 * attempt);
        }
      }

      if (httpLastError && !html) {
        invalidatePortalSession(creds);
        if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.http.failed", message: String(httpLastError?.message || "").slice(0, 500) });
      }
    } else {
      if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.http.skipped", reason: "PORTAL_BROWSER_PERSISTENT=true" });
    }

    // Browser fallback attivo per default: il POST HTTP con action:Read_paging
    // restituisce 404 a causa del filtro di sicurezza Struts2 del portale.
    // Solo il click nativo del browser sul bottone di submit funziona correttamente.
    const enableBrowserFallback = String(process.env.PORTAL_SESSION_BROWSER_FALLBACK || "true").toLowerCase() !== "false";
    if (enableBrowserFallback && !browserOnly && (!parsedReadOnly.length || !html || pageDiagnostics.hasSearchForm)) {
      // Determina il tipo di tab in base al tipoEsame e allo stato richiesto
      // Le sessioni APPROVATE sono su una pagina diversa del portale (SQA)
      const tipoEsameUpper = String(rawFilters?.tipoEsame || "").toUpperCase();
      let browserTabType = tipoEsameUpper === "SGOS" ? "SGOS" : "SQI";
      if (requestedPortalState === "APPROVATA") browserTabType = "SQA";
      try {
        if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.fallback.browser.start", tabType: browserTabType });
        const browserHtml = await readPortalSearchViaBrowser(browserTabType, {
          ...creds,
          trace: portalTrace,
          stato: requestedPortalState,
          dateFrom: rawFilters.dataDa || "",
          dateTo: rawFilters.dataA || "",
        });
        const browserParsedReadOnly = parseSessioniReadOnly(browserHtml);
        if (browserParsedReadOnly.length) {
          html = browserHtml;
          parsedReadOnly = browserParsedReadOnly;
          pageDiagnostics = getSessionPageDiagnostics(html);
          if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.fallback.browser.success", total: browserParsedReadOnly.length });
        } else {
          // Anche con 0 risultati, usa l'HTML del browser (potrebbe essere genuinamente vuoto)
          html = browserHtml;
          pageDiagnostics = getSessionPageDiagnostics(html);
          if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.fallback.browser.empty" });
        }
      } catch (fallbackError) {
        if (Array.isArray(portalTrace)) portalTrace.push({ at: new Date().toISOString(), step: "session.fallback.browser.error", message: String(fallbackError?.message || "").slice(0, 500) });
      }
    }

    const normalizedFilters = {
      dataDa: String(rawFilters?.dataDa || "").trim(),
      dataA: String(rawFilters?.dataA || "").trim(),
      orario: String(rawFilters?.orario || "").trim().toUpperCase(),
      tipoEsame: String(rawFilters?.tipoEsame || "").trim(),
      aula: String(rawFilters?.aula || "").trim(),
      codLocalita: String(rawFilters?.codLocalita || "").trim(),
      propriPrenotati: rawFilters?.propriPrenotati === true,
      nascondiNonPrenotabili: rawFilters?.nascondiNonPrenotabili === true,
      stato: String(rawFilters?.stato || "").trim().toUpperCase(),
    };

    const parseDateOnly = (value) => {
      const text = String(value || "").trim();
      if (!text) return null;
      const it = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (it) {
        const date = new Date(Number(it[3]), Number(it[2]) - 1, Number(it[1]));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      const iso = new Date(text);
      if (Number.isNaN(iso.getTime())) return null;
      return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
    };

    const parseFlexibleInt = (value) => {
      const parsed = Number.parseInt(String(value || "").replace(/[^0-9-]/g, ""), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const dataDa = parseDateOnly(normalizedFilters.dataDa);
    const dataA = parseDateOnly(normalizedFilters.dataA);
    if (dataDa && dataA) {
      if (dataDa.getTime() > dataA.getTime()) return res.status(400).json({ success: false, error: "La data inizio è successiva alla data fine." });
      const maxEnd = new Date(dataDa.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (dataA.getTime() > maxEnd.getTime()) return res.status(400).json({ success: false, error: "L'intervallo date non può superare 30 giorni." });
    }

    const applySessionFilters = (rows = []) => {
      const normalizedTipo = normalizedFilters.tipoEsame.toLowerCase();
      const normalizedAula = normalizedFilters.aula.toLowerCase();
      const normalizedCodLoc = normalizedFilters.codLocalita.toLowerCase();

      const matchesTipo = (item) => {
        if (!normalizedTipo || normalizedTipo === "tutti") return true;
        // SQI e SGOS sono identificatori di tab portale, non filtri tipo esame:
        // la pagina del portale restituisce già solo sessioni del tipo corretto
        if (normalizedTipo === "sqi" || normalizedTipo === "sgos") return true;
        const tipoValue = `${String(item?.tipoEsame || "")} ${String(item?.tipo || "")}`.toLowerCase();
        if (normalizedTipo === "quiz") return /quiz|\bt\b/.test(tipoValue);
        if (normalizedTipo === "guida") return /guida|\bg\b/.test(tipoValue);
        if (normalizedTipo === "cqc") return /cqc/.test(tipoValue);
        return tipoValue.includes(normalizedTipo);
      };

      return rows.filter((item) => {
        const rowDate = parseDateOnly(item?.data || item?.dataIpotetica);
        if (dataDa && (!rowDate || rowDate.getTime() < dataDa.getTime())) return false;
        if (dataA && (!rowDate || rowDate.getTime() > dataA.getTime())) return false;
        const amPm = String(item?.amPm || item?.orario || "").toUpperCase();
        if (normalizedFilters.orario === "AM" && !/(AM|MATT)/.test(amPm)) return false;
        if (normalizedFilters.orario === "PM" && !/(PM|POM)/.test(amPm)) return false;
        if (!matchesTipo(item)) return false;
        if (normalizedAula && !String(item?.aula || "").toLowerCase().includes(normalizedAula)) return false;
        if (normalizedCodLoc) {
          const localitaValue = `${String(item?.codLocalita || "")} ${String(item?.localita || "")} ${String(item?.autoscuola || "")}`.toLowerCase();
          if (!localitaValue.includes(normalizedCodLoc)) return false;
        }
        if (normalizedFilters.stato) {
          const requested = normalizedFilters.stato;
          const sedutaStato = String(item?.sedutaStato || "").toUpperCase();
          const rawStato = String(item?.stato || "").toUpperCase();
          if (requested === "APPROVATA") { if (!rawStato.includes("APPROVAT")) return false; }
          else if (requested === "APERTA" || requested === "CHIUSA") {
            if (sedutaStato) { if (sedutaStato !== requested) return false; }
            else if (!rawStato.includes(requested)) return false;
          } else { if (!`${sedutaStato} ${rawStato}`.includes(requested)) return false; }
        }
        if (normalizedFilters.propriPrenotati) {
          if (parseFlexibleInt(item?.propriePrenotazioniNum ?? item?.propriePrenotazioni) <= 0) return false;
        }
        if (normalizedFilters.nascondiNonPrenotabili && !item?.canInsertCandidate) return false;
        return true;
      });
    };

    const parseInteger = (value) => {
      const parsed = Number.parseInt(String(value || "").replace(/[^0-9-]/g, ""), 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    if (viewOnly) {
      const sessioni = parsedReadOnly.map((item) => {
        const statoText = String(item.stato || "").toLowerCase();
        const postiLiberiText = String(item.postiLiberi ?? "").trim();
        const explicitlyClosed = /chius|non\s*prenot|scadut|sospes/.test(statoText);
        const explicitlyOpen = /apert|disponib|prenot/.test(statoText);
        const sedutaStato = explicitlyOpen && !explicitlyClosed ? "APERTA" : explicitlyClosed ? "CHIUSA" : "N/D";
        return { ...item, postiLiberi: postiLiberiText, propriePrenotazioni: String(item?.propriePrenotazioni || "").trim() || String(item?.postiOccupati || "").trim() || "", canInsertCandidate: sedutaStato === "APERTA", sedutaStato, postiLiberiNum: parseInteger(postiLiberiText), totalePostiNum: parseInteger(item.totalePosti), postiAutoscuolaNum: parseInteger(item.postiAutoscuola), propriePrenotazioniNum: parseInteger(item.propriePrenotazioni), postiOccupatiNum: parseInteger(item.postiOccupati) };
      });

      const filteredSessioni = applySessionFilters(sessioni);
      return res.json({ success: true, mode: "view-only", searchedAt: new Date().toISOString(), total: filteredSessioni.length, totalBeforeFilter: sessioni.length, withSeats: null, closedTotal: null, approvedTotal: filteredSessioni.filter((item) => /approvat/.test(String(item.stato || "").toLowerCase())).length, candidatesTotal: 0, portalMessage: null, diagnostics: pageDiagnostics, filtersApplied: normalizedFilters, timing: { totalMs: Date.now() - startedAt }, trace: portalTrace || [], sessioni: filteredSessioni, candidati: [] });
    }

    const parsedByForm = parseSessioni(html);
    const sessionKey = (item) => `${String(item?.sessionId || "").trim().toLowerCase()}|${String(item?.dataIpotetica || item?.data || "").replace(/\s+/g, " ").trim().toLowerCase()}|${String(item?.tipoEsame || "").replace(/\s+/g, " ").trim().toLowerCase()}|${String(item?.aula || "").replace(/\s+/g, " ").trim().toLowerCase()}|${String(item?.amPm || "").replace(/\s+/g, " ").trim().toLowerCase()}`;

    const byKey = new Map();
    for (const item of parsedReadOnly) byKey.set(sessionKey(item), item);
    for (const item of parsedByForm) {
      const key = sessionKey(item);
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, item); continue; }
      byKey.set(key, { ...item, ...existing, action: item.action || existing.action, hiddenFields: item.hiddenFields || existing.hiddenFields });
    }

    const sessioniRaw = Array.from(byKey.values());
    const sessioni = sessioniRaw.map((item) => {
      const statoText = String(item.stato || "").toLowerCase();
      const postiLiberiText = String(item.postiLiberi ?? "").trim();
      const postiLiberiNum = parseInteger(postiLiberiText);
      const totalePostiNum = parseInteger(item.totalePosti);
      const postiAutoscuolaNum = parseInteger(item.postiAutoscuola);
      const propriePrenotazioniNum = parseInteger(item.propriePrenotazioni);
      const postiOccupatiNum = parseInteger(item.postiOccupati);
      const explicitlyClosed = /chius|non\s*prenot|scadut|sospes/.test(statoText);
      const explicitlyOpen = /apert|disponib|prenot/.test(statoText);
      let canInsertCandidate = false;
      if (postiAutoscuolaNum !== null && propriePrenotazioniNum !== null) canInsertCandidate = postiAutoscuolaNum > propriePrenotazioniNum;
      else if (postiAutoscuolaNum !== null && postiOccupatiNum !== null) canInsertCandidate = postiAutoscuolaNum > postiOccupatiNum;
      else if (postiLiberiNum !== null) canInsertCandidate = postiLiberiNum > 0;
      else canInsertCandidate = explicitlyOpen;
      if (explicitlyClosed) canInsertCandidate = false;
      const sedutaStato = canInsertCandidate ? "APERTA" : "CHIUSA";
      return { ...item, postiLiberi: postiLiberiText, propriePrenotazioni: String(item?.propriePrenotazioni || "").trim() || String(item?.postiOccupati || "").trim() || "", canInsertCandidate, sedutaStato, postiLiberiNum, totalePostiNum, postiAutoscuolaNum, propriePrenotazioniNum, postiOccupatiNum };
    });

    const filteredSessioni = applySessionFilters(sessioni);
    const withSeats = filteredSessioni.filter((item) => item.canInsertCandidate);
    const closedTotal = filteredSessioni.filter((item) => !item.canInsertCandidate).length;
    const approvedTotal = filteredSessioni.filter((item) => /approvat/.test(String(item.stato || "").toLowerCase())).length;

    let candidati = [];
    if (includeCandidates) {
      try {
        const htmlCandidati = await readSituazioneCandidati();
        candidati = parsePortalCandidates(htmlCandidati);
      } catch (_candidateError) { candidati = []; }
    }

    return res.json({ success: true, mode: "read-only", searchedAt: new Date().toISOString(), total: filteredSessioni.length, totalBeforeFilter: sessioni.length, withSeats: withSeats.length, closedTotal, approvedTotal, candidatesTotal: candidati.length, portalMessage: null, diagnostics: pageDiagnostics, filtersApplied: normalizedFilters, trace: portalTrace || [], sessioni: filteredSessioni, candidati });
  } catch (error) {
    const statusCode = error?.response?.status || 500;
    const errorMessage = statusCode === 503
      ? "Portale ministeriale temporaneamente non disponibile (HTTP 503). Riprova tra pochi minuti o in fascia oraria disponibile."
      : (error?.message || "Errore durante la lettura sedute dal portale");
    console.error("[sessioniPreview] ERRORE:", error?.message || error);
    return res.status(500).json({ success: false, error: errorMessage, portalMessage: errorMessage, trace: [{ at: new Date().toISOString(), step: "session.preview.error", message: String(error?.message || "").slice(0, 1200), status: error?.response?.status || null }] });
  }
}

/**
 * POST /portal/prenotazione-candidato
 * Prenota / cerca / modifica un candidato su una seduta del portale.
 */
async function prenotazioneCandidato(req, res) {
  try {
    const payload = req.body || {};
    const traceEnabled = payload?.trace === true;
    const portalTrace = traceEnabled ? [] : null;
    const sessionIndex = Number.isFinite(Number(payload?.sessionIndex)) ? Number(payload.sessionIndex) : 0;
    const actionType = String(payload?.actionType || "search").trim().toLowerCase();
    const candidate = payload?.candidate && typeof payload.candidate === "object" ? payload.candidate : {};

    const selectedSessionIndex = Math.max(0, Math.min(sessionIndex, 99));

    // ── STORIA: gestione separata via browser (non dipende dal flusso HTTP) ──
    if (actionType === "history") {
      // Storia candidato: usa il browser per navigare alla pagina storia del portale
      // L'approccio HTTP non funziona con PORTAL_BROWSER_PERSISTENT=true
      try {
        const { readStoriaViaBrowser } = require("../connector/portalSession");
        const creds = await resolvePortalCredentials(req);
        console.log("[Storia] Avvio browser per storia candidato:", candidate.cognome, candidate.marcaOperativa);

        const result = await readStoriaViaBrowser({
          username: creds.username,
          password: creds.password,
          pin: creds.pin,
          sessionIndex: selectedSessionIndex,
          marcaOperativa: candidate.marcaOperativa || "",
          cognome: candidate.cognome || "",
          candidateIndex: candidate.index >= 0 ? candidate.index : -1,
          trace: portalTrace || [],
        });

        console.log("[Storia] Risultato browser:", JSON.stringify({
          success: result?.success,
          campiCount: Object.keys(result?.storia?.campi || {}).length,
          verbaliCount: (result?.storia?.verbali || []).length,
        }));

        if (result?.success && result?.storia) {
          return res.json({
            success: true,
            actionType: "history",
            storia: result.storia,
            _debug: result._debug,
            source: "browser",
          });
        }
        return res.json({ success: true, actionType: "history", storia: { campi: {}, verbali: [] }, _debug: result?._debug, source: "browser-empty" });
      } catch (storiaErr) {
        console.warn("[prenotazioneCandidato] Storia error:", storiaErr.message);
        return res.json({ success: true, actionType: "history", storia: { campi: {}, verbali: [] }, error: storiaErr.message });
      }
    }

    // ── Altre azioni (search, new, edit, delete, replace): usano flusso HTTP ──
    const creds = await resolvePortalCredentials(req);
    const jar = await getOrLoginJarFast(creds);
    const client = makeHttpClient(jar);

    const searchHtml = await readSessioniQuizInterne(client, { trace: portalTrace });
    const sessioni = parseSessioni(searchHtml);
    if (!Array.isArray(sessioni) || !sessioni.length) {
      return res.status(404).json({ success: false, error: "Nessuna seduta disponibile trovata sul portale", trace: portalTrace || [] });
    }

    const selectedSession = sessioni[Math.max(0, Math.min(selectedSessionIndex, sessioni.length - 1))];
    let detailHtml = await prenotaSessione(client, selectedSession);
    let resultHtml = detailHtml;

    if (actionType === "search") resultHtml = await cercaCandidatoInDettaglio(client, detailHtml, candidate);
    else if (actionType === "new") { const afterSearch = await cercaCandidatoInDettaglio(client, detailHtml, candidate); resultHtml = await confermaNuovoCandidato(client, afterSearch, candidate); }
    else if (actionType === "edit") resultHtml = await modificaCandidatoPrenotazione(client, detailHtml, candidate);
    else if (actionType === "delete") resultHtml = await eliminaCandidatoPrenotazione(client, detailHtml, candidate);
    else if (actionType === "replace") resultHtml = await sostituisciCandidatoPrenotazione(client, detailHtml, candidate);
    else return res.status(400).json({ success: false, error: "actionType non valido. Valori ammessi: search,new,edit,delete,replace,history" });

    const htmlText = String(resultHtml || "");
    const normalized = htmlText.toLowerCase();
    const containsNoSeats = /non ci sono posti disponibili|posti terminati|posti autoscuole raggiunto|limite posti/.test(normalized);
    const containsAlreadyBooked = /già in prenotazione|gia' in prenotazione/.test(normalized);
    const containsSuccess = /prenotat[oa] con successo|candidato e' stato prenotato con successo|conferma prenotazione/.test(normalized);
    const genericMessage = (getSessionPageDiagnostics(resultHtml) || {}).portalMessage || null;

    return res.json({ success: true, mode: "portal-prenotazione-candidato", actionType, sessionsTotal: sessioni.length, selectedSessionIndex, selectedSession, indicators: { containsSuccess, containsAlreadyBooked, containsNoSeats }, portalMessage: genericMessage, trace: portalTrace || [] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Errore durante prenotazione candidato su portale" });
  }
}

/**
 * POST /portal/import-by-patente
 * Importa un singolo candidato cercando per numero di patente.
 */
async function importByPatenteCtrl(req, res) {
  try {
    const { cognome, numeroPatente, fields, autoSelectForBooking } = req.body || {};
    const portalCredentials = await resolvePortalCredentials(req);

    if (!numeroPatente) {
      return res.status(400).json({ success: false, error: "numeroPatente obbligatorio" });
    }

    const row = await importByPatente({
      cognome,
      numeroPatente,
      fields: fields || {},
      autoscuolaId: req.autoscuolaId,
      portalCredentials,
    });

    let bookingList = [];
    if (autoSelectForBooking !== false && row?.id) {
      bookingList = await addCandidatesToBookingList([row.id], req);
    }

    await addImportHistory({
      type: "import-by-patente",
      status: "ok",
      criteria: { cognome, numeroPatente },
      parsed: 1,
      imported: 1,
      linked: bookingList.length,
      message: "Import singolo completato",
    });

    res.json({ success: true, candidate: row, bookingList });
  } catch (error) {
    await addImportHistory({ type: "import-by-patente", status: "error", errors: 1, message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /portal/import
 * Importa un singolo candidato (ricerca multipla per campi).
 */
async function importGeneric(req, res) {
  try {
    const payload = req.body || {};
    const autoSelectForBooking = payload.autoSelectForBooking !== false;
    const portalCredentials = await resolvePortalCredentials(req);
    const result = await importCandidate({ ...payload, autoscuolaId: req.autoscuolaId, portalCredentials });

    let bookingList = [];
    if (autoSelectForBooking && result?.id) {
      bookingList = await addCandidatesToBookingList([result.id], req);
    }

    await addImportHistory({
      type: "import",
      status: "ok",
      criteria: { cognome: payload.cognome, numeroPatente: payload.numeroPatente, protocolloCertificatoMedico: payload.protocolloCertificatoMedico, marcaOperativa: payload.marcaOperativa, codiceFiscale: payload.codiceFiscale, codiceAutoscuola: payload.codiceAutoscuola },
      parsed: 1,
      imported: 1,
      linked: bookingList.length,
      message: "Import singolo completato",
    });

    res.json({ ok: true, result, bookingList });
  } catch (e) {
    await addImportHistory({ type: "import", status: "error", errors: 1, message: e.message });
    res.status(500).json({ error: e.message });
  }
}

// =============================================================================
// VERBALI — Aperti / Svolti / CQC / Revisione
// =============================================================================

/**
 * POST /portal/verbali
 * Recupera verbali dal portale.
 * Body: { tipo, dataFrom, dataTo, codUfficio }
 *   tipo: 'VAC'|'VSC'|'VAQ'|'VSQ'|'VSR'|'VSRCQCC'
 */
async function verbali(req, res) {
  const trace = [];
  try {
    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti. Configura PORTAL_USERNAME e PORTAL_PASSWORD nel file .env", trace });
    }
    const { tipo, dataFrom, dataTo, dataDa, dataA, codUfficio } = req.body || {};
    const tipoNorm = (tipo || "VSC").toUpperCase();

    let html = "";
    let httpError = null;
    const skipHttp = String(process.env.PORTAL_BROWSER_PERSISTENT || "").toLowerCase() === "true";

    // Tentativo HTTP (saltato se browser persistent è attivo)
    if (!skipHttp) {
      try {
        const jar = await getOrLoginJarFast(creds);
        const client = makeHttpClient(jar);
        html = await readVerbali(client, {
          tipo: tipoNorm,
          dataFrom: dataFrom || dataDa || "",
          dataTo:   dataTo   || dataA  || "",
          codUfficio: codUfficio || process.env.PORTAL_UFFICIO_MCTC || "",
          trace,
        });
      } catch (err) {
        httpError = err;
        trace.push({ at: new Date().toISOString(), step: "verbali.http.error", message: String(err?.message || "").slice(0, 300) });
      }
    } else {
      httpError = new Error("skipped"); // forza il browser fallback
    }

    // Browser fallback se HTTP ha fallito o non ha trovato risultati
    const cheerio = require("cheerio");
    const parseTable = (rawHtml) => {
      const $ = cheerio.load(rawHtml || "");
      let dataTable = $("#listTable").first();
      if (!dataTable.length) dataTable = $("table.table, table[id*='list'], table[id*='List']").first();
      if (!dataTable.length) {
        $("table").each((_, tbl) => {
          if ($(tbl).find("thead th, thead td").length >= 3 && !dataTable.length) dataTable = $(tbl);
        });
      }
      const righe = [];
      if (dataTable.length) {
        dataTable.find("tbody tr").each((_, tr) => {
          const celle = [];
          $(tr).find("td").each((_, td) => celle.push($(td).text().trim()));
          if (celle.length > 2) righe.push(celle);
        });
      }
      const intestazioni = [];
      if (dataTable.length) {
        dataTable.find("thead tr th, thead tr td").each((_, th) => intestazioni.push($(th).text().trim()));
      }
      return { righe, intestazioni, message: !righe.length ? ($(".alert, .errors, .errore, #messaggioRicerca").first().text().trim() || "Nessun verbale trovato nel periodo") : "" };
    };

    let parsed = html ? parseTable(html) : { righe: [], intestazioni: [], message: "" };

    // Browser fallback per verbali: i tipi supportati dal browser sono VAC, VSC, VAQ, VSQ, VSR
    const BROWSER_VERBALI_MAP = { VAC: "VAC", VSC: "VSC", VAQ: "VAQ", VSQ: "VSQ", VSR: "VSR", VAR: "VAR", VSRCQC: "VSRCQC", VARCQC: "VARCQC" };
    const browserTab = BROWSER_VERBALI_MAP[tipoNorm];
    if (browserTab && (httpError || !parsed.righe.length)) {
      try {
        trace.push({ at: new Date().toISOString(), step: "verbali.browser.start", tipo: browserTab });
        const browserHtml = await readPortalSearchViaBrowser(browserTab, {
          ...creds,
          trace,
          dateFrom: dataFrom || dataDa || "",
          dateTo: dataTo || dataA || "",
        });
        const browserParsed = parseTable(browserHtml);
        html = browserHtml;
        parsed = browserParsed;
        trace.push({ at: new Date().toISOString(), step: "verbali.browser.done", count: parsed.righe.length });
      } catch (browserErr) {
        trace.push({ at: new Date().toISOString(), step: "verbali.browser.error", message: String(browserErr?.message || "").slice(0, 300) });
      }
    }

    res.json({ ok: true, tipo: tipoNorm, intestazioni: parsed.intestazioni, righe: parsed.righe, count: parsed.righe.length, message: parsed.message, trace });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace });
  }
}

// =============================================================================
// SESSIONI APPROVATE — Patente (SQA) / CQC (SCQCA)
// =============================================================================

/**
 * POST /portal/sessioni-approvate
 * Body: { tipo } — 'SQA' | 'SCQCA'
 */
async function sessioniApprovate(req, res) {
  const trace = [];
  try {
    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti", trace });
    }
    const { tipo, tipoEsame, dateFrom, dateTo, dataDa, dataA } = req.body || {};
    const tipoNorm = (tipo || "SQA").toUpperCase();
    const browserTab = tipoNorm === "SCQCA" ? "SCQCA" : "SQA";
    const tipoEsameNorm = String(tipoEsame || "").trim().toUpperCase();
    const reqDateFrom = dateFrom || dataDa || "";
    const reqDateTo = dateTo || dataA || "";

    const cheerio = require("cheerio");
    const parseTable = (rawHtml) => {
      const $ = cheerio.load(rawHtml || "");
      let dataTable = $("#listTable").first();
      if (!dataTable.length) dataTable = $("table.table, table[id*='list'], table[id*='List']").first();
      if (!dataTable.length) {
        $("table").each((_, tbl) => { if ($(tbl).find("thead th, thead td").length >= 3 && !dataTable.length) dataTable = $(tbl); });
      }
      const righe = [];
      if (dataTable.length) {
        dataTable.find("tbody tr").each((_, tr) => {
          const celle = []; $(tr).find("td").each((_, td) => celle.push($(td).text().trim()));
          if (celle.length > 2) righe.push(celle);
        });
      }
      const intestazioni = [];
      if (dataTable.length) dataTable.find("thead tr th, thead tr td").each((_, th) => intestazioni.push($(th).text().trim()));
      return { righe, intestazioni };
    };

    let html = "";
    let parsed = { righe: [], intestazioni: [] };
    const skipHttp = String(process.env.PORTAL_BROWSER_PERSISTENT || "").toLowerCase() === "true";

    // Tentativo HTTP (saltato se browser persistent è attivo)
    if (!skipHttp) {
      try {
        const jar = await getOrLoginJarFast(creds);
        const client = makeHttpClient(jar);
        html = await readSessioniApprovate(client, { tipo: tipoNorm, pin: creds.pin || process.env.PORTAL_PIN || null, trace });
        parsed = parseTable(html);
      } catch (err) {
        trace.push({ at: new Date().toISOString(), step: "approvate.http.error", message: String(err?.message || "").slice(0, 300) });
      }
    }

    // Browser fallback (o diretto se skipHttp)
    if (!parsed.righe.length) {
      try {
        trace.push({ at: new Date().toISOString(), step: "approvate.browser.start", tipo: browserTab });
        const browserHtml = await readPortalSearchViaBrowser(browserTab, { ...creds, trace, stato: "APPROVATA", tipoEsame: tipoEsameNorm, dateFrom: reqDateFrom, dateTo: reqDateTo });
        html = browserHtml;
        parsed = parseTable(browserHtml);
        trace.push({ at: new Date().toISOString(), step: "approvate.browser.done", count: parsed.righe.length });
      } catch (browserErr) {
        trace.push({ at: new Date().toISOString(), step: "approvate.browser.error", message: String(browserErr?.message || "").slice(0, 300) });
      }
    }

    res.json({ ok: true, tipo: tipoNorm, intestazioni: parsed.intestazioni, righe: parsed.righe, count: parsed.righe.length, trace });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace });
  }
}

// =============================================================================
// SESSIONI CQC
// =============================================================================

/**
 * POST /portal/sessioni-cqc
 */
async function sessioniCqc(req, res) {
  const trace = [];
  try {
    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({ ok: false, error: "Credenziali portale mancanti", trace });
    }
    const sfRaw = req.body?.searchFilters || {};
    const searchFilters = {
      stato:  sfRaw.stato  || req.body?.stato  || "",
      dataDa: sfRaw.dataDa || req.body?.dataDa || "",
      dataA:  sfRaw.dataA  || req.body?.dataA  || "",
    };

    let html = "";
    let parsed = { sessioni: [], count: 0, intestazioni: [] };
    const skipHttp = String(process.env.PORTAL_BROWSER_PERSISTENT || "").toLowerCase() === "true";

    // Tentativo HTTP (saltato se browser persistent è attivo)
    if (!skipHttp) {
      try {
        const jar = await getOrLoginJarFast(creds);
        const client = makeHttpClient(jar);
        html = await readSessioniCqc(client, { trace, searchFilters });
        const { parseSessioni } = require("../parser/sessionParser");
        parsed = parseSessioni(html);
      } catch (err) {
        trace.push({ at: new Date().toISOString(), step: "cqc.http.error", message: String(err?.message || "").slice(0, 300) });
      }
    }

    // Browser fallback (o diretto se skipHttp)
    if (!parsed.count && !parsed.sessioni?.length) {
      try {
        trace.push({ at: new Date().toISOString(), step: "cqc.browser.start" });
        const browserHtml = await readPortalSearchViaBrowser("SCQC", {
          ...creds,
          trace,
          stato: searchFilters.stato,
          dateFrom: searchFilters.dataDa,
          dateTo: searchFilters.dataA,
        });
        html = browserHtml;
        const { parseSessioni } = require("../parser/sessionParser");
        parsed = parseSessioni(browserHtml);
        trace.push({ at: new Date().toISOString(), step: "cqc.browser.done", count: parsed.count || 0 });
      } catch (browserErr) {
        trace.push({ at: new Date().toISOString(), step: "cqc.browser.error", message: String(browserErr?.message || "").slice(0, 300) });
      }
    }

    res.json({ ok: true, ...parsed, trace });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace });
  }
}

/**
 * POST /portal/prenotazione-diretta
 * Prenota un candidato usando la URL diretta con visualizzaCaptcha=false.
 * Questo è il metodo usato da iPatenteCloud e GeCA per bypassare il captcha:
 * il parametro Struts2 `visualizzaCaptcha=false` fa sì che il server salti
 * completamente la validazione captcha prima di confermare la prenotazione.
 *
 * Body:
 *   idVerbale        {string}  - ID seduta esame (selectRowId)
 *   tipoSessione     {string}  - "SQI" | "SGOS"
 *   codiceFoglioRosa {string}  - marca/foglio rosa candidato
 *   cognome          {string}  - cognome candidato
 *   turnoEsaminatore {number}  - 1-6 (1=M1...6=P3 sul portale)
 *   lingua           {string}  - opz. "IT" (default)
 *   audio            {string}  - opz. "N" (default)
 *   progressivoAula  {string}  - opz. per SGOS
 */
async function prenotazioneDiretta(req, res) {
  try {
    const {
      idVerbale,
      tipoSessione,
      codiceFoglioRosa,
      cognome,
      turnoEsaminatore,
      lingua,
      audio,
      progressivoAula,
    } = req.body || {};

    if (!idVerbale || !codiceFoglioRosa || !cognome || !turnoEsaminatore) {
      return res.status(400).json({
        success: false,
        error: "idVerbale, codiceFoglioRosa, cognome e turnoEsaminatore sono obbligatori",
      });
    }

    const creds = await resolvePortalCredentials(req);
    const jar = await getOrLoginJarFast(creds);
    const client = makeHttpClient(jar);

    const resultHtml = await prenotazioneDirectUrl(client, {
      idVerbale,
      tipoSessione: tipoSessione || "SQI",
      codiceFoglioRosa,
      cognome,
      turnoEsaminatore,
      lingua,
      audio,
      progressivoAula,
    });

    const normalized = String(resultHtml || "").toLowerCase();
    const containsSuccess   = /prenotat[oa] con successo|candidato e' stato prenotato con successo|conferma prenotazione/.test(normalized);
    const containsNoSeats   = /non ci sono posti disponibili|posti terminati|posti autoscuole raggiunto|limite posti/.test(normalized);
    const containsBooked    = /già in prenotazione|gia' in prenotazione/.test(normalized);
    const containsCaptchaErr= /codice captcha errato|captcha/.test(normalized);

    return res.json({
      success: containsSuccess,
      mode: "direct-url-no-captcha",
      indicators: { containsSuccess, containsNoSeats, containsBooked, containsCaptchaErr },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Errore prenotazione diretta" });
  }
}

// =============================================================================
// VERIFICA PRATICA — verifica stato pratica del candidato
// =============================================================================

/**
 * POST /portal/verifica-pratica
 * Naviga a "Situazione Candidati" e recupera lo stato della pratica
 */
async function verificaPratica(req, res) {
  try {
    const { marcaOperativa, codiceFiscale } = req.body || {};
    if (!marcaOperativa && !codiceFiscale) {
      return res.status(400).json({ error: "marcaOperativa o codiceFiscale obbligatorio" });
    }

    const client = await getClient();
    // Naviga a Situazione Candidati
    const situazioneHtml = await readSituazioneCandidati(client, marcaOperativa || codiceFiscale);

    if (!situazioneHtml || typeof situazioneHtml !== "string") {
      return res.json({ success: false, error: "Non è stato possibile recuperare la situazione candidati" });
    }

    // Parsa il risultato cercando informazioni sulla pratica
    const cheerio = require("cheerio");
    const $ = cheerio.load(situazioneHtml);

    const pratica = {
      statoFoglioRosa: null,
      statoPatente: null,
      scadenze: [],
      candidati: [],
    };

    // Estrai informazioni di base
    $("tr").each((_, row) => {
      const text = $(row).text().trim();
      if (/foglio rosa/i.test(text)) {
        const cells = $(row).find("td").map((_, c) => $(c).text().trim()).get();
        pratica.statoFoglioRosa = cells.slice(1).join(" | ") || text;
      }
      if (/patente|stato patente/i.test(text)) {
        const cells = $(row).find("td").map((_, c) => $(c).text().trim()).get();
        pratica.statoPatente = cells.slice(1).join(" | ") || text;
      }
      if (/scadenza|data scadenza/i.test(text)) {
        const cells = $(row).find("td").map((_, c) => $(c).text().trim()).get();
        if (cells.length > 1) pratica.scadenze.push(cells[1]);
      }
    });

    res.json({ success: true, pratica, htmlLength: situazioneHtml.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Errore durante verifica pratica" });
  }
}

// =============================================================================
// DIAGNOSTICA — endpoint per debug completo del flusso portale
// =============================================================================

/**
 * POST /portal/diagnostica
 * Esegue il flusso completo step-by-step e restituisce trace dettagliato con HTML snippets.
 */
async function diagnostica(req, res) {
  const trace = [];
  const results = {};
  try {
    const creds = await resolvePortalCredentials(req);
    trace.push({ step: "credentials", username: creds.username ? creds.username.slice(0, 4) + "***" : "MISSING", hasPassword: !!creds.password, hasPin: !!creds.pin });

    if (!creds.username || !creds.password) {
      return res.json({ ok: false, error: "Credenziali mancanti", trace, results });
    }

    // 1) Login
    const jar = await getOrLoginJarFast(creds);
    trace.push({ step: "login", ok: true });

    // Dump cookies for debugging
    try {
      const cookieStr = jar.getCookieStringSync("https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action");
      const allCookies = jar.toJSON ? jar.toJSON().cookies : [];
      results.cookies = {
        forPrenotazione: cookieStr.slice(0, 500),
        count: allCookies.length,
        names: allCookies.map(c => `${c.key}=${String(c.value||"").slice(0,20)}... domain=${c.domain} path=${c.path}`).slice(0, 10),
      };
    } catch (ce) {
      results.cookies = { error: ce.message.slice(0, 100) };
    }

    const client = makeHttpClient(jar);

    // 2) Warm-up prenotazione context
    try {
      const warmHtml = await warmPrenotazioneContext(client, trace);
      results.warmup = { title: warmHtml ? (warmHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() : "", length: String(warmHtml || "").length };
    } catch (e) {
      results.warmup = { error: e.message };
    }

    // 3) Load menu
    try {
      const menuHtml = await loadMenu(client);
      results.menu = { title: (menuHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "", length: String(menuHtml || "").length };
    } catch (e) {
      results.menu = { error: e.message };
    }

    // 4) Try sessioni quiz page + test submission GET
    try {
      const cheerio = require("cheerio");
      const sessUrl = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
      const sessResp = await client.get(sessUrl);
      const sessHtml = sessResp.data;
      const $s = cheerio.load(sessHtml);
      const forms = [];
      $s("form").each((_, f) => {
        const $f = $s(f);
        const inputNames = $f.find("input").map((__, inp) => ({
          name: $s(inp).attr("name") || "",
          type: $s(inp).attr("type") || "text",
          value: String($s(inp).attr("value") || "").slice(0, 60),
        })).get();
        forms.push({
          id: $f.attr("id") || "",
          name: $f.attr("name") || "",
          action: String($f.attr("action") || "").slice(0, 150),
          method: $f.attr("method") || "(default=get)",
          inputs: inputNames.length,
          inputNames,
        });
      });
      results.sessioni = {
        title: (sessHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "",
        length: sessHtml.length,
        forms,
        hasSearchForm: $s("form#RicercaDisponibilitaSessioneEsameEP, form[name='RicercaDisponibilitaSessioneEsameEP']").length > 0,
        htmlSnippet: sessHtml.slice(0, 2000),
      };

      // Test GET submission
      const searchForm = $s("form#RicercaDisponibilitaSessioneEsameEP, form[name='RicercaDisponibilitaSessioneEsameEP']").first();
      if (searchForm.length) {
        const formAction = String(searchForm.attr("action") || "").startsWith("http")
          ? searchForm.attr("action")
          : `https://www.ilportaledellautomobilista.it${searchForm.attr("action") || ""}`;
        const testPayload = new URLSearchParams();
        searchForm.find("input").each((__, inp) => {
          const name = $s(inp).attr("name");
          const type = String($s(inp).attr("type") || "text").toLowerCase();
          if (!name || ["submit","button","image","file"].includes(type)) return;
          testPayload.append(name, $s(inp).attr("value") || "");
        });
        searchForm.find("select").each((__, sel) => {
          const name = $s(sel).attr("name");
          if (!name) return;
          const selected = $s(sel).find("option[selected]").first();
          testPayload.append(name, selected.length ? selected.attr("value") || "" : $s(sel).find("option").first().attr("value") || "");
        });
        // Aggiungi il bottone di ricerca e la data corrente
        testPayload.append("action:Read_paging", "Ricerca");
        const today = new Date();
        const dd = (d) => String(d).padStart(2, "0");
        const todayStr = `${dd(today.getDate())}/${dd(today.getMonth() + 1)}/${today.getFullYear()}`;
        const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + 29);
        const maxStr = `${dd(maxDate.getDate())}/${dd(maxDate.getMonth() + 1)}/${maxDate.getFullYear()}`;
        const fromKey = Array.from(testPayload.keys()).find(k => k.includes("EPFrom.dataDisponibiltaEsaminatore"));
        const toKey   = Array.from(testPayload.keys()).find(k => k.includes("EPTo.dataDisponibiltaEsaminatore"));
        if (fromKey && !testPayload.get(fromKey)) testPayload.set(fromKey, todayStr);
        if (toKey   && !testPayload.get(toKey))   testPayload.set(toKey, maxStr);

        const baseFormAction = formAction.split("?")[0];
        const testResults = [];
        // Proviamo più varianti di URL con pageStatus (POST e GET)
        for (const [testUrl, testMethod] of [
          [baseFormAction + "?pageStatus=PAGING", "POST"],
          [baseFormAction + "?pageStatus=SEARCH", "POST"],
          [baseFormAction + "?pageStatus=PAGING", "GET"],
          [baseFormAction + "?pageStatus=SEARCH", "GET"],
          [baseFormAction, "POST"],
          [baseFormAction, "GET"],
        ]) {
          try {
            let testResp;
            if (testMethod === "POST") {
              testResp = await client.post(testUrl, serializePayloadRaw(testPayload), { headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: sessUrl } });
            } else {
              const qs = serializePayloadRaw(testPayload);
              const sep = testUrl.includes("?") ? "&" : "?";
              testResp = await client.get(`${testUrl}${sep}${qs}`, { headers: { Referer: sessUrl } });
            }
            const testHtml = testResp.data;
            const $g = cheerio.load(testHtml);
            let tableRows = 0;
            $g("table tr").each(() => { tableRows++; });
            const testTitle = (testHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "";
            testResults.push({ method: testMethod, urlSuffix: testUrl.replace(baseFormAction, ''), ok: true, status: 200, title: testTitle, length: testHtml.length, tableRows });
            if (tableRows > 1) break; // trovata tabella con dati
          } catch (e2) {
            testResults.push({ method: testMethod, urlSuffix: testUrl.replace(baseFormAction, ''), ok: false, status: e2?.response?.status, error: e2.message.slice(0, 100) });
          }
        }
        results.sessioni.getSubmissionTest = testResults;

        // ——— Dump token values ———
        const tokenDump = {};
        searchForm.find("input[type='hidden']").each((__, inp) => {
          const n = $s(inp).attr("name") || "";
          if (n.includes("token") || n.includes("struts")) {
            tokenDump[n] = String($s(inp).attr("value") || "(empty)").slice(0, 80);
          }
        });
        results.sessioni.tokenValues = tokenDump;

        // ——— Extended POST tests ———
        const extTests = [];

        // Helper: run a single test with validateStatus so we see real status
        async function runExtTest(label, url, data, extraHeaders = {}) {
          try {
            const serializedData = typeof data === "string" ? data : (data instanceof URLSearchParams ? serializePayloadRaw(data) : data);
            const resp = await client.post(url, serializedData, {
              headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: sessUrl, ...extraHeaders },
              maxRedirects: 0,
              validateStatus: () => true,
            });
            const h = resp.data || "";
            const $t = cheerio.load(h);
            return { label, status: resp.status, location: (resp.headers?.location || "").slice(0, 200), title: ($t("title").text() || "").trim().slice(0, 100), bodyLen: h.length, hasTable: h.includes("elementi trovati"), snippet: String(h).slice(0, 400) };
          } catch (e) {
            return { label, error: e.message.slice(0, 150), status: e?.response?.status };
          }
        }

        // Build payload WITHOUT token fields
        const payloadNoTokens = new URLSearchParams();
        for (const [k, v] of testPayload.entries()) {
          if (!k.includes("token") && !k.includes("struts")) {
            payloadNoTokens.append(k, v);
          }
        }

        // Build payload WITHOUT action: button params
        const payloadNoAction = new URLSearchParams();
        for (const [k, v] of testPayload.entries()) {
          if (!k.startsWith("action:")) {
            payloadNoAction.append(k, v);
          }
        }

        // Build minimal payload — just dates + status
        const payloadMinimal = new URLSearchParams();
        for (const [k, v] of testPayload.entries()) {
          if (k.includes("dataDisponibilt") || k.includes("selectRowId") || k.includes("tipoSede")) {
            payloadMinimal.append(k, v);
          }
        }
        payloadMinimal.append("action:Read_paging", "Ricerca");

        // The actual form action from HTML
        const formActionUrl = String(searchForm.attr("action") || "");
        const fullFormAction = formActionUrl.startsWith("http") ? formActionUrl : `https://www.ilportaledellautomobilista.it${formActionUrl}`;

        // Test 1: POST to form action (exactly as HTML says) with full payload
        extTests.push(await runExtTest("T1-formAction-full", fullFormAction, testPayload));
        // Test 2: POST to form action WITHOUT tokens
        extTests.push(await runExtTest("T2-formAction-noTokens", fullFormAction, payloadNoTokens));
        // Test 3: POST to form action WITHOUT action: button
        extTests.push(await runExtTest("T3-formAction-noActionBtn", fullFormAction, payloadNoAction));
        // Test 4: POST to Read_paging.action (the DMI target)
        const pagingUrl = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_paging.action";
        extTests.push(await runExtTest("T4-pagingAction-full", pagingUrl, testPayload));
        // Test 5: POST to Read_paging.action with minimal payload
        extTests.push(await runExtTest("T5-pagingAction-minimal", pagingUrl, payloadMinimal));
        // Test 6: POST to form action with follow redirects (up to 10)
        try {
          const resp6 = await client.post(fullFormAction, serializePayloadRaw(testPayload), {
            headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: sessUrl },
            maxRedirects: 10,
            validateStatus: () => true,
          });
          const h6 = resp6.data || "";
          const $t6 = cheerio.load(h6);
          extTests.push({ label: "T6-formAction-followRedirects", status: resp6.status, title: ($t6("title").text() || "").trim().slice(0, 100), bodyLen: h6.length, hasTable: h6.includes("elementi trovati") });
        } catch (e6) {
          extTests.push({ label: "T6-formAction-followRedirects", error: e6.message.slice(0, 150), status: e6?.response?.status });
        }
        // Test 7: POST to Read_paging without EP suffix (some portals use non-EP namespace)
        const pagingUrlNoEP = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/Read_paging.action";
        extTests.push(await runExtTest("T7-pagingNoEP", pagingUrlNoEP, testPayload));
        // Test 8: POST to Read_paging.action WITHOUT action: param in body (key test!)
        extTests.push(await runExtTest("T8-pagingAction-noActionBtn", pagingUrl, payloadNoAction));
        // Test 8b: POST to Read_paging.action with ONLY form data (no tokens, no action btn)
        const payloadClean = new URLSearchParams();
        for (const [k, v] of testPayload.entries()) {
          if (!k.includes("token") && !k.includes("struts") && !k.startsWith("action:")) {
            payloadClean.append(k, v);
          }
        }
        extTests.push(await runExtTest("T8b-pagingAction-clean", pagingUrl, payloadClean));
        // Test 8c: POST form data to formAction without action: param (test was T3 before)
        extTests.push(await runExtTest("T8c-formAction-noActionBtn-followRedir", fullFormAction, payloadNoAction));
        // Test 8d: POST to Read_paging.action?pageStatus=PAGING WITHOUT action param
        extTests.push(await runExtTest("T8d-pagingPAGING-noAction", pagingUrl + "?pageStatus=PAGING", payloadNoAction));
        // Test 8e: POST to Read_paging.action?pageStatus=SEARCH WITHOUT action param
        extTests.push(await runExtTest("T8e-pagingSEARCH-noAction", pagingUrl + "?pageStatus=SEARCH", payloadNoAction));
        // Test 8f: try method:paging instead of action:Read_paging
        const payloadMethodPaging = new URLSearchParams();
        for (const [k, v] of payloadNoAction.entries()) { payloadMethodPaging.append(k, v); }
        payloadMethodPaging.append("method:paging", "");
        extTests.push(await runExtTest("T8f-methodPaging", fullFormAction, payloadMethodPaging));
        // Test 8g: POST form data without action: to Read_initActionSessioniQuizInterne with __execute=paging
        const payloadExecPaging = new URLSearchParams();
        for (const [k, v] of payloadNoAction.entries()) { payloadExecPaging.append(k, v); }
        payloadExecPaging.append("__execute", "paging");
        extTests.push(await runExtTest("T8g-executePaging", fullFormAction, payloadExecPaging));
        // Test 8h: POST clean payload to the initAction URL (no pageStatus)
        const initActionBase = fullFormAction.split("?")[0];
        extTests.push(await runExtTest("T8h-initAction-clean", initActionBase, payloadClean));
        // Test 9: GET the form action page (no form params) — should return the search form
        try {
          const resp9 = await client.get(fullFormAction, { validateStatus: () => true });
          const h9 = resp9.data || "";
          extTests.push({ label: "T9-formAction-bareGET", status: resp9.status, title: cheerio.load(h9)("title").text().trim().slice(0, 100), bodyLen: h9.length });
        } catch (e9) {
          extTests.push({ label: "T9-formAction-bareGET", error: e9.message.slice(0, 150) });
        }
        // Test 10: POST with multipart/form-data Content-Type
        const FormData = require("form-data");
        const formDataMultipart = new FormData();
        for (const [k, v] of testPayload.entries()) {
          formDataMultipart.append(k, v);
        }
        try {
          const resp10 = await client.post(fullFormAction, formDataMultipart, {
            headers: { ...formDataMultipart.getHeaders(), Referer: sessUrl },
            maxRedirects: 0,
            validateStatus: () => true,
          });
          const h10 = resp10.data || "";
          extTests.push({ label: "T10-multipart", status: resp10.status, title: cheerio.load(h10)("title").text().trim().slice(0, 100), bodyLen: h10.length });
        } catch (e10) {
          extTests.push({ label: "T10-multipart", error: e10.message.slice(0, 150) });
        }

        // Test 11-16: More strategies
        // T11: Struts2 "bang notation" — Read_initActionSessioniQuizInterne!paging.action
        const bangUrl = fullFormAction.replace('.action', '!paging.action');
        extTests.push(await runExtTest("T11-bangPaging", bangUrl, payloadNoAction));
        // T12: POST to Read_initAction with pageStatus=PAGING without action: (trigger search via pageStatus)
        extTests.push(await runExtTest("T12-initAction-pageStatusPAGING-noAction", fullFormAction.split('?')[0] + '?pageStatus=PAGING', payloadNoAction));
        // T13: POST with action%3ARead_paging explicitly (encoded colon - matching browser encoding)
        const payloadEncodedAction = serializePayloadRaw(payloadNoAction) + '&action%3ARead_paging=Ricerca';
        try {
          const r13 = await client.post(fullFormAction, payloadEncodedAction, {
            headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: sessUrl },
            maxRedirects: 0,
            validateStatus: () => true,
          });
          const h13 = r13.data || "";
          extTests.push({ label: "T13-encodedColonAction", status: r13.status, title: cheerio.load(h13)("title").text().trim().slice(0, 100), bodyLen: h13.length, hasTable: h13.includes("elementi trovati") || h13.includes("listTable") });
        } catch(e13) {
          extTests.push({ label: "T13-encodedColonAction", error: e13.message.slice(0,100) });
        }
        // T14: POST with URLSearchParams natively (let axios handle serialization, which encodes %3A)
        try {
          const nativePayload = new URLSearchParams();
          for (const [k, v] of testPayload.entries()) { nativePayload.append(k, v); }
          const r14 = await client.post(fullFormAction, nativePayload, {
            headers: { Referer: sessUrl },
            maxRedirects: 0,
            validateStatus: () => true,
          });
          const h14 = r14.data || "";
          extTests.push({ label: "T14-nativeURLSearchParams", status: r14.status, title: cheerio.load(h14)("title").text().trim().slice(0, 100), bodyLen: h14.length, hasTable: h14.includes("elementi trovati") || h14.includes("listTable"), sentBody: nativePayload.toString().substring(0, 200) });
        } catch(e14) {
          extTests.push({ label: "T14-nativeURLSearchParams", error: e14.message.slice(0,100) });
        }
        // T15: POST clean payload (no tokens, no action btn) to Read_paging with follow redirects
        try {
          const r15 = await client.post(pagingUrl, serializePayloadRaw(payloadClean), {
            headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: sessUrl },
            maxRedirects: 10,
            validateStatus: () => true,
          });
          const h15 = r15.data || "";
          extTests.push({ label: "T15-pagingClean-followRedir", status: r15.status, title: cheerio.load(h15)("title").text().trim().slice(0, 100), bodyLen: h15.length, hasTable: h15.includes("elementi trovati") || h15.includes("listTable") });
        } catch(e15) {
          extTests.push({ label: "T15-pagingClean-followRedir", error: e15.message.slice(0,100) });
        }
        // T16: POST with __method=paging parameter (Spring-style method override)
        const payloadMethodOverride = new URLSearchParams();
        for (const [k, v] of payloadNoAction.entries()) { payloadMethodOverride.append(k, v); }
        payloadMethodOverride.append("__method", "paging");
        payloadMethodOverride.append("_method", "paging");
        extTests.push(await runExtTest("T16-methodOverride", fullFormAction, payloadMethodOverride));

        results.sessioni.extendedTests = extTests;
        results.sessioni.formActionFromHtml = fullFormAction;

        // Salva HTML completo su file per analisi
        try {
          const fs = require("fs");
          const path = require("path");
          const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
          if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
          fs.writeFileSync(path.join(dumpDir, "sessioni-page.html"), sessHtml, "utf8");
          results.sessioni.htmlDumpPath = path.join(dumpDir, "sessioni-page.html");
        } catch (dumpErr) {
          results.sessioni.htmlDumpError = dumpErr.message;
        }

        // Analisi JavaScript della pagina per capire come viene sottomesso il form
        const scripts = [];
        $s("script").each((_, sc) => {
          const src = $s(sc).attr("src") || "";
          const text = $s(sc).html() || "";
          if (text.length > 10 && (text.includes("submit") || text.includes("paging") || text.includes("ricerca") || text.includes("ajax") || text.includes("Ricerca"))) {
            scripts.push({ type: "inline", snippet: text.slice(0, 600) });
          } else if (src && (src.includes("paging") || src.includes("sessione") || src.includes("disponibilita"))) {
            scripts.push({ type: "external", src: src.slice(0, 200) });
          }
        });
        // Trova i bottoni submit con onclick
        const submitButtons = [];
        $s("input[type='submit'], button[type='submit'], input[name^='action:']").each((_, btn) => {
          submitButtons.push({
            name: $s(btn).attr("name") || "",
            value: $s(btn).attr("value") || "",
            onclick: ($s(btn).attr("onclick") || "").slice(0, 200),
            dojoType: $s(btn).attr("dojotype") || $s(btn).attr("dojoType") || "",
            href: $s(btn).attr("href") || "",
          });
        });
        // Analisi form: attributi extra
        const formAttrs = {};
        const formEl = searchForm.get(0);
        if (formEl && formEl.attribs) {
          Object.entries(formEl.attribs).forEach(([k, v]) => {
            if (k !== "action" && k !== "name" && k !== "id") {
              formAttrs[k] = String(v).slice(0, 200);
            }
          });
        }
        // Cerca link/anchor con paging
        const pagingLinks = [];
        $s("a[href*='paging'], a[href*='Paging'], a[onclick*='paging'], a[onclick*='submit']").each((_, a) => {
          pagingLinks.push({
            href: ($s(a).attr("href") || "").slice(0, 200),
            onclick: ($s(a).attr("onclick") || "").slice(0, 200),
            text: ($s(a).text() || "").trim().slice(0, 50),
          });
        });
        results.sessioni.jsAnalysis = { scripts, submitButtons, formAttrs, pagingLinks };
      }
    } catch (e) {
      results.sessioni = { error: e.message, status: e?.response?.status };
    }

    // 5) Try verbali page
    try {
      const cheerio = require("cheerio");
      const verbUrl = "https://www.ilportaledellautomobilista.it/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action?pageStatus=SEARCH";
      const verbResp = await client.get(verbUrl, {
        headers: { Referer: "https://www.ilportaledellautomobilista.it/prenotazione/menu/LoadMenu_execute.action" },
      });
      const verbHtml = verbResp.data;
      const $v = cheerio.load(verbHtml);
      const forms = [];
      $v("form").each((_, f) => {
        forms.push({ id: $v(f).attr("id") || "", name: $v(f).attr("name") || "", action: String($v(f).attr("action") || "").slice(0, 150), inputs: $v(f).find("input").length });
      });
      results.verbali = {
        title: (verbHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "",
        length: verbHtml.length,
        forms,
        hasRicercaForm: $v("form#RicercaSessioneEsameAbilitazioneEP, form[name='RicercaSessioneEsameAbilitazioneEP']").length > 0,
        htmlSnippet: verbHtml.slice(0, 2000),
      };
    } catch (e) {
      results.verbali = { error: e.message, status: e?.response?.status };
    }

    res.json({ ok: true, trace, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, trace, results });
  }
}

// =============================================================================
// DETTAGLIO SESSIONE — replica il pulsante DETTAGLIO del portale
// =============================================================================

/**
 * POST /portal/sessione-dettaglio
 *
 * Replica il flusso "Seleziona riga → DETTAGLIO" del portale dell'automobilista.
 * Fasi:
 *   1. Login portale (riusa sessione HTTP cached)
 *   2. Carica pagina ricerca sessioni (per avere form + token CSRF)
 *   3. Invia ricerca → ottieni tabella risultati con selectRowId per ogni riga
 *   4. Costruisci payload con selectRowId della sessione selezionata
 *   5. POST action:Select_listCandidati=Dettaglio → pagina dettaglio
 *   6. Parsa HTML dettaglio e ritorna dati strutturati (campi + turni)
 *
 * Body: { sessionIndex: number, dataDa, dataA, stato }
 *   sessionIndex = indice della riga nella tabella (0-based)
 */
async function sessioneDettaglio(req, res) {
  const dettaglioCache = require("../services/sessioniDettaglioCache");

  try {
    const sessionIndex = parseInt(req.body?.sessionIndex ?? "0", 10);
    const dataDa = String(req.body?.dataDa || "").trim();
    const dataA = String(req.body?.dataA || "").trim();
    const stato = String(req.body?.stato || "APERTA").trim().toUpperCase();
    // Dati riga dalla tabella frontend (per lookup cache)
    const rowData = req.body?.rowData || {};
    const forceRefresh = req.body?.forceRefresh === true;

    const creds = await resolvePortalCredentials(req);

    // ── STEP 1: Cerca in cache Supabase (istantaneo) ──
    if (!forceRefresh && rowData.data) {
      try {
        const cached = await dettaglioCache.getFromCache({
          dataSessione: rowData.data,
          tipoEsame: rowData.tipo || rowData.tipoEsame || null,
          aula: rowData.aula || null,
          ufficioProv: rowData.ufficio || rowData.ufficioProv || null,
        });

        if (cached && dettaglioCache.isCacheFresh(cached, 120)) {
          console.log("[sessioneDettaglio] Cache HIT per", rowData.data, rowData.tipo);

          // Se la cache è fresca (<2 ore), restituisci subito
          // Avvia refresh in background se > 30 min
          if (!dettaglioCache.isCacheFresh(cached, 30) && creds.username && creds.password) {
            fetchAndCacheDetailInBackground(sessionIndex, dataDa, dataA, stato, creds, rowData);
          }

          return res.json({
            success: true,
            sessionIndex,
            campi: cached.campi || {},
            turni: cached.turni || [],
            candidati: cached.candidati || [],
            campiNoti: cached.campi || {},
            pageTitle: cached.page_title || "",
            source: "cache",
            cachedAt: cached.fetched_at,
          });
        }
      } catch (cacheErr) {
        console.warn("[sessioneDettaglio] Cache lookup error:", cacheErr.message);
      }
    }

    // ── STEP 2: Fetch dal portale (HTTP → Browser fallback) ──
    if (!creds.username || !creds.password) {
      return res.status(400).json({ error: "Credenziali portale mancanti" });
    }

    const statoMap = { "APERTA": "A|", "CHIUSA": "C|", "ANNULLATA": "N|" };
    const statoFilter = statoMap[stato] || "A|";
    const trace = [];

    let result = null;

    // Tentativo HTTP diretto (veloce)
    try {
      const cheerio = require("cheerio");
      const { buildDetailPayload, setAction, postPortalForm } = require("../connector/booking");

      const jar = await getOrLoginJarFast(creds);
      const client = makeHttpClient(jar);
      try { await loadMenu(client); } catch {}

      const searchHtml = await readSessioniQuizInterne(client, {
        trace,
        pin: creds.pin || process.env.PORTAL_PIN || null,
        searchFilters: { stato, dataDa, dataA },
      });

      if (searchHtml && typeof searchHtml === "string") {
        const $ = cheerio.load(searchHtml);
        const radioButtons = [];
        $("input[type='radio']").each((_, radio) => {
          const name = $(radio).attr("name") || "";
          const value = $(radio).attr("value") || "";
          if (name.toLowerCase().includes("selectrowid")) {
            radioButtons.push({ name, value });
          }
        });

        if (radioButtons.length && sessionIndex < radioButtons.length) {
          const selected = radioButtons[sessionIndex];
          const { payload, action: formAction } = buildDetailPayload(searchHtml);
          const dettaglioUrl = formAction ||
            "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action";
          payload.set(selected.name, selected.value);
          setAction(payload, "action:Select_listCandidati", "Dettaglio");

          const detailHtml = await postPortalForm(client, dettaglioUrl, payload,
            "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action");

          if (detailHtml && typeof detailHtml === "string" && detailHtml.length > 500) {
            const $d = cheerio.load(detailHtml);
            const hasDetail = $d("input[type='text']").length > 3 || $d("table").length > 1 || /capienza|turno|esaminat/i.test(detailHtml);
            if (hasDetail) {
              result = parseDetailHtmlCheerio(detailHtml, sessionIndex, trace);
              result.source = "http";
            }
          }
        }
      }
    } catch (httpErr) {
      trace.push({ at: new Date().toISOString(), step: "http.detail.failed", error: httpErr.message });
      console.warn("[sessioneDettaglio] HTTP fallito, uso browser:", httpErr.message);
    }

    // Tentativo Browser (Puppeteer) – fallback robusto
    if (!result) {
      trace.push({ at: new Date().toISOString(), step: "browser.detail.start" });
      result = await readSessioneDettaglioViaBrowser({
        sessionIndex,
        dataDa,
        dataA,
        stato: statoFilter,
        username: creds.username,
        password: creds.password,
        pin: creds.pin || process.env.PORTAL_PIN,
        trace,
      });
      result.source = "browser";
    }

    // ── DEBUG: log struttura tabelle ──
    if (result) {
      console.log("[sessioneDettaglio] Source:", result.source,
        "| Turni:", (result.turni || []).length,
        "| Candidati:", (result.candidati || []).length,
        "| TurniHeaders:", result.turni?.[0] ? Object.keys(result.turni[0]).filter(k => !k.startsWith("_")).join(", ") : "N/A",
        "| CandidatiHeaders:", result.candidati?.[0] ? Object.keys(result.candidati[0]).filter(k => !k.startsWith("_")).join(", ") : "N/A",
        "| TableDebug:", JSON.stringify(result._tableDebug || {}));
    }

    // ── STEP 3: Salva in cache per uso futuro (non bloccante) ──
    if (result?.success) {
      dettaglioCache.saveToCache(result, {
        dataSessione: rowData.data || "",
        tipoEsame: rowData.tipo || rowData.tipoEsame || "",
        aula: rowData.aula || "",
        ufficioProv: rowData.ufficio || rowData.ufficioProv || "",
        radioValue: result.selectedRadio?.value || "",
      }).catch((err) => console.warn("[sessioneDettaglio] Cache save error:", err.message));
    }

    res.json(result);
  } catch (e) {
    console.error("[sessioneDettaglio] Errore:", e.message);
    res.status(500).json({ error: e.message, stack: e.stack?.split("\n").slice(0, 3) });
  }
}

/**
 * Aggiorna la cache del dettaglio in background (fire-and-forget).
 */
function fetchAndCacheDetailInBackground(sessionIndex, dataDa, dataA, stato, creds, rowData) {
  const dettaglioCache = require("../services/sessioniDettaglioCache");
  const statoMap = { "APERTA": "A|", "CHIUSA": "C|", "ANNULLATA": "N|" };

  setImmediate(async () => {
    try {
      const result = await readSessioneDettaglioViaBrowser({
        sessionIndex,
        dataDa,
        dataA,
        stato: statoMap[stato] || "A|",
        username: creds.username,
        password: creds.password,
        pin: creds.pin || process.env.PORTAL_PIN,
        trace: [],
      });
      if (result?.success) {
        await dettaglioCache.saveToCache(result, {
          dataSessione: rowData.data || "",
          tipoEsame: rowData.tipo || rowData.tipoEsame || "",
          aula: rowData.aula || "",
          ufficioProv: rowData.ufficio || rowData.ufficioProv || "",
        });
        console.log("[sessioneDettaglio] Background cache refresh OK per", rowData.data);
      }
    } catch (err) {
      console.warn("[sessioneDettaglio] Background refresh failed:", err.message);
    }
  });
}

/**
 * Helper: parsa HTML dettaglio sessione con cheerio (usato dal fast path HTTP).
 */
function parseDetailHtmlCheerio(detailHtml, sessionIndex, trace) {
  const cheerio = require("cheerio");
  const $d = cheerio.load(detailHtml);

  const campi = {};

  // Estrai coppie label→valore da tabelle strutturate
  $d("tr").each((_, row) => {
    const tds = $d(row).children("td, th");
    for (let i = 0; i < tds.length - 1; i++) {
      const labelText = $d(tds[i]).text().trim().replace(/:?\s*$/, "");
      if (!labelText || labelText.length > 80) continue;

      const valueEl = $d(tds[i + 1]);
      const input = valueEl.find("input, select").first();
      let valueText = "";
      if (input.length) {
        if (input.is("select")) {
          const opt = input.find("option[selected]").first();
          valueText = opt.length ? opt.text().trim() : String(input.val() || "");
        } else {
          valueText = String(input.val() || "").trim();
        }
      }
      if (!valueText) valueText = valueEl.text().trim();

      if (valueText && !labelText.match(/^[\s\d]+$/) && labelText !== valueText) {
        campi[labelText] = valueText;
        i++;
      }
    }
  });

  // Input con label associata
  $d("input[type='text'], input[type='hidden'], input:not([type])").each((_, el) => {
    const name = $d(el).attr("name") || $d(el).attr("id") || "";
    const value = String($d(el).val() || "").trim();
    if (!name || !value) return;
    const labelText = $d(`label[for='${$d(el).attr("id") || ""}']`).text().trim();
    if (labelText && !campi[labelText]) campi[labelText.replace(/:?\s*$/, "")] = value;
  });

  // Tabelle turni e candidati — mutuamente esclusive
  // IMPORTANTE: il portale Struts2 usa tabelle wrapper annidate.
  // Processiamo SOLO tabelle foglia (senza sotto-tabelle) e usiamo
  // selettori > diretti per non mescolare dati di tabelle diverse.
  const turni = [];
  const candidati = [];

  // Filtra solo tabelle foglia (senza sotto-tabelle)
  const leafTables = [];
  $d("table").each((_, table) => {
    if ($d(table).find("table").length === 0) leafTables.push($d(table));
  });

  // Helper: estrai header con selettori diretti
  function getHeaders($table) {
    const headers = [];
    const $thead = $table.children("thead");
    if ($thead.length) {
      $thead.find("th, td").each((_, th) => headers.push($d(th).text().trim()));
    }
    if (!headers.length) {
      const $firstRow = $table.children("thead, tbody").children("tr").first();
      if (!$firstRow.length) return headers;
      $firstRow.children("th, td").each((_, cell) => {
        const t = $d(cell).text().trim();
        if (t) headers.push(t);
      });
    }
    return headers;
  }

  const candidatiTableSet = new Set();

  // Prima passata: identifica tabelle candidati
  leafTables.forEach(($table, tableIdx) => {
    const headers = getHeaders($table);
    // Colonne ESCLUSIVE candidati: Cognome, Patente, Marca Operativa
    // NON "Num. Domande" che appare anche nella tabella turni!
    const isCandidati = headers.some(h => /cognome|patente|marca.operativa/i.test(h));
    if (!isCandidati || headers.length < 4) return;

    candidatiTableSet.add(tableIdx);
    const $tbody = $table.children("tbody");
    const $rows = $tbody.length ? $tbody.children("tr") : $table.children("tr").slice(1);
    $rows.each((_, tr) => {
      const celle = [];
      $d(tr).children("td").each((_, td) => celle.push($d(td).text().trim()));
      if (celle.length >= 4) {
        const cand = {};
        headers.forEach((h, i) => { if (h) cand[h] = celle[i] || ""; });
        const $radio = $d(tr).find("input[type='radio']");
        if ($radio.length) {
          cand._radioName = String($radio.attr("name") || "");
          cand._radioValue = String($radio.val() || "");
        }
        candidati.push(cand);
      }
    });
  });

  // Seconda passata: tabelle turni (ESCLUSE candidati)
  leafTables.forEach(($table, tableIdx) => {
    if (candidatiTableSet.has(tableIdx)) return;
    const headers = getHeaders($table);
    // Colonne ESCLUSIVE turni: "Orario*Turno", "Minuti turno", "Categorie Ammesse", "Cod. Tipo Seduta"
    const isTurni = headers.some(h => /orario.*turno|minuti.*turno|categori.*ammesse|cod.*tipo.*seduta/i.test(h));
    if (!isTurni || headers.length < 3) return;
    const $tbody = $table.children("tbody");
    const $rows = $tbody.length ? $tbody.children("tr") : $table.children("tr").slice(1);
    $rows.each((_, tr) => {
      const celle = [];
      $d(tr).children("td").each((_, td) => celle.push($d(td).text().trim()));
      if (celle.length >= 3) {
        const turno = {};
        headers.forEach((h, i) => { turno[h] = celle[i] || ""; });
        turni.push(turno);
      }
    });
  });

  const CAMPI_NOTI = [
    "Tipo Esame", "Ufficio Prov.", "Data Sess.", "Data Limite Pren.",
    "Fascia Oraria", "Località", "Aula", "Capienza Aula",
    "Num. Esaminatori", "Num. Turni", "Tipo Seduta", "Num. Domande",
    "Gruppo", "Autoscuola", "Orario Inizio Primo Turno",
    "Num. posti riservati U.P. per turno",
    "Num. max posti Autoscuola per sessione",
    "Num. max posti Autoscuola per turno",
    "Giorni limite prenotazione", "Indicatore Conto",
  ];

  const campiNoti = {};
  CAMPI_NOTI.forEach((nome) => {
    const val = campi[nome] || Object.entries(campi).find(([k]) => k.toLowerCase().includes(nome.toLowerCase()))?.[1] || "";
    if (val) campiNoti[nome] = val;
  });

  return {
    success: true,
    sessionIndex,
    campi,
    turni,
    candidati,
    campiNoti,
    pageTitle: $d("title").text().trim(),
    trace: (trace || []).slice(-5),
  };
}

// =============================================================================
// STAMPA PORTALE – documenti ufficiali dal portale via Puppeteer
// =============================================================================
async function stampaPortale(req, res) {
  try {
    const { readStampaPortaleViaBrowser } = require("../connector/portalSession");
    const creds = await resolvePortalCredentials(req);

    const {
      stampaType = "stampa",
      sessionIndex = 0,
      candidateIndex = -1,
      marcaOperativa = "",
      dataDa,
      dataA,
      stato,
    } = req.body || {};

    const result = await readStampaPortaleViaBrowser({
      username: creds.username,
      password: creds.password,
      pin: creds.pin,
      stampaType,
      sessionIndex,
      candidateIndex,
      marcaOperativa,
      dataDa,
      dataA,
      stato,
    });

    if (result?.success && (result?.html || result?.pdfBase64)) {
      return res.json({
        success: true,
        html: result.html || "",
        pdfBase64: result.pdfBase64 || "",
        isPdf: !!result.isPdf,
        stampaType: result.stampaType,
      });
    }
    return res.json({ success: false, error: "Nessun documento restituito dal portale" });
  } catch (err) {
    console.error("[stampaPortale] Errore:", err.message);
    return res.status(500).json({ success: false, error: err.message });
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
  // spostate da server.js
  sessioniPreview,
  prenotazioneCandidato,
  importByPatente: importByPatenteCtrl,
  import: importGeneric,
  // verbali + sessioni aggiuntive
  verbali,
  sessioniApprovate,
  sessioniCqc,
  // prenotazione diretta senza captcha
  prenotazioneDiretta,
  // verifica pratica
  verificaPratica,
  // diagnostica
  diagnostica,
  // dettaglio sessione (replica DETTAGLIO portale)
  sessioneDettaglio,
  // cache dettagli sessioni
  // stampa ufficiale portale
  stampaPortale,
  sessioneDettaglioCache: async (req, res) => {
    const cache = require("../services/sessioniDettaglioCache");
    try {
      const dataDa = String(req.query?.dataDa || req.body?.dataDa || "").trim();
      const dataA = String(req.query?.dataA || req.body?.dataA || "").trim();
      const tipoEsame = String(req.query?.tipoEsame || req.body?.tipoEsame || "").trim();
      const data = await cache.getCacheByDateRange({ dataDa, dataA, tipoEsame });
      res.json({ success: true, count: data.length, dettagli: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
};
