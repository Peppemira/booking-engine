require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const supabase = require("./database/supabase");
const { sendBookingNotification } = require("./telegra");
const PortalSession = require("./connector/portalSession");
const { loginAndGetJar } = require("./connector/portalSession");
const { makeHttpClient, loadMenu, readSituazioneCandidati, readSessioniQuizInterne, getSessionPageDiagnostics } = require("./connector/portalHttp");
const { parsePortalCandidates } = require("./parser/candidateParser");
const { parseSessioni, parseSessioniReadOnly } = require("./parser/sessionParser");
const { importByPatente, importCandidate, importMassivo, searchCandidates } = require("./connector/importByPatente");
const { getSearchSettings, saveSearchSettings, getNextSearchWindow } = require("./server/searchSettings");
const { getEngineStatus, saveEngineStatus } = require("./server/engineStatus");
const { getImportHistory, addImportHistory } = require("./server/importHistory");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "booking-engine-backend", ts: new Date().toISOString() });
});

function buildRemoteCaptureLink(req, token = "") {
  const configuredBase = String(process.env.FRONTEND_PUBLIC_BASE || "").trim();
  const origin = String(req?.headers?.origin || "").trim();
  const hostBase = req ? `${req.protocol}://${req.get("host")}` : "";
  const lanHost = getLocalLanIpv4();
  const rewriteLocalHost = (raw = "") => {
    const value = String(raw || "").trim();
    if (!value || !lanHost) return value;
    try {
      const parsed = new URL(value);
      const host = String(parsed.hostname || "").toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        parsed.hostname = lanHost;
      }
      return parsed.toString();
    } catch {
      return value;
    }
  };

  const base = rewriteLocalHost(configuredBase || origin || hostBase);
  const apiBase = String(rewriteLocalHost(hostBase) || "").replace(/\/$/, "");
  return `${String(base || "").replace(/\/$/, "")}/acquisizione-remota?token=${encodeURIComponent(token)}${apiBase ? `&apiBase=${encodeURIComponent(apiBase)}` : ""}`;
}

function isPrivateIpv4(ip = "") {
  const value = String(ip || "").trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  if (value.startsWith("10.")) return true;
  if (value.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  return false;
}

function getLocalLanIpv4() {
  const interfaces = os.networkInterfaces();
  const preferred = [];
  const fallback = [];

  Object.values(interfaces || {}).forEach((rows = []) => {
    rows.forEach((row = {}) => {
      const family = String(row?.family || "");
      const address = String(row?.address || "").trim();
      const internal = Boolean(row?.internal);
      if (family !== "IPv4" || !address || internal) return;
      if (isPrivateIpv4(address)) preferred.push(address);
      else fallback.push(address);
    });
  });

  return preferred[0] || fallback[0] || "";
}

function normalizeRemoteCapturePayload(input = {}) {
  const documents = Array.isArray(input?.documenti_acquisiti) ? input.documenti_acquisiti.slice(0, 20) : [];
  return {
    updatedAt: new Date().toISOString(),
    ncf_mobile: String(input?.ncf_mobile || "").trim(),
    foto_data_url: String(input?.foto_data_url || "").trim(),
    firma_data_url: String(input?.firma_data_url || "").trim(),
    documenti_acquisiti: documents.map((doc = {}) => ({
      name: String(doc?.name || "").trim(),
      mimeType: String(doc?.mimeType || "application/octet-stream").trim(),
      dataUrl: String(doc?.dataUrl || "").trim(),
    })),
  };
}

function mergeRemoteCapturePayload(existing = {}, incoming = {}, appendDocuments = false) {
  const currentDocs = Array.isArray(existing?.documenti_acquisiti) ? existing.documenti_acquisiti : [];
  const nextDocs = Array.isArray(incoming?.documenti_acquisiti) ? incoming.documenti_acquisiti : [];

  return {
    updatedAt: String(incoming?.updatedAt || new Date().toISOString()),
    ncf_mobile: String(incoming?.ncf_mobile || existing?.ncf_mobile || "").trim(),
    foto_data_url: String(incoming?.foto_data_url || existing?.foto_data_url || "").trim(),
    firma_data_url: String(incoming?.firma_data_url || existing?.firma_data_url || "").trim(),
    documenti_acquisiti: (appendDocuments ? [...currentDocs, ...nextDocs] : nextDocs).slice(0, 20),
  };
}

app.post("/api/remote-capture/sessions", async (req, res) => {
  try {
    const mode = String(req.body?.mode || "cie_mobile").trim() || "cie_mobile";
    const expiresMinutesRaw = Number(req.body?.expiresMinutes);
    const expiresMinutes = Number.isFinite(expiresMinutesRaw)
      ? Math.min(240, Math.max(5, Math.trunc(expiresMinutesRaw)))
      : 30;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();

    let token = "";
    let inserted = null;
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      token = randomUUID();
      const { data, error } = await supabase
        .from("remote_capture_sessions")
        .insert([{
          token,
          mode,
          status: "pending",
          expires_at: expiresAt,
          payload: {},
        }])
        .select("token,expires_at")
        .single();

      if (!error && data) {
        inserted = data;
        break;
      }
      lastError = error;
    }

    if (!inserted) {
      throw new Error(lastError?.message || "Impossibile creare sessione acquisizione remota");
    }

    return res.json({
      success: true,
      token: inserted.token,
      expiresAt: inserted.expires_at,
      link: buildRemoteCaptureLink(req, inserted.token),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore creazione sessione remota" });
  }
});

app.get("/api/remote-capture/sessions/:token", async (req, res) => {
  try {
    const token = String(req.params?.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, error: "Token mancante" });
    }

    const { data, error } = await supabase
      .from("remote_capture_sessions")
      .select("token,status,payload,updated_at,expires_at")
      .eq("token", token)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!data) return res.status(404).json({ success: false, error: "Sessione non trovata" });

    const expired = data.expires_at && new Date(data.expires_at).getTime() < Date.now();
    if (expired) {
      return res.status(410).json({ success: false, error: "Sessione scaduta" });
    }

    return res.json({
      success: true,
      token: data.token,
      status: data.status,
      updatedAt: data.updated_at,
      expiresAt: data.expires_at,
      payload: data.payload || {},
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore lettura sessione remota" });
  }
});

app.get("/remote-capture/:token", async (req, res) => {
  try {
    const token = String(req.params?.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, error: "Token mancante" });
    }

    const { data, error } = await supabase
      .from("remote_capture_sessions")
      .select("token,status,expires_at,updated_at,payload")
      .eq("token", token)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!data) return res.status(404).json({ success: false, error: "Token non valido" });

    const expired = data.expires_at && new Date(data.expires_at).getTime() < Date.now();
    if (expired) {
      return res.status(410).json({ success: false, error: "Sessione scaduta" });
    }

    return res.json({
      success: true,
      token: data.token,
      status: data.status,
      updatedAt: data.updated_at,
      expiresAt: data.expires_at,
      payload: data.payload || {},
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore verifica token remoto" });
  }
});

app.post("/remote-capture/:token", async (req, res) => {
  try {
    const appendDocuments = String(req.query?.append || "").trim() === "1";
    const token = String(req.params?.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, error: "Token mancante" });
    }

    const { data: existing, error: findError } = await supabase
      .from("remote_capture_sessions")
      .select("token,expires_at,payload")
      .eq("token", token)
      .maybeSingle();

    if (findError) return res.status(500).json({ success: false, error: findError.message });
    if (!existing) return res.status(404).json({ success: false, error: "Token non valido" });

    const expired = existing.expires_at && new Date(existing.expires_at).getTime() < Date.now();
    if (expired) {
      return res.status(410).json({ success: false, error: "Sessione scaduta" });
    }

    const payload = normalizeRemoteCapturePayload(req.body || {});
    const mergedPayload = mergeRemoteCapturePayload(existing?.payload || {}, payload, appendDocuments);
    const { data, error } = await supabase
      .from("remote_capture_sessions")
      .update({
        payload: mergedPayload,
        status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("token", token)
      .select("token,updated_at")
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({
      success: true,
      token: data.token,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Errore submit dati remoti" });
  }
});

// Sessione globale del portale (in memoria)
let portalSession = null;

function buildCandidatePayload(candidate = {}) {
  const candidatePayload = {};
  const fields = [
    "autoscuola_id",
    "nome",
    "cognome",
    "codice_fiscale",
    "categoria_patente",
    "patente_numero",
    "telefono",
    "email",
    "tentativi_quiz",
    "stato",
    "data_nascita",
    "comune_nascita",
    "provincia_nascita",
    "codice_autoscuola",
    "raw_portale",
  ];

  fields.forEach((field) => {
    if (candidate[field] !== undefined && candidate[field] !== null && candidate[field] !== "") {
      candidatePayload[field] = candidate[field];
    }
  });

  return candidatePayload;
}

function getMissingCandidateColumn(error) {
  const message = String(error?.message || "");
  const patterns = [
    /Could not find the '([^']+)' column of 'candidates'/i,
    /column\s+"([^"]+)"\s+of relation\s+"candidates"\s+does not exist/i,
    /column\s+([a-zA-Z0-9_]+)\s+does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }

  return "";
}

async function insertCandidateWithFallback(initialPayload = {}) {
  let payload = { ...(initialPayload || {}) };
  const droppedColumns = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase
      .from("candidates")
      .insert([payload])
      .select("*")
      .single();

    if (!error) {
      return { data, droppedColumns };
    }

    const missingColumn = getMissingCandidateColumn(error);
    if (!missingColumn || !(missingColumn in payload)) {
      throw error;
    }

    delete payload[missingColumn];
    droppedColumns.push(missingColumn);
  }

  throw new Error("Impossibile salvare candidato: schema database non compatibile");
}

async function updateCandidateWithFallback(initialPayload = {}, id) {
  let payload = { ...(initialPayload || {}) };
  const droppedColumns = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase
      .from("candidates")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();

    if (!error) {
      return { data, droppedColumns };
    }

    const missingColumn = getMissingCandidateColumn(error);
    if (!missingColumn || !(missingColumn in payload)) {
      throw error;
    }

    delete payload[missingColumn];
    droppedColumns.push(missingColumn);

    if (!Object.keys(payload).length) {
      throw new Error("Nessun campo valido da aggiornare");
    }
  }

  throw new Error("Impossibile aggiornare candidato: schema database non compatibile");
}

async function resolveCandidateId(candidate = {}) {
  if (candidate.candidate_id) {
    return candidate.candidate_id;
  }

  const codiceFiscale = candidate.codice_fiscale || candidate.codice || null;

  if (codiceFiscale) {
    const { data: existingCandidate, error: existingCandidateError } = await supabase
      .from("candidates")
      .select("id")
      .eq("codice_fiscale", codiceFiscale)
      .maybeSingle();

    if (existingCandidateError) {
      throw existingCandidateError;
    }

    if (existingCandidate?.id) {
      return existingCandidate.id;
    }
  }

  const candidatePayload = buildCandidatePayload({
    ...candidate,
    codice_fiscale: codiceFiscale || candidate.codice_fiscale,
  });

  if (!candidatePayload.nome || !candidatePayload.cognome) {
    throw new Error("candidate_id mancante e dati candidato insufficienti per crearlo");
  }

  const { data: createdCandidate, error: createCandidateError } = await supabase
    .from("candidates")
    .insert([candidatePayload])
    .select("id")
    .single();

  if (createCandidateError) {
    throw createCandidateError;
  }

  return createdCandidate.id;
}

async function addCandidatesToBookingList(candidateIds = []) {
  const normalizedIds = Array.from(new Set((candidateIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const linked = [];

  for (let index = 0; index < normalizedIds.length; index += 1) {
    const candidateId = normalizedIds[index];
    const priority = index + 1;

    const { data: existing, error: existingError } = await supabase
      .from("waitlist")
      .select("id")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from("waitlist")
        .update({
          status: "pending",
          priority,
          last_error: null,
          last_attempt_at: null,
        })
        .eq("id", existing.id)
        .select("id,candidate_id,priority,status")
        .single();

      if (updateError) {
        throw updateError;
      }

      linked.push(updated);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("waitlist")
      .insert([{ candidate_id: candidateId, status: "pending", priority }])
      .select("id,candidate_id,priority,status")
      .single();

    if (insertError) {
      throw insertError;
    }

    linked.push(inserted);
  }

  return linked;
}

/* ===============================
   API
=================================*/

app.get("/api/waitlist", async (req, res) => {
  const { data, error } = await supabase
    .from("waitlist")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

app.get("/api/admin/waitlist-integrity", async (req, res) => {
  const { data, error } = await supabase
    .from("waitlist")
    .select("id, candidate_id, created_at, candidates(id)")
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const anomalies = rows.filter(
    (row) => !row.candidate_id || !row.candidates?.id
  );

  res.json({
    total: rows.length,
    anomalies: anomalies.length,
    ok: anomalies.length === 0,
    details: anomalies,
  });
});

app.get("/api/search-settings", async (req, res) => {
  try {
    const settings = await getSearchSettings();
    const status = getNextSearchWindow(settings);
    res.json({ ...settings, ...status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/search-settings", async (req, res) => {
  try {
    const saved = await saveSearchSettings(req.body || {});
    const status = getNextSearchWindow(saved);
    res.json({ success: true, settings: { ...saved, ...status } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/engine-status", async (req, res) => {
  try {
    const status = await getEngineStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/import-history", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const status = String(req.query.status || "all").toLowerCase();
    const type = String(req.query.type || "all").toLowerCase();
    const history = await getImportHistory(Math.max(limit, 200));

    const filtered = history.filter((row) => {
      const statusOk = status === "all" || String(row.status || "").toLowerCase() === status;
      const typeOk = type === "all" || String(row.type || "").toLowerCase() === type;
      return statusOk && typeOk;
    }).slice(0, limit);

    res.json({ success: true, history: filtered });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/import-history/export", async (req, res) => {
  try {
    const status = String(req.query.status || "all").toLowerCase();
    const type = String(req.query.type || "all").toLowerCase();
    const history = await getImportHistory(200);

    const filtered = history.filter((row) => {
      const statusOk = status === "all" || String(row.status || "").toLowerCase() === status;
      const typeOk = type === "all" || String(row.type || "").toLowerCase() === type;
      return statusOk && typeOk;
    });

    const filename = `import-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.send(JSON.stringify(filtered, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/search-settings/force-run", async (req, res) => {
  try {
    const enginePath = path.join(__dirname, "engine.js");

    const child = spawn(process.execPath, [enginePath], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        ENGINE_FORCE_RUN: "true",
        ENGINE_LOOP: "false",
      },
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    await saveEngineStatus({
      running: true,
      lastStartedAt: new Date().toISOString(),
      lastResult: "manual-triggered",
      lastMessage: "Esecuzione manuale avviata",
      lastCandidateId: null,
      trigger: "manual",
      pid: child.pid,
    });

    res.json({
      success: true,
      message: "Esecuzione manuale avviata",
      pid: child.pid,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/portal/sessioni-preview", async (req, res) => {
  try {
    const rawFilters = req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : {};
    const normalizedFilters = {
      stato: String(rawFilters?.stato || "").trim().toUpperCase(),
    };

    const username = process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
    const password = process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
    const pin = process.env.PORTAL_PIN || null;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Credenziali portale mancanti (PORTAL_USER/PORTAL_PASS)",
      });
    }

    const jar = await loginAndGetJar({ username, password, pin });
    const client = makeHttpClient(jar);

    try {
      await loadMenu(client);
    } catch (_menuError) {
    }
    const html = await readSessioniQuizInterne(client, {
      searchFilters: {
        stato: normalizedFilters.stato,
      },
    });
    const parsedByForm = parseSessioni(html);
    const parsedReadOnly = parseSessioniReadOnly(html);
    const pageDiagnostics = getSessionPageDiagnostics(html);

    const sessionKey = (item) => {
      const sessionId = String(item?.sessionId || "").trim().toLowerCase();
      const data = String(item?.dataIpotetica || item?.data || "").replace(/\s+/g, " ").trim().toLowerCase();
      const tipo = String(item?.tipoEsame || "").replace(/\s+/g, " ").trim().toLowerCase();
      const aula = String(item?.aula || "").replace(/\s+/g, " ").trim().toLowerCase();
      const amPm = String(item?.amPm || "").replace(/\s+/g, " ").trim().toLowerCase();
      return `${sessionId}|${data}|${tipo}|${aula}|${amPm}`;
    };

    const byKey = new Map();
    for (const item of parsedReadOnly) {
      byKey.set(sessionKey(item), item);
    }
    for (const item of parsedByForm) {
      const key = sessionKey(item);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, item);
        continue;
      }

      byKey.set(key, {
        ...item,
        ...existing,
        action: item.action || existing.action,
        hiddenFields: item.hiddenFields || existing.hiddenFields,
      });
    }

    const sessioniRaw = Array.from(byKey.values());

    const parseInteger = (value) => {
      const parsed = Number.parseInt(String(value || "").replace(/[^0-9-]/g, ""), 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const sessioni = sessioniRaw.map((item) => {
      const statoText = String(item.stato || "").toLowerCase();
      const postiLiberiNum = parseInteger(item.postiLiberi ?? item.posti);
      const totalePostiNum = parseInteger(item.totalePosti);
      const postiAutoscuolaNum = parseInteger(item.postiAutoscuola);
      const propriePrenotazioniNum = parseInteger(item.propriePrenotazioni);

      const explicitlyClosed = /chius|non\s*prenot|scadut|sospes/.test(statoText);
      const explicitlyOpen = /apert|disponib|prenot/.test(statoText);

      let canInsertCandidate = false;

      if (postiAutoscuolaNum !== null && propriePrenotazioniNum !== null) {
        canInsertCandidate = postiAutoscuolaNum > propriePrenotazioniNum;
      } else if (postiLiberiNum !== null) {
        canInsertCandidate = postiLiberiNum > 0;
      } else {
        canInsertCandidate = explicitlyOpen;
      }

      if (explicitlyClosed) {
        canInsertCandidate = false;
      }

      const sedutaStato = canInsertCandidate ? "APERTA" : "CHIUSA";

      return {
        ...item,
        postiLiberi: item.postiLiberi ?? item.posti ?? "",
        canInsertCandidate,
        sedutaStato,
        postiLiberiNum,
        totalePostiNum,
        postiAutoscuolaNum,
        propriePrenotazioniNum,
      };
    });

    const filteredSessioni = sessioni.filter((item) => {
      const requested = normalizedFilters.stato;
      if (!requested) return true;

      const sedutaStato = String(item?.sedutaStato || "").toUpperCase();
      const rawStato = String(item?.stato || "").toUpperCase();

      if (requested === "APPROVATA") {
        return rawStato.includes("APPROVAT");
      }

      if (requested === "APERTA" || requested === "CHIUSA") {
        if (sedutaStato) return sedutaStato === requested;
        return rawStato.includes(requested);
      }

      return `${sedutaStato} ${rawStato}`.includes(requested);
    });

    const withSeats = filteredSessioni.filter((item) => item.canInsertCandidate);
    const closedTotal = filteredSessioni.filter((item) => !item.canInsertCandidate).length;
    const approvedTotal = filteredSessioni.filter((item) => /approvat/.test(String(item.stato || "").toLowerCase())).length;

    let candidati = [];
    try {
      const htmlCandidati = await readSituazioneCandidati(client);
      candidati = parsePortalCandidates(htmlCandidati);
    } catch (_candidateError) {
      candidati = [];
    }

    return res.json({
      success: true,
      mode: "read-only",
      searchedAt: new Date().toISOString(),
      total: filteredSessioni.length,
      totalBeforeFilter: sessioni.length,
      withSeats: withSeats.length,
      closedTotal,
      approvedTotal,
      candidatesTotal: candidati.length,
      portalMessage: null,
      diagnostics: pageDiagnostics,
      filtersApplied: normalizedFilters,
      sessioni: filteredSessioni,
      candidati,
    });
  } catch (error) {
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      statusCode === 503
        ? "Portale ministeriale temporaneamente non disponibile (HTTP 503). Riprova tra pochi minuti o in fascia oraria disponibile."
        : (error?.message || "Errore durante la lettura sedute dal portale");

    return res.status(500).json({
      success: false,
      error: errorMessage,
      portalMessage: errorMessage,
    });
  }
});

app.get("/api/candidati/all", async (req, res) => {
  const { data, error } = await supabase
    .from("waitlist")
    .select("id, status, created_at, candidate_id, candidates(nome, cognome, codice_fiscale, data_nascita, comune_nascita, provincia_nascita)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const normalizedData = (data || []).map((row) => ({
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    candidate_id: row.candidate_id,
    nome: row.candidates?.nome || null,
    cognome: row.candidates?.cognome || null,
    codice: row.candidates?.codice_fiscale || null,
    data_nascita: row.candidates?.data_nascita || null,
    comune_nascita: row.candidates?.comune_nascita || null,
    provincia_nascita: row.candidates?.provincia_nascita || null,
  }));

  res.json(normalizedData);
});
app.get("/api/candidates", async (req, res) => {
  const { data, error } = await supabase
    .from("candidates")
    .select("*");

  if (error) {
    return res.status(500).json({ error });
  }

  res.json(data);
});

app.post("/api/candidates", async (req, res) => {
  try {
    const payload = buildCandidatePayload(req.body || {});

    if (!payload.nome || !payload.cognome) {
      return res.status(400).json({ error: "nome e cognome sono obbligatori" });
    }

    const { data, droppedColumns } = await insertCandidateWithFallback(payload);

    return res.json({
      success: true,
      candidate: data,
      droppedColumns,
      schemaWarning: droppedColumns.length ? "Alcuni campi non sono presenti nello schema DB corrente" : undefined,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Errore creazione candidato" });
  }
});

app.put("/api/candidates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const payload = buildCandidatePayload(req.body || {});

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "Nessun campo valido da aggiornare" });
    }

    const { data, droppedColumns } = await updateCandidateWithFallback(payload, id);

    return res.json({
      success: true,
      candidate: data,
      droppedColumns,
      schemaWarning: droppedColumns.length ? "Alcuni campi non sono presenti nello schema DB corrente" : undefined,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Errore modifica candidato" });
  }
});

app.delete("/api/candidates/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("candidates")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      const message = String(error.message || "");
      if (/foreign key|violates/i.test(message)) {
        return res.status(409).json({ error: "Impossibile eliminare: candidato collegato ad altre pratiche" });
      }
      return res.status(500).json({ error: error.message || "Errore eliminazione candidato" });
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: "Candidato non trovato" });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Errore eliminazione candidato" });
  }
});

app.post("/api/waitlist", async (req, res) => {
  const { status, priority } = req.body;

  let candidateId;
  try {
    candidateId = await resolveCandidateId(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message || "candidate_id non valido" });
  }

  const { data, error } = await supabase
    .from("waitlist")
    .insert([{
      candidate_id: candidateId,
      status: status || "pending",
      priority: Number.isFinite(priority) ? priority : 100,
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

app.put("/api/waitlist/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const { error } = await supabase
    .from("waitlist")
    .update({ status })
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

app.post("/api/prenota-esame", async (req, res) => {
  const { nome, cognome, data, categoria, ora, luogo } = req.body;

  // Validazione dati obbligatori
  if (!nome || !cognome || !data || !categoria) {
    return res.status(400).json({ 
      error: "Mancano dati obbligatori: nome, cognome, data, categoria" 
    });
  }

  // Salva in Supabase
  const { data: saved, error } = await supabase
    .from("prenotazioni")
    .insert([{ nome, cognome, data, categoria, ora, luogo }])
    .select();

  if (error) return res.status(500).json({ error: error.message });

  // Invia notifica Telegram
  if (saved && saved.length > 0) {
    const success = await sendBookingNotification({
      nome: saved[0].nome,
      cognome: saved[0].cognome,
      data: saved[0].data,
      categoria: saved[0].categoria,
      ora: saved[0].ora,
      luogo: saved[0].luogo
    });
    
    if (!success) {
      console.warn("Notifica Telegram non inviata per prenotazione:", saved[0].id);
    }
  }

  res.json({ success: true, booking: saved[0] });
});

app.get("/api/prenotazioni", async (req, res) => {
  const { data, error } = await supabase
    .from("prenotazioni")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

app.delete("/api/prenotazioni/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("prenotazioni")
    .delete()
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, message: "Prenotazione annullata" });
});

app.post("/api/waitlist/bulk", async (req, res) => {
  const { candidates } = req.body;

  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ 
      error: "Deve essere fornito un array di candidati" 
    });
  }

  const candidatesToInsert = [];
  for (const candidate of candidates) {
    const candidateId = await resolveCandidateId(candidate);
    candidatesToInsert.push({
      candidate_id: candidateId,
      status: candidate.status || "pending",
      priority: Number.isFinite(candidate.priority) ? candidate.priority : 100,
      created_at: new Date().toISOString(),
    });
  }

  const { data, error } = await supabase
    .from("waitlist")
    .insert(candidatesToInsert)
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ 
    success: true, 
    message: `${data.length} candidati aggiunti alla lista di attesa`,
    candidates: data 
  });
});

/* ===============================
   PORTAL CANDIDATI
=================================*/

app.get("/api/portal-candidati", async (req, res) => {
  try {
    const PortalBrowser = require("./connector/portalBrowser");
    const browser = new PortalBrowser();
    
    console.log("Connessione al portale...");
    await browser.init();
    const loginResult = await browser.login();
    
    console.log("Recupero candidati attivi dal portale...");
    const candidati = await browser.getCandidatiAttivi();
    
    if (browser.browser) {
      await browser.close();
    }

    res.json({
      success: true,
      count: candidati.length,
      candidati: candidati
    });

  } catch (error) {
    console.error("Errore portal candidati:", error.message);
    res.status(500).json({
      success: false,
      error: "Errore nel recupero candidati dal portale: " + error.message
    });
  }
});

app.post("/api/waitlist/from-portal", async (req, res) => {
  const { candidati } = req.body;

  if (!candidati || !Array.isArray(candidati) || candidati.length === 0) {
    return res.status(400).json({ 
      error: "Deve essere fornito un array di candidati dal portale" 
    });
  }

  const candidatiToInsert = [];
  for (const candidate of candidati) {
    const candidateId = await resolveCandidateId({
      nome: candidate.nome,
      cognome: candidate.cognome,
      codice_fiscale: candidate.codice_fiscale || candidate.codice,
      data_nascita: candidate.data_nascita,
      comune_nascita: candidate.comune_nascita,
      provincia_nascita: candidate.provincia_nascita,
    });

    candidatiToInsert.push({
      candidate_id: candidateId,
      status: "pending",
      priority: 100,
      created_at: new Date().toISOString(),
    });
  }

  const { data, error } = await supabase
    .from("waitlist")
    .insert(candidatiToInsert)
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ 
    success: true, 
    message: `${data.length} candidati aggiunti dal portale`,
    candidati: data 
  });
});

app.post("/api/portal/import-candidates", async (req, res) => {
  try {
    const jar = await loginAndGetJar({
      username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
      password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
      pin: process.env.PORTAL_PIN,
    });

    const http = makeHttpClient(jar);
    await loadMenu(http);
    const html = await readSituazioneCandidati(http);

    fs.writeFileSync("portal_candidati.html", html, "utf-8");

    const parsed = parsePortalCandidates(html);
    if (!parsed.length) {
      return res.status(404).json({
        success: false,
        message: "Nessun candidato trovato nella pagina portale",
      });
    }

    const imported = [];
    for (const candidate of parsed) {
      const payload = {
        nome: candidate.nome,
        cognome: candidate.cognome,
        codice_fiscale: candidate.codice_fiscale || `LEGACYIMPORT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        categoria_patente: candidate.categoria_patente || "B",
        tentativi_quiz: Number.isFinite(candidate.tentativi_quiz) ? candidate.tentativi_quiz : 0,
        stato: candidate.stato || "attivo",
      };

      const { data: row, error } = await supabase
        .from("candidates")
        .upsert([payload], { onConflict: "codice_fiscale" })
        .select("id,nome,cognome,codice_fiscale")
        .single();

      if (error) {
        console.error("Errore upsert candidato:", error.message);
        continue;
      }

      imported.push(row);
    }

    res.json({
      success: true,
      parsed: parsed.length,
      imported: imported.length,
      candidates: imported,
    });

    await addImportHistory({
      type: "import-candidates",
      status: "ok",
      parsed: parsed.length,
      imported: imported.length,
      errors: Math.max(0, parsed.length - imported.length),
      message: "Import da situazione candidati completato",
    });
  } catch (error) {
    await addImportHistory({
      type: "import-candidates",
      status: "error",
      errors: 1,
      message: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/portal/import-by-patente", async (req, res) => {
  try {
    const { cognome, numeroPatente, fields, autoSelectForBooking } = req.body || {};

    if (!numeroPatente) {
      return res.status(400).json({
        success: false,
        error: "numeroPatente obbligatorio",
      });
    }

    const row = await importByPatente({
      cognome,
      numeroPatente,
      fields: fields || {},
    });

    let bookingList = [];
    if (autoSelectForBooking !== false && row?.id) {
      bookingList = await addCandidatesToBookingList([row.id]);
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

    res.json({
      success: true,
      candidate: row,
      bookingList,
    });
  } catch (error) {
    await addImportHistory({
      type: "import-by-patente",
      status: "error",
      errors: 1,
      message: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/portal/import", async (req, res) => {
  try {
    const payload = req.body || {};
    const autoSelectForBooking = payload.autoSelectForBooking !== false;
    const result = await importCandidate(payload);

    let bookingList = [];
    if (autoSelectForBooking && result?.id) {
      bookingList = await addCandidatesToBookingList([result.id]);
    }

    await addImportHistory({
      type: "import",
      status: "ok",
      criteria: {
        cognome: payload.cognome,
        numeroPatente: payload.numeroPatente,
        protocolloCertificatoMedico: payload.protocolloCertificatoMedico,
        marcaOperativa: payload.marcaOperativa,
        codiceFiscale: payload.codiceFiscale,
      },
      parsed: 1,
      imported: 1,
      linked: bookingList.length,
      message: "Import singolo completato",
    });

    res.json({ ok: true, result, bookingList });
  } catch (e) {
    await addImportHistory({
      type: "import",
      status: "error",
      errors: 1,
      message: e.message,
    });
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/portal/search-results", async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await searchCandidates(payload);
    res.json({
      success: true,
      count: result.results.length,
      results: result.results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/portal/import-massivo", async (req, res) => {
  try {
    const payload = req.body || {};
    const autoSelectForBooking = payload.autoSelectForBooking !== false;

    const result = await importMassivo(payload);
    const importedIds = (result.imported || []).map((row) => row?.id).filter(Boolean);

    let bookingList = [];
    if (autoSelectForBooking && importedIds.length) {
      bookingList = await addCandidatesToBookingList(importedIds);
    }

    await addImportHistory({
      type: "import-massivo",
      status: "ok",
      criteria: {
        cognome: payload.cognome,
        numeroPatente: payload.numeroPatente,
        protocolloCertificatoMedico: payload.protocolloCertificatoMedico,
        marcaOperativa: payload.marcaOperativa,
        codiceFiscale: payload.codiceFiscale,
      },
      parsed: result.parsed,
      imported: result.imported.length,
      linked: bookingList.length,
      errors: Array.isArray(result.errors) ? result.errors.length : 0,
      message: "Import massivo completato",
    });

    res.json({
      success: true,
      parsed: result.parsed,
      selected: result.selected,
      imported: result.imported.length,
      importRows: result.imported,
      errors: result.errors,
      bookingLinked: bookingList.length,
      bookingList,
    });
  } catch (error) {
    await addImportHistory({
      type: "import-massivo",
      status: "error",
      errors: 1,
      message: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/waitlist/select", async (req, res) => {
  const { candidateIds } = req.body;

  if (!Array.isArray(candidateIds) || !candidateIds.length) {
    return res.status(400).json({ error: "candidateIds deve essere un array non vuoto" });
  }

  const normalizedIds = candidateIds.map((id) => String(id).trim()).filter(Boolean);
  const selectedRows = [];

  for (let index = 0; index < normalizedIds.length; index += 1) {
    const candidateId = normalizedIds[index];
    const priority = index + 1;

    const { data: existing, error: findError } = await supabase
      .from("waitlist")
      .select("id")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      return res.status(500).json({ error: findError.message });
    }

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from("waitlist")
        .update({
          status: "pending",
          priority,
          last_error: null,
          last_attempt_at: null,
        })
        .eq("id", existing.id)
        .select("id,candidate_id,priority,status")
        .single();

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      selectedRows.push(updated);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("waitlist")
      .insert([{ candidate_id: candidateId, priority, status: "pending" }])
      .select("id,candidate_id,priority,status")
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    selectedRows.push(inserted);
  }

  res.json({
    success: true,
    selected: selectedRows.length,
    waitlist: selectedRows,
  });
});

/* ===============================
   PORTAL AUTHENTICATION
=================================*/

app.post("/api/portal-login", async (req, res) => {
  const { username, password, pin } = req.body;

  if (!username || !password || !pin) {
    return res.status(400).json({ 
      error: "Username, password e PIN sono obbligatori" 
    });
  }

  try {
    // Crea una nuova sessione se non esiste
    if (!portalSession) {
      portalSession = new PortalSession();
    } else {
      // Resetta la sessione precedente
      portalSession = new PortalSession();
    }

    // Effettua il login
    const success = await portalSession.login(username, password, pin);

    if (!success) {
      portalSession = null;
      return res.status(401).json({ 
        error: "Credenziali non valide" 
      });
    }

    res.json({ 
      success: true, 
      message: "Login riuscito",
      username: username
    });

  } catch (err) {
    console.error("Errore login portale:", err.message);
    res.status(500).json({ 
      error: "Errore durante il login: " + err.message 
    });
  }
});

app.post("/api/portal-logout", async (req, res) => {
  try {
    if (portalSession) {
      await portalSession.logout();
      portalSession = null;
    }

    res.json({ 
      success: true, 
      message: "Logout riuscito" 
    });

  } catch (err) {
    console.error("Errore logout portale:", err.message);
    res.status(500).json({ 
      error: "Errore durante il logout: " + err.message 
    });
  }
});

app.get("/api/portal-status", async (req, res) => {
  try {
    if (!portalSession) {
      return res.json({ 
        isLogged: false, 
        message: "Nessuna sessione attiva" 
      });
    }

    const valid = await portalSession.isSessionValid();

    res.json({ 
      isLogged: valid, 
      username: portalSession.username 
    });

  } catch (err) {
    console.error("Errore verifica status portale:", err.message);
    res.status(500).json({ 
      error: "Errore durante la verifica: " + err.message 
    });
  }
});

/* ===============================
   DASHBOARD PROFESSIONALE
=================================*/

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Booking Engine Dashboard</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f4f6f9;
      padding: 30px;
    }

    h1 {
      margin-bottom: 20px;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
    }

    .card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      flex: 1;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      text-align: center;
    }

    .card h2 {
      margin: 0;
      font-size: 28px;
    }

    .card p {
      margin: 5px 0 0;
      color: gray;
    }

    button {
      padding: 8px 14px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .btn-primary {
      background: #007bff;
      color: white;
    }

    .btn-success {
      background: #28a745;
      color: white;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }

    th, td {
      padding: 12px;
      text-align: left;
    }

    th {
      background: #343a40;
      color: white;
    }

    tr:nth-child(even) {
      background: #f2f2f2;
    }

    .badge {
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      color: white;
    }

    .pending {
      background: #ffc107;
    }

    .completed {
      background: #28a745;
    }
  </style>
</head>
<body>

<h1>Booking Engine Dashboard</h1>

<div style="margin-bottom: 30px; background: #fff3cd; padding: 15px; border-radius: 6px;">
  <h2>🔍 Ricerca Candidati dal Portale</h2>
  <button class="btn-primary" onclick="loadPortalCandidati()" style="margin-bottom: 10px;">Carica Candidati dal Portale</button>
  <div id="portalLoading" style="display: none; margin: 10px 0;">
    <p>⏳ Connessione al portale in corso...</p>
  </div>
  <div id="portalCandidatiContainer" style="display: none;">
    <p><strong>Candidati trovati:</strong> <span id="portalCount">0</span></p>
    <table style="margin-bottom: 15px;">
      <thead>
        <tr>
          <th style="width: 30px;"><input type="checkbox" id="selectAllPortal" onchange="toggleAllPortalCandidati()"></th>
          <th>Nome</th>
          <th>Cognome</th>
          <th>Codice</th>
          <th>Data Nascita</th>
          <th>Comune Nascita</th>
          <th>Provincia</th>
        </tr>
      </thead>
      <tbody id="portalCandidatiTable"></tbody>
    </table>
    <button class="btn-success" onclick="addSelectedPortalCandidati()" style="margin-right: 10px;">Aggiungi Selezionati in Lista di Attesa</button>
    <button class="btn-primary" onclick="clearPortalCandidati()">Cancella</button>
  </div>
</div>

<div style="margin-bottom: 30px; background: #e8f7ff; padding: 15px; border-radius: 6px;">
  <h2>🧩 Import Massivo dal Portale (GECA style)</h2>
  <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
    <input id="portalSearchCognome" placeholder="Cognome" style="padding:8px; border:1px solid #ccc; border-radius:6px; min-width:180px;" />
    <input id="portalSearchPatente" placeholder="Numero patente" style="padding:8px; border:1px solid #ccc; border-radius:6px; min-width:180px;" />
    <input id="portalSearchProtocollo" placeholder="Protocollo medico" style="padding:8px; border:1px solid #ccc; border-radius:6px; min-width:180px;" />
    <input id="portalSearchMarca" placeholder="Marca operativa" style="padding:8px; border:1px solid #ccc; border-radius:6px; min-width:180px;" />
    <input id="portalSearchCf" placeholder="Codice fiscale" style="padding:8px; border:1px solid #ccc; border-radius:6px; min-width:180px;" />
  </div>
  <div style="margin-bottom: 10px;">
    <label><input type="checkbox" id="portalAutoSelectBooking" checked /> Auto-collega in lista prenotazione</label>
  </div>
  <div style="margin-bottom: 10px;">
    <button class="btn-primary" onclick="searchPortalResultsUi()">Cerca</button>
    <button class="btn-success" onclick="importSelectedPortalResultsUi()" style="margin-left: 8px;">Importa Selezionati</button>
    <button class="btn-primary" onclick="clearPortalResultsUi()" style="margin-left: 8px;">Reset</button>
    <span id="portalSearchStatus" style="margin-left: 12px; color: #333;"></span>
  </div>
  <div id="portalSearchResultsContainer" style="display:none;">
    <p><strong>Risultati:</strong> <span id="portalSearchCount">0</span></p>
    <table style="margin-bottom: 10px;">
      <thead>
        <tr>
          <th style="width:30px;"><input type="checkbox" id="selectAllPortalResults" onchange="toggleAllPortalResultsUi()"></th>
          <th>Cognome</th>
          <th>Nome</th>
          <th>Numero patente</th>
        </tr>
      </thead>
      <tbody id="portalSearchResultsTable"></tbody>
    </table>
  </div>
</div>

<div style="margin-bottom: 30px;">
  <h2>Aggiungi Candidati in Massa</h2>
  <textarea id="candidatesInput" placeholder="Inserisci candidati in JSON. Esempio: [{&quot;nome&quot;:&quot;Mario&quot;,&quot;cognome&quot;:&quot;Rossi&quot;},{&quot;nome&quot;:&quot;Luigi&quot;,&quot;cognome&quot;:&quot;Bianchi&quot;}]" style="width: 100%; height: 120px; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-family: monospace;"></textarea>
  <button class="btn-primary" onclick="addCandidatesBulk()" style="margin-top: 10px;">Aggiungi Candidati</button>
  <button class="btn-primary" onclick="toggleJsonHelper()" style="margin-top: 10px;">? Aiuto</button>
  <div id="jsonHelper" style="background: #e7f3ff; padding: 15px; border-radius: 6px; margin-top: 10px; display: none;">
    <p><strong>Formato JSON:</strong></p>
    <pre>[
  { "nome": "Mario", "cognome": "Rossi" },
  { "nome": "Luigi", "cognome": "Bianchi" }
]</pre>
  </div>
</div>

<div style="margin-bottom: 30px; background: #eef6ff; padding: 15px; border-radius: 6px;">
  <h2>⏱️ Parametri Ricerca Sedute</h2>
  <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap; margin-bottom: 10px;">
    <label><input type="checkbox" id="searchEnabled"> Ricerca abilitata</label>
    <label>Ora inizio: <input type="time" id="searchStartTime" value="08:00"></label>
    <label>Ora fine: <input type="time" id="searchEndTime" value="21:00"></label>
  </div>
  <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
    <label><input type="checkbox" class="search-day" value="1"> Lun</label>
    <label><input type="checkbox" class="search-day" value="2"> Mar</label>
    <label><input type="checkbox" class="search-day" value="3"> Mer</label>
    <label><input type="checkbox" class="search-day" value="4"> Gio</label>
    <label><input type="checkbox" class="search-day" value="5"> Ven</label>
    <label><input type="checkbox" class="search-day" value="6"> Sab</label>
    <label><input type="checkbox" class="search-day" value="0"> Dom</label>
  </div>
  <button class="btn-primary" onclick="saveSearchSettingsUi()">Salva Parametri Ricerca</button>
  <button class="btn-success" onclick="forceRunNowUi()" style="margin-left: 10px;">Avvia Ora</button>
  <span id="searchSettingsStatus" style="margin-left: 10px; color: #444;"></span>
  <div id="searchSettingsHint" style="margin-top: 8px; color: #333;"></div>
</div>

<div class="stats">
  <div class="card">
    <h2 id="total">0</h2>
    <p>Candidati in attesa</p>
  </div>
  <div class="card">
    <h2 id="inProgress">0</h2>
    <p>Prenotazioni in corso</p>
  </div>
  <div class="card">
    <h2 id="completed">0</h2>
    <p>Completati</p>
  </div>
  <div class="card">
    <h2 id="bookings">0</h2>
    <p>Prenotazioni</p>
  </div>
  <div class="card">
    <h2 id="integrity">-</h2>
    <p>Integrità waitlist</p>
  </div>
  <div class="card">
    <h2 id="engineState">-</h2>
    <p>Stato Engine</p>
    <p id="engineStateDetails" style="font-size: 12px; color: #666; margin-top: 8px; line-height: 1.4;">-</p>
  </div>
</div>

<div style="margin-bottom: 30px;">
  <h2>Lista di Attesa</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Status</th>
        <th>Creato</th>
        <th>Azione</th>
      </tr>
    </thead>
    <tbody id="waitlistTable"></tbody>
  </table>
</div>

<div style="margin-bottom: 30px;">
  <h2>Prenotazioni</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Nome</th>
        <th>Cognome</th>
        <th>Data</th>
        <th>Categoria</th>
        <th>Creato</th>
        <th>Azione</th>
      </tr>
    </thead>
    <tbody id="bookingsTable"></tbody>
  </table>
</div>

<div style="margin-bottom: 30px;">
  <h2>🕘 Storico Import</h2>
  <div style="margin-bottom: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
    <label>Esito:
      <select id="importHistoryStatusFilter" style="margin-left: 6px; padding: 6px; border: 1px solid #ccc; border-radius: 6px;">
        <option value="all">Tutti</option>
        <option value="ok">OK</option>
        <option value="error">Error</option>
      </select>
    </label>
    <label>Tipo:
      <select id="importHistoryTypeFilter" style="margin-left: 6px; padding: 6px; border: 1px solid #ccc; border-radius: 6px;">
        <option value="all">Tutti</option>
        <option value="import">Import singolo</option>
        <option value="import-by-patente">By patente</option>
        <option value="import-massivo">Massivo</option>
        <option value="import-candidates">Situazione candidati</option>
      </select>
    </label>
    <button class="btn-primary" onclick="loadImportHistoryUi()">Filtra</button>
    <button class="btn-success" onclick="exportImportHistoryUi()">Esporta JSON</button>
  </div>
  <table>
    <thead>
      <tr>
        <th>Quando</th>
        <th>Tipo</th>
        <th>Esito</th>
        <th>Importati</th>
        <th>In Prenotazione</th>
        <th>Errori</th>
        <th>Messaggio</th>
      </tr>
    </thead>
    <tbody id="importHistoryTable"></tbody>
  </table>
</div>

<div style="margin-bottom: 30px;">
  <h2>📋 Tutti i Candidati nel Database</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Nome</th>
        <th>Cognome</th>
        <th>Codice Fiscale</th>
        <th>Categoria Patente</th>
        <th>Tentativi Quiz</th>
        <th>Stato</th>
        <th>Creato</th>
      </tr>
    </thead>
    <tbody id="candidates-table"></tbody>
  </table>
</div>

<div style="margin-bottom: 30px;">
  <h2>📋 Lista di Attesa (Waitlist)</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Nome</th>
        <th>Cognome</th>
        <th>Codice</th>
        <th>Data Nascita</th>
        <th>Comune</th>
        <th>Provincia</th>
        <th>Status</th>
        <th>Creato</th>
      </tr>
    </thead>
    <tbody id="allCandidatiTable"></tbody>
  </table>
</div>

<script>
let portalCandidatiData = [];
let portalSearchResults = [];

function setSearchSettingsStatus(text, isError) {
  const status = document.getElementById('searchSettingsStatus');
  if (!status) return;
  status.innerText = text || '';
  status.style.color = isError ? '#b00020' : '#1f6f43';
}

function applySearchSettingsToUi(settings) {
  document.getElementById('searchEnabled').checked = !!settings.enabled;
  document.getElementById('searchStartTime').value = settings.startTime || '08:00';
  document.getElementById('searchEndTime').value = settings.endTime || '21:00';

  const selectedDays = Array.isArray(settings.days) ? settings.days.map(Number) : [];
  document.querySelectorAll('.search-day').forEach((el) => {
    el.checked = selectedDays.includes(Number(el.value));
  });

  const hint = document.getElementById('searchSettingsHint');
  if (hint) {
    const current = settings.currentSlotLabel || 'n/d';
    const next = settings.nextWindowLabel || 'n/d';
    const state = settings.allowedNow ? 'Attiva ora' : 'Non attiva ora';
    hint.innerText = 'Stato: ' + state + ' · Adesso: ' + current + ' · Prossima finestra: ' + next;
  }
}

async function loadSearchSettingsUi() {
  try {
    const res = await fetch('/api/search-settings');
    if (!res.ok) throw new Error('Impossibile leggere i parametri ricerca');
    const settings = await res.json();
    applySearchSettingsToUi(settings);
    setSearchSettingsStatus('Parametri caricati', false);
  } catch (err) {
    setSearchSettingsStatus('Errore caricamento parametri: ' + err.message, true);
  }
}

async function loadEngineStatusUi() {
  try {
    const res = await fetch('/api/engine-status');
    const status = res.ok ? await res.json() : null;
    const node = document.getElementById('engineState');
    const detailsNode = document.getElementById('engineStateDetails');
    if (!node) return;

    if (!status) {
      node.innerText = 'ERR';
      if (detailsNode) detailsNode.innerText = 'Stato non disponibile';
      return;
    }

    const updated = status.lastUpdatedAt
      ? new Date(status.lastUpdatedAt).toLocaleString('it-IT')
      : '-';
    const candidate = status.lastCandidateId || '-';
    const trigger = status.trigger || '-';
    if (detailsNode) {
      detailsNode.innerText = 'Aggiornato: ' + updated + ' · Candidato: ' + candidate + ' · Trigger: ' + trigger;
    }

    if (status.running) {
      node.innerText = 'RUN';
      return;
    }

    if (status.lastResult === 'ok') {
      node.innerText = 'OK';
      return;
    }

    if (status.lastResult === 'warning') {
      node.innerText = 'WARN';
      return;
    }

    if (status.lastResult === 'error') {
      node.innerText = 'ERR';
      return;
    }

    node.innerText = 'IDLE';
  } catch {
    const node = document.getElementById('engineState');
    const detailsNode = document.getElementById('engineStateDetails');
    if (node) node.innerText = 'ERR';
    if (detailsNode) detailsNode.innerText = 'Errore caricamento stato';
  }
}

async function saveSearchSettingsUi() {
  try {
    const days = Array.from(document.querySelectorAll('.search-day:checked')).map((el) => Number(el.value));
    const payload = {
      enabled: document.getElementById('searchEnabled').checked,
      startTime: document.getElementById('searchStartTime').value,
      endTime: document.getElementById('searchEndTime').value,
      days,
      timezone: 'Europe/Rome'
    };

    const res = await fetch('/api/search-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Salvataggio non riuscito');
    }

    applySearchSettingsToUi(result.settings);
    setSearchSettingsStatus('Parametri salvati', false);
  } catch (err) {
    setSearchSettingsStatus('Errore salvataggio parametri: ' + err.message, true);
  }
}

async function forceRunNowUi() {
  try {
    setSearchSettingsStatus('Avvio manuale in corso...', false);
    const res = await fetch('/api/search-settings/force-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();

    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Avvio manuale non riuscito');
    }

    setSearchSettingsStatus('Avvio manuale effettuato (PID ' + result.pid + ')', false);
  } catch (err) {
    setSearchSettingsStatus('Errore avvio manuale: ' + err.message, true);
  }
}

function toggleJsonHelper() {
  const helper = document.getElementById('jsonHelper');
  helper.style.display = helper.style.display === 'none' ? 'block' : 'none';
}

async function loadPortalCandidati() {
  const loading = document.getElementById('portalLoading');
  loading.style.display = 'block';

  try {
    const res = await fetch('/api/portal-candidati');
    const result = await res.json();

    if (!res.ok || !result.success) {
      alert('Errore: ' + (result.error || 'Errore sconosciuto'));
      loading.style.display = 'none';
      return;
    }

    portalCandidatiData = result.candidati;
    displayPortalCandidati(portalCandidatiData);

  } catch (error) {
    console.error('Errore:', error);
    alert('Errore nella connessione: ' + error.message);
  } finally {
    loading.style.display = 'none';
  }
}

function displayPortalCandidati(candidati) {
  const container = document.getElementById('portalCandidatiContainer');
  const table = document.getElementById('portalCandidatiTable');
  const count = document.getElementById('portalCount');

  count.innerText = candidati.length;
  table.innerHTML = '';

  candidati.forEach((candidato, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="checkbox" class="portal-checkbox" value="' + index + '"></td>' +
      '<td>' + (candidato.nome || '-') + '</td>' +
      '<td>' + (candidato.cognome || '-') + '</td>' +
      '<td>' + (candidato.codice || '-') + '</td>' +
      '<td>' + (candidato.data_nascita || '-') + '</td>' +
      '<td>' + (candidato.comune_nascita || '-') + '</td>' +
      '<td>' + (candidato.provincia_nascita || '-') + '</td>';
    table.appendChild(tr);
  });

  container.style.display = 'block';
}

function toggleAllPortalCandidati() {
  const checkboxes = document.querySelectorAll('.portal-checkbox');
  const selectAll = document.getElementById('selectAllPortal');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

async function addSelectedPortalCandidati() {
  const checkboxes = document.querySelectorAll('.portal-checkbox:checked');

  if (checkboxes.length === 0) {
    alert('Seleziona almeno un candidato');
    return;
  }

  const selected = Array.from(checkboxes).map(cb => {
    const index = parseInt(cb.value);
    return portalCandidatiData[index];
  });

  try {
    const res = await fetch('/api/waitlist/from-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidati: selected })
    });

    const result = await res.json();

    if (res.ok) {
      alert(result.message);
      clearPortalCandidati();
      load();
    } else {
      alert('Errore: ' + (result.error || 'Errore sconosciuto'));
    }
  } catch (error) {
    alert('Errore nella richiesta: ' + error.message);
  }
}

function clearPortalCandidati() {
  portalCandidatiData = [];
  document.getElementById('portalCandidatiContainer').style.display = 'none';
  document.getElementById('portalLoading').style.display = 'none';
  document.getElementById('selectAllPortal').checked = false;
}

function getPortalSearchPayloadUi() {
  return {
    cognome: document.getElementById('portalSearchCognome').value.trim(),
    numeroPatente: document.getElementById('portalSearchPatente').value.trim(),
    protocolloCertificatoMedico: document.getElementById('portalSearchProtocollo').value.trim(),
    marcaOperativa: document.getElementById('portalSearchMarca').value.trim(),
    codiceFiscale: document.getElementById('portalSearchCf').value.trim()
  };
}

function setPortalSearchStatusUi(text, isError) {
  const node = document.getElementById('portalSearchStatus');
  if (!node) return;
  node.innerText = text || '';
  node.style.color = isError ? '#b00020' : '#1f6f43';
}

function renderPortalSearchResultsUi(results) {
  const container = document.getElementById('portalSearchResultsContainer');
  const table = document.getElementById('portalSearchResultsTable');
  const count = document.getElementById('portalSearchCount');
  if (!container || !table || !count) return;

  portalSearchResults = Array.isArray(results) ? results : [];
  count.innerText = String(portalSearchResults.length);
  table.innerHTML = '';

  portalSearchResults.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="checkbox" class="portal-search-checkbox" value="' + index + '"></td>' +
      '<td>' + (row.cognome || '-') + '</td>' +
      '<td>' + (row.nome || '-') + '</td>' +
      '<td>' + (row.numeroPatente || '-') + '</td>';
    table.appendChild(tr);
  });

  container.style.display = 'block';
}

function toggleAllPortalResultsUi() {
  const selectAll = document.getElementById('selectAllPortalResults');
  const checkboxes = document.querySelectorAll('.portal-search-checkbox');
  checkboxes.forEach((checkbox) => {
    checkbox.checked = !!(selectAll && selectAll.checked);
  });
}

function clearPortalResultsUi() {
  portalSearchResults = [];
  const fields = ['portalSearchCognome', 'portalSearchPatente', 'portalSearchProtocollo', 'portalSearchMarca', 'portalSearchCf'];
  fields.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.value = '';
  });

  const container = document.getElementById('portalSearchResultsContainer');
  const table = document.getElementById('portalSearchResultsTable');
  const count = document.getElementById('portalSearchCount');
  const selectAll = document.getElementById('selectAllPortalResults');
  if (container) container.style.display = 'none';
  if (table) table.innerHTML = '';
  if (count) count.innerText = '0';
  if (selectAll) selectAll.checked = false;
  setPortalSearchStatusUi('', false);
}

async function searchPortalResultsUi() {
  try {
    setPortalSearchStatusUi('Ricerca in corso...', false);
    const payload = getPortalSearchPayloadUi();
    const res = await fetch('/api/portal/search-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Ricerca non riuscita');
    }

    renderPortalSearchResultsUi(result.results || []);
    setPortalSearchStatusUi('Trovati ' + (result.count || 0) + ' risultati', false);
  } catch (error) {
    setPortalSearchStatusUi('Errore ricerca: ' + error.message, true);
  }
}

async function importSelectedPortalResultsUi() {
  try {
    const selectedIndexes = Array.from(document.querySelectorAll('.portal-search-checkbox:checked'))
      .map((node) => Number(node.value))
      .filter((index) => Number.isFinite(index) && portalSearchResults[index]);

    if (!selectedIndexes.length) {
      alert('Seleziona almeno un candidato dai risultati');
      return;
    }

    const selectedCandidates = selectedIndexes.map((index) => ({
      numeroPatente: portalSearchResults[index].numeroPatente,
      cognome: portalSearchResults[index].cognome,
      nome: portalSearchResults[index].nome,
    }));

    const payload = {
      ...getPortalSearchPayloadUi(),
      autoSelectForBooking: !!document.getElementById('portalAutoSelectBooking').checked,
      candidates: selectedCandidates,
    };

    setPortalSearchStatusUi('Import massivo in corso...', false);
    const res = await fetch('/api/portal/import-massivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Import massivo non riuscito');
    }

    const imported = Number(result.imported || 0);
    const linked = Number(result.bookingLinked || 0);
    const errors = Array.isArray(result.errors) ? result.errors.length : 0;
    setPortalSearchStatusUi('Importati: ' + imported + ' · In prenotazione: ' + linked + ' · Errori: ' + errors, false);
    load();
  } catch (error) {
    setPortalSearchStatusUi('Errore import: ' + error.message, true);
  }
}

async function loadImportHistoryUi() {
  const table = document.getElementById('importHistoryTable');
  if (!table) return;

  try {
    const statusFilter = (document.getElementById('importHistoryStatusFilter') || {}).value || 'all';
    const typeFilter = (document.getElementById('importHistoryTypeFilter') || {}).value || 'all';
    const query = new URLSearchParams({
      limit: '20',
      status: statusFilter,
      type: typeFilter,
    }).toString();

    const res = await fetch('/api/import-history?' + query);
    const payload = await res.json();
    const rows = res.ok && payload.success ? (payload.history || []) : [];

    table.innerHTML = '';
    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const when = item.at ? new Date(item.at).toLocaleString('it-IT') : '-';
      tr.innerHTML = '<td>' + when + '</td>' +
        '<td>' + (item.type || '-') + '</td>' +
        '<td>' + (item.status || '-') + '</td>' +
        '<td>' + (item.imported ?? '-') + '</td>' +
        '<td>' + (item.linked ?? '-') + '</td>' +
        '<td>' + (item.errors ?? 0) + '</td>' +
        '<td>' + (item.message || '-') + '</td>';
      table.appendChild(tr);
    });

    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7">Nessuno storico import disponibile</td>';
      table.appendChild(tr);
    }
  } catch (error) {
    table.innerHTML = '<tr><td colspan="7">Errore caricamento storico import</td></tr>';
  }
}

function exportImportHistoryUi() {
  const statusFilter = (document.getElementById('importHistoryStatusFilter') || {}).value || 'all';
  const typeFilter = (document.getElementById('importHistoryTypeFilter') || {}).value || 'all';
  const query = new URLSearchParams({
    status: statusFilter,
    type: typeFilter,
  }).toString();

  window.open('/api/import-history/export?' + query, '_blank');
}


async function load() {
  console.log('🔄 Caricamento dati...');

  // Controllo integrità waitlist
  try {
    const integrityRes = await fetch('/api/admin/waitlist-integrity');
    const integrityData = integrityRes.ok ? await integrityRes.json() : null;
    const integrityNode = document.getElementById('integrity');
    if (integrityNode) {
      if (!integrityData) {
        integrityNode.innerText = 'ERR';
      } else {
        integrityNode.innerText = integrityData.ok ? 'OK' : String(integrityData.anomalies);
      }
    }
  } catch (e) {
    const integrityNode = document.getElementById('integrity');
    if (integrityNode) integrityNode.innerText = 'ERR';
  }
  
  // Carica lista di attesa
  const waitlistRes = await fetch('/api/waitlist');
  const waitlistData = await waitlistRes.json();
  
  console.log('📊 Candidati totali:', waitlistData.length);
  console.log('⏳ Pending:', waitlistData.filter(d => d.status === 'pending').length);
  console.log('✅ Completed:', waitlistData.filter(d => d.status === 'completed').length);

  try {
    document.getElementById('total').innerText = 
      waitlistData.filter(d => d.status === 'pending').length;
    document.getElementById('inProgress').innerText = 
      waitlistData.filter(d => d.status === 'in_progress').length;
    document.getElementById('completed').innerText = 
      waitlistData.filter(d => d.status === 'completed').length;
  } catch(e) {
    console.error('❌ Errore aggiornamento statistiche:', e.message);
  }

  const waitlistTable = document.getElementById('waitlistTable');
  if (!waitlistTable) {
    console.error('❌ Elemento waitlistTable non trovato nel DOM');
    return;
  }
  waitlistTable.innerHTML = '';

  waitlistData.forEach(row => {
    const badgeClass = row.status === 'pending' ? 'pending' : 'completed';
    const tr = document.createElement('tr');
    const date = new Date(row.created_at);
    const dateStr = date.toLocaleDateString('it-IT');
    tr.innerHTML = '<td>' + row.id + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + row.status + '</span></td>' +
      '<td>' + dateStr + '</td>' +
      '<td><button onclick="updateStatus(' + row.id + ', \\'completed\\')" class="btn-success">Completa</button></td>';
    waitlistTable.appendChild(tr);
  });
  console.log('✅ Caricati ' + waitlistData.length + ' candidati nella lista di attesa');

  // Carica candidati dalla tabella candidates
  fetch('/api/candidates')
    .then(res => res.json())
    .then(data => {
      const tableBody = document.getElementById('candidates-table');

      if (!tableBody) {
        console.error('❌ Elemento candidates-table non trovato nel DOM');
        return;
      }

      tableBody.innerHTML = '';

      data.forEach(c => {
        tableBody.innerHTML +=
          '<tr>' +
            '<td>' + (c.id || '-') + '</td>' +
            '<td>' + (c.nome || '-') + '</td>' +
            '<td>' + (c.cognome || '-') + '</td>' +
            '<td>' + (c.codice_fiscale || '-') + '</td>' +
          '</tr>';
      });
    })
    .catch(error => console.error('❌ Errore caricamento candidates:', error.message));

  // Carica prenotazioni
  const bookingsRes = await fetch('/api/prenotazioni');
  const bookingsData = await bookingsRes.ok ? await bookingsRes.json() : [];

  try {
    document.getElementById('bookings').innerText = bookingsData.length;
  } catch(e) {
    console.error('❌ Errore aggiornamento bookings count:', e.message);
  }

  const bookingsTable = document.getElementById('bookingsTable');
  if (!bookingsTable) {
    console.error('❌ Elemento bookingsTable non trovato nel DOM');
  } else {
    bookingsTable.innerHTML = '';

    bookingsData.forEach(row => {
      const tr = document.createElement('tr');
      const date = new Date(row.created_at);
      const dateStr = date.toLocaleDateString('it-IT');
      tr.innerHTML = '<td>' + row.id + '</td>' +
        '<td>' + (row.nome || '-') + '</td>' +
        '<td>' + (row.cognome || '-') + '</td>' +
        '<td>' + (row.data || '-') + '</td>' +
        '<td>' + (row.categoria || '-') + '</td>' +
        '<td>' + dateStr + '</td>' +
        '<td><button onclick="cancelBooking(' + row.id + ')" class="btn btn-danger" style="background: #dc3545;">Annulla</button></td>';
      bookingsTable.appendChild(tr);
    });
    console.log('✅ Caricate ' + bookingsData.length + ' prenotazioni');
  }

  // Carica TUTTI i candidati
  const allCandidatiRes = await fetch('/api/candidati/all');
  const allCandidatiData = await allCandidatiRes.ok ? await allCandidatiRes.json() : [];

  const allCandidatiTable = document.getElementById('allCandidatiTable');
  if (!allCandidatiTable) {
    console.error('❌ Elemento allCandidatiTable non trovato nel DOM');
  } else {
    allCandidatiTable.innerHTML = '';

    allCandidatiData.forEach(row => {
      const tr = document.createElement('tr');
      const date = new Date(row.created_at);
      const dateStr = date.toLocaleDateString('it-IT');
      const badgeClass = row.status === 'pending' ? 'pending' : 'completed';
      tr.innerHTML = '<td>' + row.id + '</td>' +
        '<td>' + (row.nome || '-') + '</td>' +
        '<td>' + (row.cognome || '-') + '</td>' +
        '<td>' + (row.codice || '-') + '</td>' +
        '<td>' + (row.data_nascita || '-') + '</td>' +
        '<td>' + (row.comune_nascita || '-') + '</td>' +
        '<td>' + (row.provincia_nascita || '-') + '</td>' +
        '<td><span class="badge ' + badgeClass + '">' + row.status + '</span></td>' +
        '<td>' + dateStr + '</td>';
      allCandidatiTable.appendChild(tr);
    });
    console.log('✅ Caricati ' + allCandidatiData.length + ' candidati nella tabella');
  }

  await loadImportHistoryUi();

async function updateStatus(id, status) {
  await fetch('/api/waitlist/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status })
  });
  load();
}

async function cancelBooking(id) {
  if (!confirm('Sei sicuro di voler annullare questa prenotazione?')) return;
  
  const res = await fetch('/api/prenotazioni/' + id, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (res.ok) {
    alert('Prenotazione annullata');
    load();
  } else {
    alert('Errore durante l\'annullamento');
  }
}

async function addCandidatesBulk() {
  const input = document.getElementById('candidatesInput').value.trim();
  
  if (!input) {
    alert('Inserisci i candidati in formato JSON');
    return;
  }

  try {
    const candidates = JSON.parse(input);
    
    if (!Array.isArray(candidates)) {
      alert('Il formato deve essere un array JSON');
      return;
    }

    const res = await fetch('/api/waitlist/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: candidates })
    });

    const result = await res.json();

    if (res.ok) {
      alert(result.message);
      document.getElementById('candidatesInput').value = '';
      load();
    } else {
      alert('Errore: ' + result.error);
    }
  } catch (e) {
    alert('Errore nel parsing JSON: ' + e.message);
  }
}

loadSearchSettingsUi();
loadEngineStatusUi();
load();
setInterval(load, 5000);
setInterval(loadEngineStatusUi, 5000);
</script>
  `);
});

/* ===============================
   SERVER STARTUP
=================================*/

const BASE_PORT = Number(process.env.PORT || 3000);
const MAX_PORT_TRIES = 10;

function startServer(port, attempt = 0) {
  const server = http.createServer(app);
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE" && attempt < MAX_PORT_TRIES) {
      const nextPort = port + 1;
      console.warn(`⚠️ Porta ${port} occupata, provo ${nextPort}...`);
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error("Errore avvio server:", err.message || err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`✓ Server avviato su http://localhost:${port}`);
  });
}

startServer(BASE_PORT);