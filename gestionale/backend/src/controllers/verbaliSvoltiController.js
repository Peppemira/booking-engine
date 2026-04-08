/**
 * VerbaliSvoltiController — API per verbali svolti con archivio storico.
 *
 * Endpoints:
 *   GET  /api/verbali-svolti           — ricerca locale con filtri avanzati
 *   GET  /api/verbali-svolti/stats     — statistiche per anno
 *   GET  /api/verbali-svolti/sync-status — stato sincronizzazione
 *   POST /api/verbali-svolti/sync      — sincronizza range dal portale e salva in DB
 *   POST /api/verbali-svolti/sync-storico — sync storico completo (SSE stream)
 *   POST /api/verbali-svolti/auto-sync — sync intelligente: scarica solo periodi mancanti
 */

const verbaliService = require("../services/verbaliSvoltiService");
const cheerio = require("cheerio");

// ─── Helper: genera chunk di date da 7 giorni ─────────────────────────────────

function dateChunks(fromStr, toStr, maxDays = 7) {
  const chunks = [];
  let current = new Date(fromStr + "T00:00:00Z");
  const end = new Date(toStr + "T00:00:00Z");

  while (current <= end) {
    const chunkEnd = new Date(current);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    chunks.push({
      from: current.toISOString().slice(0, 10),
      to: chunkEnd.toISOString().slice(0, 10),
    });

    current = new Date(chunkEnd);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return chunks;
}

function isoToDDMMYYYY(iso) {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Parse HTML table dal portale ─────────────────────────────────────────────

function parsePortalTable(rawHtml) {
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
  return { righe, intestazioni };
}

// ─── Prepara sessione portale (login una volta, riusa per tutti i chunk) ──────

async function preparePortalSession(req) {
  const { resolvePortalCredentials } = require("../server/portalHelpers");
  const { makeHttpClient, readVerbali } = require("../connector/portalHttp");
  const { getOrLoginJarFast, readPortalSearchViaBrowser } = require("../connector/portalSession");

  const creds = await resolvePortalCredentials(req);
  const skipHttp = String(process.env.PORTAL_BROWSER_PERSISTENT || "").toLowerCase() === "true";

  let client = null;
  if (!skipHttp) {
    try {
      const jar = await getOrLoginJarFast(creds);
      client = makeHttpClient(jar);
    } catch (err) {
      console.warn("[verbaliSync] Login HTTP fallito, userà browser fallback:", err.message);
    }
  }

  return { creds, client, readVerbali, readPortalSearchViaBrowser };
}

// ─── Tipi esame da sincronizzare ─────────────────────────────────────────────
const TIPO_ESAME_VALUES = ["QUIZ", "GUIDA", "ORALE", "SCRITTO"];

// ─── Chiama portale per verbali (riusa sessione già aperta) ───────────────────

async function fetchVerbaliFromPortal(session, tipo, dataFrom, dataTo, tipoEsame) {
  const { creds, client, readVerbali, readPortalSearchViaBrowser } = session;
  const ddmmFrom = isoToDDMMYYYY(dataFrom);
  const ddmmTo = isoToDDMMYYYY(dataTo);

  let html = "";
  let httpError = null;

  if (client) {
    try {
      html = await readVerbali(client, {
        tipo,
        tipoEsame: tipoEsame || "",
        dataFrom: ddmmFrom,
        dataTo: ddmmTo,
        codUfficio: process.env.PORTAL_UFFICIO_MCTC || "",
        trace: [],
      });
    } catch (err) {
      httpError = err;
    }
  } else {
    httpError = new Error("no HTTP client");
  }

  let parsed = html ? parsePortalTable(html) : { righe: [], intestazioni: [] };

  // Browser fallback — SOLO quando HTTP fallisce (errore connessione/login),
  // NON quando ritorna 0 risultati (risultato legittimo per GUIDA/ORALE/SCRITTO).
  // Il browser fallback non supporta il filtro tipoEsame, quindi usarlo per risultati
  // vuoti causerebbe la sostituzione con dati QUIZ (tipo default del portale).
  const BROWSER_TYPES = ["VAC", "VSC", "VAQ", "VSQ", "VSR"];
  if (BROWSER_TYPES.includes(tipo) && httpError) {
    console.warn(`[verbaliSync] HTTP fallito per ${tipoEsame || "ALL"} ${dataFrom}-${dataTo}: ${httpError.message}, provo browser...`);
    try {
      const browserHtml = await readPortalSearchViaBrowser(tipo, {
        ...creds,
        trace: [],
        dateFrom: ddmmFrom,
        dateTo: ddmmTo,
      });
      parsed = parsePortalTable(browserHtml);
    } catch { /* ignore browser error */ }
  }

  return parsed;
}

/**
 * Scarica verbali per TUTTI i tipi esame (QUIZ, GUIDA, ORALE, SCRITTO) per un dato chunk.
 * Ritorna l'aggregato di tutte le righe trovate.
 */
async function fetchAllTipiEsame(session, tipo, dataFrom, dataTo) {
  let allRighe = [];
  let intestazioni = [];

  for (const tipoEsame of TIPO_ESAME_VALUES) {
    try {
      const parsed = await fetchVerbaliFromPortal(session, tipo, dataFrom, dataTo, tipoEsame);
      if (parsed.righe && parsed.righe.length > 0) {
        allRighe = allRighe.concat(parsed.righe);
        if (!intestazioni.length && parsed.intestazioni.length) {
          intestazioni = parsed.intestazioni;
        }
      }
    } catch (err) {
      // Continua con gli altri tipi se uno fallisce
      console.warn(`[verbaliSync] Errore fetch ${tipoEsame} ${dataFrom}-${dataTo}:`, err.message);
    }
    // Piccola pausa tra tipi per non sovraccaricare il portale
    await new Promise((r) => setTimeout(r, 200));
  }

  return { righe: allRighe, intestazioni };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/verbali-svolti — ricerca locale ─────────────────────────────────

async function searchVerbali(req, res) {
  try {
    const result = await verbaliService.search({
      autoscuolaId: req.autoscuolaId,
      tipoVerbale: req.query.tipoVerbale || req.query.tipo_verbale || "",
      dataFrom: req.query.dataFrom || req.query.data_from,
      dataTo: req.query.dataTo || req.query.data_to,
      tipoEsame: req.query.tipoEsame || req.query.tipo_esame,
      fasciaOraria: req.query.fasciaOraria || req.query.fascia_oraria,
      numeroVerbale: req.query.numeroVerbale || req.query.numero_verbale,
      ufficioProv: req.query.ufficioProv || req.query.ufficio_prov,
      codiceLocalita: req.query.codiceLocalita || req.query.codice_localita,
      codEsaminatore: req.query.codEsaminatore || req.query.cod_esaminatore,
      annoVerbale: req.query.annoVerbale || req.query.anno_verbale,
      statoVerbale: req.query.statoVerbale || req.query.stato_verbale,
      limit: parseInt(req.query.limit || "500", 10),
      offset: parseInt(req.query.offset || "0", 10),
      orderBy: req.query.orderBy || "data_verbale",
      orderDir: req.query.orderDir || "desc",
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── GET /api/verbali-svolti/find — cerca un verbale specifico nel DB locale ──

async function findVerbale(req, res) {
  try {
    const record = await verbaliService.findVerbale(req.autoscuolaId, {
      dataVerbale: req.query.dataVerbale || req.query.data_verbale,
      numeroVerbale: req.query.numeroVerbale || req.query.numero_verbale,
      ufficioProv: req.query.ufficioProv || req.query.ufficio_prov,
      tipoEsameCodice: req.query.tipoEsameCodice || req.query.tipo_esame_codice,
    });
    res.json({ found: !!record, record: record || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── GET /api/verbali-svolti/stats ────────────────────────────────────────────

async function getStats(req, res) {
  try {
    const tipoVerbale = req.query.tipoVerbale || req.query.tipo_verbale || "";
    const result = await verbaliService.stats(req.autoscuolaId, tipoVerbale);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── GET /api/verbali-svolti/sync-status ──────────────────────────────────────

async function getSyncStatusEndpoint(req, res) {
  try {
    const tipo = req.query.tipo || "VSC";
    const status = await verbaliService.getSyncStatus(req.autoscuolaId, tipo);
    res.json({
      status: status || null,
      needsFullSync: !status || !status.full_sync_completed,
      needsUpdate: status ? needsUpdate(status) : true,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** Controlla se serve un aggiornamento (ultimo sync > 1 ora fa o sync_to < oggi) */
function needsUpdate(status) {
  if (!status || !status.last_sync_at) return true;
  const lastSync = new Date(status.last_sync_at);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (lastSync.getTime() < hourAgo) return true;
  if (status.sync_to && status.sync_to < todayISO()) return true;
  return false;
}

// ─── POST /api/verbali-svolti/sync — sync singolo range ──────────────────────

async function syncRange(req, res) {
  try {
    const { dataFrom, dataTo, tipo } = req.body || {};
    if (!dataFrom || !dataTo) {
      return res.status(400).json({ error: "dataFrom e dataTo sono obbligatori (YYYY-MM-DD)" });
    }

    const tipoNorm = (tipo || "VSC").toUpperCase();
    const autoscuolaId = req.autoscuolaId;
    const session = await preparePortalSession(req);
    const chunks = dateChunks(dataFrom, dataTo);
    const batchId = `sync_${Date.now()}`;
    let totalInserted = 0;
    const errors = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        // Scarica tutti i tipi esame per ogni chunk
        const portalData = await fetchAllTipiEsame(session, tipoNorm, chunk.from, chunk.to);
        if (portalData.righe && portalData.righe.length > 0) {
          const result = await verbaliService.upsertVerbali(
            autoscuolaId, portalData.righe, portalData.intestazioni, batchId, tipoNorm
          );
          totalInserted += result.inserted;
        }
      } catch (chunkErr) {
        errors.push({ chunk, error: chunkErr.message });
      }
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 300));
    }

    // Aggiorna sync status
    try {
      const currentStatus = await verbaliService.getSyncStatus(autoscuolaId, tipoNorm);
      const syncedRanges = verbaliService.addSyncedRange(
        currentStatus?.synced_ranges || [], dataFrom, dataTo
      );
      await verbaliService.updateSyncStatus(autoscuolaId, tipoNorm, {
        last_sync_at: new Date().toISOString(),
        sync_to: dataTo > (currentStatus?.sync_to || "") ? dataTo : currentStatus?.sync_to,
        sync_from: !currentStatus?.sync_from || dataFrom < currentStatus.sync_from ? dataFrom : currentStatus.sync_from,
        synced_ranges: syncedRanges,
        total_verbali_synced: (currentStatus?.total_verbali_synced || 0) + totalInserted,
        total_chunks_processed: (currentStatus?.total_chunks_processed || 0) + chunks.length,
      });
    } catch (e) {
      console.warn("[verbaliSync] Errore aggiornamento sync status:", e.message);
    }

    res.json({
      ok: true,
      batchId,
      totalChunks: chunks.length,
      totalInserted,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/verbali-svolti/auto-sync — sync intelligente ──────────────────
/**
 * Sync intelligente con scoperta automatica dell'anno di inizio.
 * Scarica separatamente per ogni tipo esame (QUIZ, GUIDA, ORALE, SCRITTO)
 * in passaggi distinti per mantenere velocità e stabilità.
 *
 * STRATEGIA FULL SYNC:
 *   Fase 1 "Scoperta" — va a ritroso anno per anno dall'anno corrente.
 *   Fase 2 "Download" — per ogni tipo esame (QUIZ, GUIDA, ORALE, SCRITTO),
 *     scarica tutto dal primo anno trovato fino ad oggi.
 *
 * STRATEGIA INCREMENTALE:
 *   Se il full sync è già completato, scarica solo dall'ultimo sync_to ad oggi
 *   per tutti i tipi esame.
 */
async function autoSync(req, res) {
  const tipo = (req.body?.tipo || "VSC").toUpperCase();
  const forceFullSync = req.body?.forceFullSync === true;
  const autoscuolaId = req.autoscuolaId;

  // Setup SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  // Keep-alive: evita timeout inviando commenti SSE ogni 25 secondi
  const keepAlive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch {}
  }, 25000);

  try {
    let currentStatus = await verbaliService.getSyncStatus(autoscuolaId, tipo);
    const today = todayISO();
    const HISTORIC_FROM = `${verbaliService.ANNO_INIZIO_PORTALE}-01-01`;

    // Login una volta all'inizio
    send({ type: "info", message: "Connessione al Portale dell'Automobilista..." });
    const session = await preparePortalSession(req);
    send({ type: "info", message: "Connesso." });

    // ═══════════════════════════════════════════════════════════════════
    // RANGE SEMPRE COMPLETO: dal 2006 a oggi.
    // computeMissingRanges salta automaticamente i periodi già scaricati.
    // Se synced_ranges copre già 2006→oggi, restano solo gli ultimi giorni.
    // ═══════════════════════════════════════════════════════════════════
    const globalFrom = HISTORIC_FROM;
    const globalTo = today;
    const syncedRanges_input = forceFullSync ? [] : (currentStatus?.synced_ranges || []);

    send({ type: "info", message: `Sync: ${globalFrom} → ${globalTo} (periodi già scaricati verranno saltati)`, mode: "full" });

    // ═══════════════════════════════════════════════════════════════════
    // DOWNLOAD — passaggi separati per tipo esame
    // ═══════════════════════════════════════════════════════════════════

    const batchId = `auto_${Date.now()}`;
    let grandTotalInserted = 0;
    let syncedRanges = [...(syncedRanges_input || [])];
    let totalChunksProcessed = 0;

    for (let te = 0; te < TIPO_ESAME_VALUES.length; te++) {
      const tipoEsame = TIPO_ESAME_VALUES[te];
      send({ type: "info", message: `Scaricamento verbali ${tipoEsame} (${te + 1}/${TIPO_ESAME_VALUES.length})...`, tipoEsame });

      // Calcola chunk MANCANTI — i periodi già in synced_ranges vengono saltati
      const missingRanges = verbaliService.computeMissingRanges(globalFrom, globalTo, syncedRanges);
      let allChunks = [];
      for (const range of missingRanges) {
        allChunks = allChunks.concat(dateChunks(range.from, range.to));
      }

      // Se tutto è già coperto, scarica solo l'ultima settimana per catturare verbali nuovi
      if (!allChunks.length) {
        const lastWeek = new Date(today + "T00:00:00Z");
        lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
        allChunks = dateChunks(lastWeek.toISOString().slice(0, 10), today);
      }

      if (!allChunks.length) {
        send({ type: "info", message: `${tipoEsame}: nessun periodo da scaricare, skip.` });
        continue;
      }

      send({ type: "start", totalChunks: allChunks.length, globalFrom, globalTo, tipoEsame });

      let typeInserted = 0;

      // Processa chunk in batch paralleli di 3
      const BATCH_SIZE = 3;
      for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE);

        batch.forEach((chunk, j) => {
          send({ type: "progress", chunk: i + j + 1, total: allChunks.length, from: chunk.from, to: chunk.to, tipoEsame });
        });

        const results = await Promise.allSettled(
          batch.map(async (chunk) => {
            const portalData = await fetchVerbaliFromPortal(session, tipo, chunk.from, chunk.to, tipoEsame);
            const count = portalData.righe ? portalData.righe.length : 0;
            let inserted = 0;
            if (count > 0) {
              const result = await verbaliService.upsertVerbali(
                autoscuolaId, portalData.righe, portalData.intestazioni, batchId, tipo
              );
              inserted = result.inserted;
            }
            return { chunk, count, inserted };
          })
        );

        for (const r of results) {
          if (r.status === "fulfilled") {
            const { chunk, count, inserted } = r.value;
            typeInserted += inserted;
            grandTotalInserted += inserted;
            // Aggiorna synced_ranges per TUTTI i tipi esame (non solo QUIZ)
            syncedRanges = verbaliService.addSyncedRange(syncedRanges, chunk.from, chunk.to);
            totalChunksProcessed++;
            send({
              type: "chunk_done",
              chunk: i + results.indexOf(r) + 1,
              total: allChunks.length,
              from: chunk.from,
              to: chunk.to,
              found: count,
              totalInserted: grandTotalInserted,
              tipoEsame,
            });
          } else {
            totalChunksProcessed++;
            send({
              type: "chunk_error",
              chunk: i + results.indexOf(r) + 1,
              error: r.reason?.message || "Errore",
              tipoEsame,
            });
          }
        }

        // Salva progresso ogni 5 batch (più frequente = meno lavoro perso)
        if ((i % (BATCH_SIZE * 5)) === 0 && i > 0) {
          try {
            await verbaliService.updateSyncStatus(autoscuolaId, tipo, {
              synced_ranges: syncedRanges,
              sync_from: globalFrom,
              sync_to: globalTo,
              total_verbali_synced: (currentStatus?.total_verbali_synced || 0) + grandTotalInserted,
              total_chunks_processed: (currentStatus?.total_chunks_processed || 0) + totalChunksProcessed,
              last_sync_at: new Date().toISOString(),
            });
          } catch {}
        }

        if (i + BATCH_SIZE < allChunks.length) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      send({ type: "info", message: `${tipoEsame}: completato — ${typeInserted} nuovi verbali`, tipoEsame });

      // Salva progresso DOPO ogni tipo esame completato (così non si perde il lavoro)
      try {
        await verbaliService.updateSyncStatus(autoscuolaId, tipo, {
          synced_ranges: syncedRanges,
          sync_from: globalFrom < (currentStatus?.sync_from || globalFrom) ? globalFrom : (currentStatus?.sync_from || globalFrom),
          sync_to: globalTo,
          total_verbali_synced: (currentStatus?.total_verbali_synced || 0) + grandTotalInserted,
          total_chunks_processed: (currentStatus?.total_chunks_processed || 0) + totalChunksProcessed,
          last_sync_at: new Date().toISOString(),
        });
      } catch {}

      // Pausa tra i passaggi per tipo
      if (te < TIPO_ESAME_VALUES.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SALVA STATO FINALE — marca full_sync_completed = true
    // ═══════════════════════════════════════════════════════════════════

    await verbaliService.updateSyncStatus(autoscuolaId, tipo, {
      sync_from: globalFrom < (currentStatus?.sync_from || globalFrom) ? globalFrom : (currentStatus?.sync_from || globalFrom),
      sync_to: globalTo,
      last_sync_at: new Date().toISOString(),
      full_sync_completed: true,
      full_sync_completed_at: !currentStatus?.full_sync_completed ? new Date().toISOString() : currentStatus.full_sync_completed_at,
      synced_ranges: syncedRanges,
      total_verbali_synced: (currentStatus?.total_verbali_synced || 0) + grandTotalInserted,
      total_chunks_processed: (currentStatus?.total_chunks_processed || 0) + totalChunksProcessed,
    });

    send({ type: "complete", totalInserted: grandTotalInserted, batchId, totalChunks: totalChunksProcessed, from: globalFrom, to: globalTo });
  } catch (e) {
    send({ type: "error", error: e.message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}

// ─── POST /api/verbali-svolti/sync-storico (legacy, rimane per compatibilità) ─

async function syncStorico(req, res) {
  // Redirect to auto-sync
  req.body = { ...req.body, forceFullSync: true };
  return autoSync(req, res);
}

module.exports = { searchVerbali, findVerbale, syncRange, syncStorico, autoSync, getStats, getSyncStatusEndpoint };
