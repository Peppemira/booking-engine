require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const supabase = require("./database/supabase");
const { sendBookingNotification, sendTelegram } = require("./telegra");
const PortalSession = require("./connector/portalSession");
const {
  loginAndGetJar,
  getOrLoginJar,
  invalidatePortalSession,
  diagnosePortalLogin,
  readSessioniQuizInterneViaBrowser,
  runManualSessionFlowViaBrowser,
  readSituazioneCandidatiDettaglioViaBrowser,
  readPrenotazioniSessioneQuizInterneViaBrowser,
} = require("./connector/portalSession");
const { readSituazioneCandidatiHttp } = require("./connector/portalSituazioneCandidati");
const { readSituazioneCandidatiConseguimentoViaBrowser } = require("./connector/portalConseguimenti");
const { makeHttpClient, loadMenu, readSituazioneCandidati, readSessioniQuizInterne, getSessionPageDiagnostics } = require("./connector/portalHttp");
const { getPuntiPatente } = require("./connector/puntiPatente");
const { parsePortalCandidates } = require("./parser/candidateParser");
const { parseSessioni, parseSessioniReadOnly } = require("./parser/sessionParser");
const { importByPatente, importCandidate, importMassivo, searchCandidates } = require("./connector/importByPatente");
const {
  prenotaSessione,
  cercaCandidatoInDettaglio,
  confermaNuovoCandidato,
  modificaCandidatoPrenotazione,
  eliminaCandidatoPrenotazione,
  sostituisciCandidatoPrenotazione,
} = require("./connector/booking");
const { getSearchSettings, saveSearchSettings, getNextSearchWindow } = require("./server/searchSettings");
const { getEngineStatus, saveEngineStatus } = require("./server/engineStatus");
const { getImportHistory, addImportHistory } = require("./server/importHistory");
const { resolvePortalCredentials } = require("./server/portalHelpers");
const {
  attachAuthContext,
  enforceApiAuth,
  requireAuth,
  withTenantFilter,
  tenantField,
  registerAutoscuola,
  loginAutoscuola,
  meAutoscuola,
  logoutAutoscuola,
  requestPasswordReset,
  resetPassword,
} = require("./server/auth");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const { spawn, execFile } = require("child_process");
const { randomUUID } = require("crypto");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}
const { upsertConseguimenti } = require("./services/portalBackfillService");
const app = express();

// Redirect alla UI: chi va su :3000 (backend) viene portato al frontend sulla 3001
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3001";
const ALLOWED_ORIGINS = FRONTEND_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
const PRIMARY_ORIGIN = ALLOWED_ORIGINS[0] || "http://localhost:3001";
app.get("/", (req, res) => res.redirect(PRIMARY_ORIGIN));
app.get("/login", (req, res) => res.redirect(PRIMARY_ORIGIN + "/login"));
app.get("/Login", (req, res) => res.redirect(PRIMARY_ORIGIN + "/login"));

app.use(
  cors({
    origin: function (origin, cb) {
      // Permetti richieste server-to-server (no Origin) e le origini consentite (+ qualsiasi *.vercel.app)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || /\.vercel\.app$/.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(attachAuthContext);
app.use("/api", enforceApiAuth);

// Route REST equivalenti GeCA (src/routes)
const apiRoutes = require("./routes");
app.use("/api", apiRoutes);

if (String(process.env.ENGINE_AUTO_START || "false").toLowerCase() === "true") {
  require("./engineAuto");
}

// Nuovo endpoint: legge i candidati prenotati da "Sessioni Quiz Interne" (tabella listPrenotazioneCandidatoEP)
// Richiede autenticazione (middleware enforceApiAuth è applicato a /api a monte).
// Body opzionale: { sessionIndex?: number } per scegliere la seduta (default 0).
app.post("/api/portal/sessione-candidati-da-quiz-interne", async (req, res) => {
  try {
    const trace = [];
    const sessionIndex = Number.isFinite(Number(req.body?.sessionIndex))
      ? Number(req.body.sessionIndex)
      : 0;

    const browserResult = await readPrenotazioniSessioneQuizInterneViaBrowser({
      trace,
      sessionIndex,
    });

    const prenotazioni = Array.isArray(browserResult?.prenotazioni)
      ? browserResult.prenotazioni
      : [];

    return res.json({
      success: true,
      trace,
      sessionIndex: browserResult?.selectedSessionIndex ?? sessionIndex,
      selectedSession: browserResult?.selectedSession || null,
      totalePrenotazioni: prenotazioni.length,
      prenotazioni,
      sorgente: "sessioni-quiz-interne-browser",
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message || "Errore lettura candidati da Sessioni Quiz Interne",
    });
  }
});

app.post("/api/portal/backfill-conseguimenti", async (req, res) => {
  try {
    const trace = [];

    // Legge la pagina di dettaglio "Situazione Candidati" via browser (come fai tu a mano)
    const browserResult = await readSituazioneCandidatiDettaglioViaBrowser({ trace });
    const rows = Array.isArray(browserResult?.rows) ? browserResult.rows : [];

    if (!rows.length) {
      return res.status(200).json({
        success: true,
        insertedPratiche: 0,
        updatedPratiche: 0,
        errors: [],
        trace,
        note: "Nessun candidato trovato nella pagina di dettaglio Situazione Candidati",
      });
    }

    // 2) Upsert su Supabase
    const result = await upsertConseguimenti(rows, req);
    res.json({
      success: true,
      ...result,
      trace,
      sorgente: "situazione-candidati-browser-dettaglio",
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message || "Errore backfill conseguimenti",
    });
  }
});

if (String(process.env.RADAR_AUTO_START || "false").toLowerCase() === "true") {
  const { startScheduler } = require("./services/scheduler");
  startScheduler();
}

// Scheduler per sync incrementale Archivio Storico Portale (tempo reale)
// Si avvia automaticamente se ARCHIVIO_SCHEDULER_ENABLED=true
{
  const { startArchivioScheduler } = require("./services/archivioScheduler");
  startArchivioScheduler();
}

// Sessione globale del portale (in memoria)
let portalSession = null;

// buildCandidatePayload, resolveCandidateId, addCandidatesToBookingList, resolvePortalCredentials
// → spostati in src/server/candidateHelpers.js e src/server/portalHelpers.js

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
  const separator = String(base || "").includes("?") ? "&" : "?";
  return `${String(base || "").replace(/\/$/, "")}/acquisizione-remota${separator}token=${encodeURIComponent(token)}${apiBase ? `&apiBase=${encodeURIComponent(apiBase)}` : ""}`;
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
  const cieData = input?.cie_data && typeof input.cie_data === "object" ? input.cie_data : {};
  return {
    updatedAt: new Date().toISOString(),
    ncf_mobile: String(input?.ncf_mobile || "").trim(),
    foto_data_url: String(input?.foto_data_url || "").trim(),
    firma_data_url: String(input?.firma_data_url || "").trim(),
    cie_data: {
      nome: String(cieData?.nome || "").trim(),
      cognome: String(cieData?.cognome || "").trim(),
      codice_fiscale: String(cieData?.codice_fiscale || "").trim(),
      data_nascita: String(cieData?.data_nascita || "").trim(),
      sesso: String(cieData?.sesso || "").trim(),
      comune_nascita: String(cieData?.comune_nascita || "").trim(),
      prov_nascita: String(cieData?.prov_nascita || "").trim(),
      tipo_documento: String(cieData?.tipo_documento || "").trim(),
      numero_documento: String(cieData?.numero_documento || "").trim(),
      ente_rilascio_documento: String(cieData?.ente_rilascio_documento || "").trim(),
      rilasciato_il_documento: String(cieData?.rilasciato_il_documento || "").trim(),
      scade_il_documento: String(cieData?.scade_il_documento || "").trim(),
    },
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

  const mergedCieData = {
    ...(existing?.cie_data && typeof existing.cie_data === "object" ? existing.cie_data : {}),
    ...(incoming?.cie_data && typeof incoming.cie_data === "object" ? incoming.cie_data : {}),
  };

  return {
    updatedAt: String(incoming?.updatedAt || new Date().toISOString()),
    ncf_mobile: String(incoming?.ncf_mobile || existing?.ncf_mobile || "").trim(),
    foto_data_url: String(incoming?.foto_data_url || existing?.foto_data_url || "").trim(),
    firma_data_url: String(incoming?.firma_data_url || existing?.firma_data_url || "").trim(),
    cie_data: mergedCieData,
    documenti_acquisiti: (appendDocuments ? [...currentDocs, ...nextDocs] : nextDocs).slice(0, 20),
  };
}

const remoteCaptureFallbackStore = new Map();

function isRemoteCaptureTableMissing(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message.includes("remote_capture_sessions")) return false;
  return message.includes("schema cache") || message.includes("does not exist");
}

function getRemoteFallbackSession(token = "") {
  const key = String(token || "").trim();
  if (!key) return null;
  return remoteCaptureFallbackStore.get(key) || null;
}

function setRemoteFallbackSession(token = "", session = {}) {
  const key = String(token || "").trim();
  if (!key) return;
  remoteCaptureFallbackStore.set(key, session);
}

async function discoverWindowsDevices() {
  if (process.platform !== "win32") {
    return {
      printers: [],
      scanners: [],
      note: "Discovery avanzata disponibile su Windows",
    };
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'

$printers = @(Get-Printer | Select-Object Name,DriverName,PortName,Shared,ShareName,ComputerName,Type)
$scanners = @(Get-PnpDevice -Class Image | Select-Object FriendlyName,InstanceId,Status,Present)

$printerRows = @($printers | ForEach-Object {
  $port = [string]$_.PortName
  $isNetwork = $false
  if ($port -match '^(\\\\|WSD|IP_|TCP|http|IPP)') { $isNetwork = $true }
  if ($_.ComputerName) { $isNetwork = $true }
  [PSCustomObject]@{
    name = [string]$_.Name
    driver = [string]$_.DriverName
    port = $port
    network = [bool]$isNetwork
    shared = [bool]$_.Shared
    shareName = [string]$_.ShareName
    type = [string]$_.Type
  }
})

$scannerRows = @($scanners | ForEach-Object {
  $name = [string]$_.FriendlyName
  $isNetwork = $false
  if ($name -match 'WSD|Network|LAN|Wi-?Fi|IP') { $isNetwork = $true }
  [PSCustomObject]@{
    name = $name
    status = [string]$_.Status
    present = [bool]$_.Present
    network = [bool]$isNetwork
    instanceId = [string]$_.InstanceId
  }
})

[PSCustomObject]@{
  printers = $printerRows
  scanners = $scannerRows
} | ConvertTo-Json -Depth 6 -Compress
`;

  const output = await new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 12000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message || "Errore discovery dispositivi"));
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
  });

  if (!output) {
    return { printers: [], scanners: [] };
  }

  return JSON.parse(output);
}

async function launchWindowsScannerWizard() {
  if (process.platform !== "win32") {
    throw new Error("Avvio scanner automatico disponibile solo su Windows");
  }

  await new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Start-Process -FilePath 'wiaacmgr.exe'"],
      { timeout: 8000, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message || "Impossibile avviare il wizard scanner"));
          return;
        }
        resolve();
      },
    );
  });
}

let scannerCaptureLock = {
  active: false,
  startedAt: 0,
};

function normalizeScannerCaptureError(error) {
  const raw = String(error?.message || "").trim();
  const lower = raw.toLowerCase();

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Timeout acquisizione scanner: nessuna immagine ricevuta entro il tempo massimo";
  }

  if (
    lower.includes("propriet")
    || lower.includes("another program")
    || lower.includes("eseguendo la digitalizzazione")
    || lower.includes("busy")
    || lower.includes("in uso")
    || lower.includes("0x80210006")
  ) {
    return "Scanner occupato da un altro programma: chiudi scansioni aperte e riprova";
  }

  if (lower.includes("annullata") || lower.includes("canceled") || lower.includes("cancelled")) {
    return "Scansione annullata dall'operatore";
  }

  return raw || "Impossibile acquisire scanner direttamente";
}

async function captureWindowsScannerImage() {
  if (process.platform !== "win32") {
    throw new Error("Scansione diretta disponibile solo su Windows");
  }

  const script = `
$ErrorActionPreference = 'Stop'
$scanDir = Join-Path $env:TEMP 'booking-engine-scans'
New-Item -ItemType Directory -Path $scanDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
$filePath = Join-Path $scanDir ("scan-" + $timestamp + ".jpg")

try {
  $dialog = New-Object -ComObject WIA.CommonDialog
  $image = $dialog.ShowAcquireImage()
  if (-not $image) {
    throw 'Scansione annullata o nessuna immagine acquisita'
  }

  try {
    $image.SaveFile($filePath)
  } catch {
    $bytes = $image.FileData.BinaryData
    [System.IO.File]::WriteAllBytes($filePath, $bytes)
  }

  if (-not (Test-Path -Path $filePath)) {
    throw 'Il driver scanner non ha prodotto alcun file'
  }

  $fileInfo = Get-Item -Path $filePath
  [PSCustomObject]@{
    path = [string]$fileInfo.FullName
    name = [string]$fileInfo.Name
    size = [int64]$fileInfo.Length
  } | ConvertTo-Json -Compress
} catch {
  $msg = [string]$_.Exception.Message
  if ([string]::IsNullOrWhiteSpace($msg)) {
    $msg = 'Errore acquisizione scanner WIA'
  }
  throw $msg
}
`;

  const output = await new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 45000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message || "Errore acquisizione scanner"));
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
  });

  let parsed = {};
  try {
    parsed = output ? JSON.parse(output) : {};
  } catch {
    throw new Error("Risposta scanner non valida");
  }

  const filePath = String(parsed?.path || "").trim();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("File scanner non trovato dopo acquisizione");
  }

  const ext = String(path.extname(filePath) || "").toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : ext === ".bmp" ? "image/bmp" : "image/jpeg";
  const buffer = fs.readFileSync(filePath);
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  return {
    name: String(parsed?.name || path.basename(filePath) || "scan.jpg"),
    size: Number(parsed?.size || buffer.length || 0),
    mimeType,
    dataUrl,
  };
}

/* ===============================
   API
=================================*/

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "autoscuola-backend", ts: new Date().toISOString() });
});

app.get("/api/portal/import-version", (_req, res) => {
  try {
    const mod = require("./connector/importByPatente");
    const importMassivoSource = String(mod?.importMassivo || "");
    const modulePath = path.join(__dirname, "connector", "importByPatente.js");
    let fileSource = "";
    let mtime = null;
    try {
      const stat = fs.statSync(modulePath);
      mtime = stat.mtime.toISOString();
      fileSource = fs.readFileSync(modulePath, "utf8");
    } catch {}

    return res.json({
      success: true,
      modulePath,
      moduleMtime: mtime,
      hasFlowVersionMarker: importMassivoSource.includes("flowVersion"),
      hasManualCollector: importMassivoSource.includes("collectCandidatesViaManualFlow"),
      fileHasFlowVersionMarker: fileSource.includes("flowVersion"),
      fileHasManualCollector: fileSource.includes("collectCandidatesViaManualFlow"),
      ts: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "version-check-failed" });
  }
});

// Indica se il backend ha credenziali portale da .env/vault (così il frontend può dire "lascia vuoti i campi portale")
app.get("/api/auth/portal-defaults", (_req, res) => {
  const has =
    (process.env.PORTAL_USERNAME || process.env.PORTAL_USER) &&
    (process.env.PORTAL_PASSWORD || process.env.PORTAL_PASS);
  res.json({ hasDefaults: !!has });
});

app.post("/api/auth/register", registerAutoscuola);
app.post("/api/auth/login", loginAutoscuola);
app.get("/api/auth/me", requireAuth, meAutoscuola);
app.post("/api/auth/logout", requireAuth, logoutAutoscuola);
app.post("/api/auth/request-reset", requestPasswordReset);
app.post("/api/auth/reset-password", resetPassword);

app.put("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const { nome, codice_autoscuola, indirizzo, partita_iva, telefono, portal_user, portal_pass, portal_pin } = req.body || {};
    const updates = {};
    if (nome)                              updates.nome                = String(nome).trim();
    if (codice_autoscuola !== undefined)   updates.codice_autoscuola   = String(codice_autoscuola).trim();
    if (indirizzo         !== undefined)   updates.indirizzo           = String(indirizzo).trim();
    if (partita_iva       !== undefined)   updates.partita_iva         = String(partita_iva).trim();
    if (telefono          !== undefined)   updates.telefono            = String(telefono).trim();
    if (portal_user)                       updates.portal_user         = String(portal_user).trim();
    if (portal_pass)                       updates.portal_pass         = String(portal_pass);
    if (portal_pin)                        updates.portal_pin          = String(portal_pin).trim();
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: "Nessun campo da aggiornare" });
    }
    const { data, error } = await supabase
      .from("autoscuole")
      .update(updates)
      .eq("id", req.autoscuolaId)
      .select("id,nome,email,codice_autoscuola")
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, autoscuola: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore aggiornamento profilo" });
  }
});

app.get("/api/devices/discovery", requireAuth, async (_req, res) => {
  try {
    const devices = await discoverWindowsDevices();
    return res.json({
      success: true,
      platform: process.platform,
      printers: Array.isArray(devices?.printers) ? devices.printers : [],
      scanners: Array.isArray(devices?.scanners) ? devices.scanners : [],
      note: devices?.note || "",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Impossibile leggere dispositivi scanner/stampanti",
    });
  }
});

app.post("/api/devices/scanner/start", requireAuth, async (_req, res) => {
  try {
    await launchWindowsScannerWizard();
    return res.json({ success: true, started: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Impossibile avviare scanner predefinito",
    });
  }
});

app.post("/api/devices/scanner/capture", requireAuth, async (_req, res) => {
  if (scannerCaptureLock.active) {
    const startedAgoMs = scannerCaptureLock.startedAt ? Math.max(0, Date.now() - scannerCaptureLock.startedAt) : 0;
    return res.status(409).json({
      success: false,
      error: "Scanner già occupato da una scansione in corso",
      code: "SCANNER_BUSY",
      startedAgoMs,
    });
  }

  scannerCaptureLock = {
    active: true,
    startedAt: Date.now(),
  };

  try {
    const capture = await captureWindowsScannerImage();
    return res.json({
      success: true,
      capture,
    });
  } catch (error) {
    const normalized = normalizeScannerCaptureError(error);
    const isBusy = String(normalized || "").toLowerCase().includes("occupato");
    const isTimeout = String(normalized || "").toLowerCase().includes("timeout");
    return res.status(500).json({
      success: false,
      error: normalized,
      code: isBusy ? "SCANNER_BUSY" : isTimeout ? "SCANNER_TIMEOUT" : "SCANNER_CAPTURE_FAILED",
    });
  } finally {
    scannerCaptureLock = {
      active: false,
      startedAt: 0,
    };
  }
});

app.get("/api/network/local-ip", requireAuth, (_req, res) => {
  try {
    const ip = getLocalLanIpv4();
    return res.json({
      success: true,
      ip,
      hostname: os.hostname(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Impossibile rilevare IP LAN locale",
    });
  }
});

app.post("/api/remote-capture/sessions", requireAuth, async (req, res) => {
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
          ...tenantField(req),
        }])
        .select("token,expires_at")
        .single();

      if (!error && data) {
        inserted = data;
        break;
      }
      if (isRemoteCaptureTableMissing(error)) {
        const now = new Date().toISOString();
        setRemoteFallbackSession(token, {
          token,
          mode,
          status: "pending",
          expires_at: expiresAt,
          payload: {},
          updated_at: now,
          autoscuola_id: req.autoscuolaId || null,
        });
        inserted = { token, expires_at: expiresAt };
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

app.get("/api/remote-capture/sessions/:token", requireAuth, async (req, res) => {
  try {
    const token = String(req.params?.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, error: "Token mancante" });
    }

    let query = supabase
      .from("remote_capture_sessions")
      .select("token,status,payload,updated_at,expires_at");
    query = withTenantFilter(query, req);

    const { data, error } = await query
      .eq("token", token)
      .maybeSingle();

    if (isRemoteCaptureTableMissing(error)) {
      const fallback = getRemoteFallbackSession(token);
      const tenantMismatch = fallback && req.autoscuolaId && fallback.autoscuola_id && String(fallback.autoscuola_id) !== String(req.autoscuolaId);
      if (!fallback || tenantMismatch) {
        return res.status(404).json({ success: false, error: "Sessione non trovata" });
      }
      const expiredFallback = fallback.expires_at && new Date(fallback.expires_at).getTime() < Date.now();
      if (expiredFallback) {
        return res.status(410).json({ success: false, error: "Sessione scaduta" });
      }

      return res.json({
        success: true,
        token: fallback.token,
        status: fallback.status,
        updatedAt: fallback.updated_at,
        expiresAt: fallback.expires_at,
        payload: fallback.payload || {},
      });
    }

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

// === P1: Endpoint delivery del link acquisizione remota ===
// Body: { channel: "email"|"whatsapp", recipient: string, candidateName?: string }
// Spec: docs/superpowers/specs/2026-04-17-p1-link-delivery-design.md
const remoteCaptureDeliverHandler = require("./server/remoteCaptureDeliverHandler");
app.post("/api/remote-capture/sessions/:token/deliver", requireAuth, remoteCaptureDeliverHandler);

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

    if (isRemoteCaptureTableMissing(error)) {
      const fallback = getRemoteFallbackSession(token);
      if (!fallback) return res.status(404).json({ success: false, error: "Token non valido" });

      const expiredFallback = fallback.expires_at && new Date(fallback.expires_at).getTime() < Date.now();
      if (expiredFallback) {
        return res.status(410).json({ success: false, error: "Sessione scaduta" });
      }

      return res.json({
        success: true,
        token: fallback.token,
        status: fallback.status,
        updatedAt: fallback.updated_at,
        expiresAt: fallback.expires_at,
        payload: fallback.payload || {},
      });
    }

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

    if (isRemoteCaptureTableMissing(findError)) {
      const fallback = getRemoteFallbackSession(token);
      if (!fallback) return res.status(404).json({ success: false, error: "Token non valido" });

      const expiredFallback = fallback.expires_at && new Date(fallback.expires_at).getTime() < Date.now();
      if (expiredFallback) {
        return res.status(410).json({ success: false, error: "Sessione scaduta" });
      }

      const payload = normalizeRemoteCapturePayload(req.body || {});
      const mergedPayload = mergeRemoteCapturePayload(fallback.payload || {}, payload, appendDocuments);
      const updatedAt = new Date().toISOString();
      setRemoteFallbackSession(token, {
        ...fallback,
        payload: mergedPayload,
        status: "submitted",
        updated_at: updatedAt,
      });

      return res.json({
        success: true,
        token,
        updatedAt,
      });
    }

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
    const action = String(req.query.action || "all").toLowerCase().trim();
    const actionAliases = action === "pagopa" || action === "bollettino"
      ? new Set(["pagopa", "bollettino"])
      : new Set([action]);
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const operator = String(req.query.operator || "").toLowerCase().trim();
    const history = await getImportHistory(Math.max(limit, 200));
    const normalizePaymentActionValue = (value) => (String(value || "").toLowerCase() === "bollettino" ? "pagopa" : value);
    const normalizePaymentActionMessage = (value) => String(value || "").replace(/\bbollettino\b/gi, "PagoPA");

    const filtered = history.filter((row) => {
      const statusOk = status === "all" || String(row.status || "").toLowerCase() === status;
      const typeOk = type === "all" || String(row.type || "").toLowerCase() === type;
      const rowDate = String(row.at || "").slice(0, 10);
      const fromOk = !from || (rowDate && rowDate >= from);
      const toOk = !to || (rowDate && rowDate <= to);
      const rowAction = String(normalizePaymentActionValue(row?.criteria?.action) || "").toLowerCase();
      const actionOk = action === "all" || actionAliases.has(rowAction);
      const operatorEmail = String(row?.criteria?.actor?.email || "").toLowerCase();
      const operatorName = String(row?.criteria?.actor?.nome || "").toLowerCase();
      const operatorOk = !operator || operatorEmail.includes(operator) || operatorName.includes(operator);
      return statusOk && typeOk && fromOk && toOk && actionOk && operatorOk;
    }).slice(0, limit).map((row) => ({
      ...row,
      message: normalizePaymentActionMessage(row.message),
      criteria: {
        ...(row.criteria || {}),
        action: normalizePaymentActionValue(row?.criteria?.action),
      },
    }));

    res.json({ success: true, history: filtered });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/import-history/export", async (req, res) => {
  try {
    const status = String(req.query.status || "all").toLowerCase();
    const type = String(req.query.type || "all").toLowerCase();
    const action = String(req.query.action || "all").toLowerCase().trim();
    const actionAliases = action === "pagopa" || action === "bollettino"
      ? new Set(["pagopa", "bollettino"])
      : new Set([action]);
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const operator = String(req.query.operator || "").toLowerCase().trim();
    const format = String(req.query.format || "json").toLowerCase();
    const history = await getImportHistory(200);
    const normalizePaymentActionValue = (value) => (String(value || "").toLowerCase() === "bollettino" ? "pagopa" : value);
    const normalizePaymentActionMessage = (value) => String(value || "").replace(/\bbollettino\b/gi, "PagoPA");

    const filtered = history.filter((row) => {
      const statusOk = status === "all" || String(row.status || "").toLowerCase() === status;
      const typeOk = type === "all" || String(row.type || "").toLowerCase() === type;
      const rowDate = String(row.at || "").slice(0, 10);
      const fromOk = !from || (rowDate && rowDate >= from);
      const toOk = !to || (rowDate && rowDate <= to);
      const rowAction = String(normalizePaymentActionValue(row?.criteria?.action) || "").toLowerCase();
      const actionOk = action === "all" || actionAliases.has(rowAction);
      const operatorEmail = String(row?.criteria?.actor?.email || "").toLowerCase();
      const operatorName = String(row?.criteria?.actor?.nome || "").toLowerCase();
      const operatorOk = !operator || operatorEmail.includes(operator) || operatorName.includes(operator);
      return statusOk && typeOk && fromOk && toOk && actionOk && operatorOk;
    }).map((row) => ({
      ...row,
      message: normalizePaymentActionMessage(row.message),
      criteria: {
        ...(row.criteria || {}),
        action: normalizePaymentActionValue(row?.criteria?.action),
      },
    }));

    if (format === "csv") {
      const escapeCsv = (value) => {
        const str = String(value ?? "");
        if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
          return `"${str.replace(/\"/g, '""')}"`;
        }
        return str;
      };

      const header = ["at", "type", "status", "action", "id", "operator_email", "operator_nome", "message"];
      const lines = filtered.map((row) => {
        const cols = [
          row.at || "",
          row.type || "",
          row.status || "",
          row?.criteria?.action || "",
          row?.criteria?.id || "",
          row?.criteria?.actor?.email || "",
          row?.criteria?.actor?.nome || "",
          row.message || "",
        ];
        return cols.map(escapeCsv).join(",");
      });

      const csv = [header.join(","), ...lines].join("\n");
      const filename = `import-history-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      return res.send(csv);
    }

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

app.post("/api/portal/sessioni-manual-flow", async (req, res) => {
  try {
    const traceEnabled = req.body?.trace === true;
    const portalTrace = traceEnabled ? [] : null;
    const sessionIndex = Number.isFinite(Number(req.body?.sessionIndex)) ? Number(req.body.sessionIndex) : 0;
    const turnoIndex = Number.isFinite(Number(req.body?.turnoIndex)) ? Number(req.body.turnoIndex) : 0;
    const confirmInsert = req.body?.confirmInsert === true;
    const candidate = req.body?.candidate && typeof req.body.candidate === "object" ? req.body.candidate : null;

    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({
        success: false,
        error: "Credenziali portale mancanti (portal_user/portal_pass)",
      });
    }

    if (Array.isArray(portalTrace)) {
      portalTrace.push({
        at: new Date().toISOString(),
        step: "manual.flow.start",
        sessionIndex,
        turnoIndex,
        confirmInsert,
        hasCandidate: Boolean(candidate),
      });
    }

    const result = await runManualSessionFlowViaBrowser({
      ...creds,
      sessionIndex,
      turnoIndex,
      confirmInsert,
      candidate,
      trace: portalTrace,
    });

    if (Array.isArray(portalTrace)) {
      portalTrace.push({
        at: new Date().toISOString(),
        step: "manual.flow.done",
        selectedSessionIndex: result?.selectedSessionIndex ?? 0,
        selectedTurnoIndex: result?.selectedTurnoIndex ?? 0,
        noSeats: Boolean(result?.newCandidate?.noSeats),
      });
    }

    return res.json({
      success: true,
      mode: "manual-flow",
      searchedAt: new Date().toISOString(),
      sessionsTotal: Array.isArray(result?.sessions) ? result.sessions.length : 0,
      selectedSessionIndex: result?.selectedSessionIndex ?? 0,
      selectedSession: result?.selectedSession || null,
      detail: result?.detail || null,
      turni: Array.isArray(result?.turni) ? result.turni : [],
      selectedTurnoIndex: result?.selectedTurnoIndex ?? -1,
      selectedTurno: result?.selectedTurno || null,
      newCandidate: result?.newCandidate || null,
      trace: portalTrace || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Errore durante il flusso manuale portale",
      trace: req.body?.trace === true ? [{
        at: new Date().toISOString(),
        step: "manual.flow.error",
        message: String(error?.message || "").slice(0, 1200),
      }] : undefined,
    });
  }
});

app.post("/api/telegram/sessioni-alert", async (req, res) => {
  try {
    const payload = req.body || {};
    const totalOpen = Number(payload.totalOpen || 0);
    const entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 8) : [];

    if (!totalOpen || totalOpen < 1) {
      return res.json({ success: true, skipped: true, message: "Nessuna seduta aperta da notificare" });
    }

    const lines = entries.map((item) => {
      const data = String(item?.data || item?.dataIpotetica || "-").trim();
      const tipo = String(item?.tipoEsame || "-").trim();
      const aula = String(item?.aula || "-").trim();
      const amPm = String(item?.amPm || "-").trim();
      const posti = String(item?.postiLiberi ?? item?.postiAutoscuola ?? item?.totalePosti ?? "-").trim();
      return `• ${data} | ${tipo} | aula ${aula} | ${amPm} | posti ${posti}`;
    });

    const text = [
      "🚨 Sedute con disponibilità rilevate",
      `Totale sedute aperte: ${totalOpen}`,
      ...lines,
    ].join("\n");

    const sent = await sendTelegram(text);
    return res.json({ success: Boolean(sent), sent: Boolean(sent), totalOpen, notifiedEntries: entries.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "Errore invio alert Telegram" });
  }
});

app.post("/api/portal/login-diagnostics", requireAuth, async (req, res) => {
  try {
    const creds = await resolvePortalCredentials(req);
    if (!creds.username || !creds.password) {
      return res.status(400).json({
        success: false,
        error: "Credenziali portale mancanti (portal_user/portal_pass)",
      });
    }

    const result = await diagnosePortalLogin({
      username: creds.username,
      password: creds.password,
      pin: creds.pin,
    });

    return res.status(result?.success ? 200 : 401).json({
      success: Boolean(result?.success),
      stage: result?.stage || "unknown",
      finalUrl: result?.finalUrl || "",
      pageTitle: result?.pageTitle || "",
      cookies: Number(result?.cookies || 0),
      error: result?.error || "",
      trace: Array.isArray(result?.trace) ? result.trace : [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Diagnostica login portale non riuscita",
      trace: [{ at: new Date().toISOString(), step: "diagnostics.exception", message: String(error?.message || "") }],
    });
  }
});

app.get("/api/candidati/all", async (req, res) => {
  const { data, error } = await withTenantFilter(supabase
    .from("waitlist")
    .select("id, status, created_at, candidate_id, candidates(nome, cognome, codice_fiscale, data_nascita, comune_nascita, provincia_nascita, raw_portale)"), req)
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
    foto_data_url: row.candidates?.raw_portale?.foto_data_url || null,
    firma_data_url: row.candidates?.raw_portale?.firma_data_url || null,
  }));

  res.json(normalizedData);
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

/* Punti patente (equivalente modConnPort.recuperasaldopunti / GeCA "Visualizza Saldo Punti") */
app.post("/api/portal/punti-patente", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const codiceFiscale = body.codiceFiscale || body.codice_fiscale;
    const numeroPatente = body.numeroPatente || body.numero_patente;
    if (!codiceFiscale || !numeroPatente) {
      return res.status(400).json({ error: "codice_fiscale e numero_patente sono obbligatori" });
    }

    // Reuse existing portal session jar if available (avoids re-login)
    let client = null;
    if (portalSession && portalSession.jar) {
      client = makeHttpClient(portalSession.jar);
    }

    // Resolve credentials from Supabase autoscuola record or env vars
    const creds = await resolvePortalCredentials(req);

    // getPuntiPatente uses HTTP-based login (portalConnector, not Puppeteer) when no client provided
    const result = await getPuntiPatente({
      codiceFiscale: String(codiceFiscale).trim(),
      numeroPatente: String(numeroPatente).trim(),
      client,
      username: body.username || creds.username,
      password: body.password || creds.password,
      pin: body.pin || creds.pin,
    });
    res.json(result != null ? result : { esito: false, error: "Nessun dato" });
  } catch (err) {
    console.error("Errore punti patente:", err.message);
    res.status(500).json({ error: err.message || "Errore interrogazione punti patente" });
  }
});

/* Resoconti (GeCA: conteggi, resocesami, resocon) + grafici */
const resocontiController = require("./controllers/resocontiController");
app.get("/api/resoconti/conteggi", requireAuth, resocontiController.conteggi);
app.get("/api/resoconti/esami", requireAuth, resocontiController.resocontoEsami);
app.get("/api/resoconti/incassi", requireAuth, resocontiController.resocontoIncassi);
app.get("/api/resoconti/grafici", requireAuth, resocontiController.grafici);

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

// Porta fissa: backend sempre sulla stessa (default 3000). Impostabile con variabile PORT.
const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`✓ Server avviato su http://localhost:${PORT}`);
});
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Errore: porta ${PORT} già in uso. Liberala o imposta PORT=altro in .env`);
  } else {
    console.error("Errore avvio server:", err.message || err);
  }
  process.exit(1);
});const { upsertCandidatesAndBookings } = require("./services/portalBackfillService");

app.post("/api/portal/backfill-prenotazioni-quiz", async (req, res) => {
  try {
    const rows = req.body?.rows || [];
    const result = await upsertCandidatesAndBookings(rows, req);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore backfill prenotazioni" });
  }
});