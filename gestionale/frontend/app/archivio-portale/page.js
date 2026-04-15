"use client";

/**
 * ARCHIVIO STORICO PORTALE AUTOMOBILISTA
 * ========================================
 * Pagina dedicata per scaricare e gestire l'archivio storico COMPLETO
 * dal Portale dell'Automobilista.
 *
 * Copre:
 *   - Candidati da verbali esami (4 combinazioni P/T, Q/T, P/G, Q/G)
 *   - Rinnovi patente (tutti stati, tutti anni)
 *   - Rinnovi medici (TT2112)
 *   - Rinnovi/conseguimento CQC
 *
 * Funzionalità:
 *   - Dashboard con riepilogo (conteggi per tipo/stato)
 *   - Avvio sync storico completo (manuale)
 *   - Progress bar SSE in tempo reale
 *   - Log degli ultimi run di sincronizzazione
 *   - Aggiornamento automatico ogni N minuti (sync incrementale real-time)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateIT(s) {
  if (!s) return "–";
  const str = String(s).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(str + "T00:00:00Z").toLocaleDateString("it-IT");
  }
  return str;
}

function formatDateTimeIT(s) {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleString("it-IT");
  } catch (_) {
    return String(s);
  }
}

function formatDurationMs(ms) {
  if (!ms && ms !== 0) return "–";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return `${h}h ${remMin}m`;
}

const TIPO_RINNOVO_LABEL = {
  patente:   "🪪 Rinnovo Patente",
  medico:    "⚕️ Cert. Medico TT2112",
  cqc:       "🚛 Rinnovo / Emissione CQC",
  duplicato: "📋 Duplicato",
  altro:     "📌 Altro",
};

const FASE_LABEL = {
  login: "🔐 Login al portale",
  fase1_esami_start:          "📋 Fase 1 – Candidati da verbali esami",
  fase1_esami_progress:       "📋 Fase 1 – Candidati da verbali esami",
  fase1_esami_done:           "✅ Fase 1 completata",
  fase2_rinnovi_pat_start:    "🪪 Fase 2 – Rinnovi patente",
  fase2_rinnovi_pat_progress: "🪪 Fase 2 – Rinnovi patente",
  fase2_rinnovi_pat_done:     "✅ Fase 2 completata",
  // Strategia A patenti (bypass limite 31 giorni)
  fase2b_strategia_a_start:    "🎯 Fase 2B – Strategia A patenti (bypass 31gg)",
  fase2b_strategia_a_persone:  "🎯 Fase 2B – Raccolta persone",
  fase2b_strategia_a_progress: "🎯 Fase 2B – Ricerca puntuale",
  fase2b_strategia_a_done:     "✅ Fase 2B completata",
  strategia_a_ricerca_persone: "🎯 Strategia A – Ricerca persona",
  strategia_a_dettaglio:       "🎯 Strategia A – Dettaglio rinnovo",
  fase3_rinnovi_med_start:    "⚕️ Fase 3 – Rinnovi medici (TT2112)",
  fase3_rinnovi_med_progress: "⚕️ Fase 3 – Rinnovi medici",
  fase3_rinnovi_med_done:     "✅ Fase 3 completata",
  // Strategia A medici
  fase3b_strategia_a_medici_start:    "🎯 Fase 3B – Strategia A medici",
  fase3b_strategia_a_medici_persone:  "🎯 Fase 3B – Raccolta persone",
  fase3b_strategia_a_medici_progress: "🎯 Fase 3B – Ricerca medici",
  fase3b_strategia_a_medici_done:     "✅ Fase 3B completata",
  strategia_a_medici_ricerca_persone: "🎯 Strategia A medici – Ricerca persona",
  strategia_a_medici_dettaglio:       "🎯 Strategia A medici – Dettaglio",
  fase4_rinnovi_cqc_start:    "🚛 Fase 4 – Rinnovi CQC",
  fase4_rinnovi_cqc_progress: "🚛 Fase 4 – Rinnovi CQC",
  fase4_rinnovi_cqc_done:     "✅ Fase 4 completata",
  // Strategia A CQC
  fase4b_strategia_a_cqc_start:    "🎯 Fase 4B – Strategia A CQC",
  fase4b_strategia_a_cqc_persone:  "🎯 Fase 4B – Raccolta persone",
  fase4b_strategia_a_cqc_progress: "🎯 Fase 4B – Ricerca CQC",
  fase4b_strategia_a_cqc_done:     "✅ Fase 4B completata",
  strategia_a_cqc_ricerca_persone: "🎯 Strategia A CQC – Ricerca persona",
  strategia_a_cqc_dettaglio:       "🎯 Strategia A CQC – Dettaglio",
  completed:                  "🎉 Sync completato",
};

export default function ArchivioPortalePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // ── Dashboard
  const [riepilogo, setRiepilogo] = useState(null);
  const [loadingRiepilogo, setLoadingRiepilogo] = useState(false);
  const [runLog, setRunLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);

  // ── Form sync
  const [dataInizio, setDataInizio] = useState("2000-01-01");
  const [dataFine,   setDataFine]   = useState(todayISO());
  const [includeEsami,       setIncludeEsami]       = useState(true);
  const [includeRinnoviPat,  setIncludeRinnoviPat]  = useState(true);
  const [includeRinnoviMed,  setIncludeRinnoviMed]  = useState(true);
  const [includeRinnoviCqc,  setIncludeRinnoviCqc]  = useState(true);
  const [windowDays, setWindowDays] = useState(180);
  // STRATEGIA A — ricerca puntuale per persona (bypass limite 31 giorni)
  const [includeStrategiaA, setIncludeStrategiaA]       = useState(true);
  const [strategiaAMaxPersone, setStrategiaAMaxPersone] = useState(0); // 0 = nessun limite
  const [strategiaADelayMs, setStrategiaADelayMs]       = useState(400);

  // ── Progress sync
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessages, setSyncMessages] = useState([]);
  const [syncResult, setSyncResult] = useState(null);
  const syncAbortRef = useRef(null);

  // ── Auto refresh incrementale
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(5);
  const autoRefreshTimerRef = useRef(null);
  const [lastAutoRefresh, setLastAutoRefresh] = useState(null);

  // ── SESSIONE
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await checkSession();
        if (!session || !session.ok) {
          if (!cancelled) router.replace("/login");
          return;
        }
        if (!cancelled) setUser(session.autoscuola || null);
      } catch (_) {
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setLoadingAuth(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // ── LOAD dashboard data
  const loadRiepilogo = useCallback(async () => {
    setLoadingRiepilogo(true);
    try {
      const res = await fetch(`${API_BASE}/api/sync/archivio-riepilogo`, {
        headers: authHeaders(),
        cache: "no-cache",
      });
      const data = await res.json();
      if (data.success) setRiepilogo(data.riepilogo || null);
    } catch (e) {
      console.warn("loadRiepilogo", e);
    } finally {
      setLoadingRiepilogo(false);
    }
  }, []);

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch(`${API_BASE}/api/sync/archivio-log?limit=20`, {
        headers: authHeaders(),
        cache: "no-cache",
      });
      const data = await res.json();
      if (data.success) setRunLog(data.runs || []);
    } catch (e) {
      console.warn("loadLog", e);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    if (!loadingAuth && user) {
      loadRiepilogo();
      loadLog();
    }
  }, [loadingAuth, user, loadRiepilogo, loadLog]);

  // ── AVVIO SYNC (SSE)
  const avviaSync = useCallback(async (opts = {}) => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncMessages([]);
    setSyncResult(null);

    const body = {
      includeEsami,
      includeRinnoviPat,
      includeRinnoviMed,
      includeRinnoviCqc,
      includeStrategiaA,
      strategiaAMaxPersone: Number(strategiaAMaxPersone) || 0,
      strategiaADelayMs: Number(strategiaADelayMs) || 400,
      dataInizio,
      dataFine,
      windowDays,
      tipoSync: opts.tipoSync || "full",
      triggerSource: opts.triggerSource || "manuale",
      ...opts,
    };

    const addMessage = (msg) => {
      setSyncMessages((prev) => [
        ...prev,
        { ts: new Date().toISOString(), ...msg },
      ].slice(-100));
    };

    try {
      const controller = new AbortController();
      syncAbortRef.current = controller;

      const res = await fetch(`${API_BASE}/api/sync/archivio-storico-completo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...authHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              addMessage(ev);
              if (ev.event === "done") {
                setSyncResult(ev);
              } else if (ev.event === "error") {
                setSyncResult({ event: "error", message: ev.message });
              }
            } catch (_) {}
          }
        }
      } else {
        const data = await res.json();
        addMessage({ event: "done", ...data });
        setSyncResult(data);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        addMessage({ event: "error", message: err.message });
        setSyncResult({ event: "error", message: err.message });
      }
    } finally {
      setSyncBusy(false);
      syncAbortRef.current = null;
      // Ricarica dashboard
      loadRiepilogo();
      loadLog();
    }
  }, [
    syncBusy, includeEsami, includeRinnoviPat, includeRinnoviMed,
    includeRinnoviCqc, includeStrategiaA, strategiaAMaxPersone, strategiaADelayMs,
    dataInizio, dataFine, windowDays,
    loadRiepilogo, loadLog,
  ]);

  const cancelSync = useCallback(() => {
    if (syncAbortRef.current) {
      try { syncAbortRef.current.abort(); } catch (_) {}
    }
    setSyncBusy(false);
  }, []);

  // ── AUTO-REFRESH INCREMENTALE (TEMPO REALE)
  // Ogni N minuti esegue un sync incrementale degli ultimi 7 giorni
  // per mantenere l'archivio allineato in "tempo reale".
  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    if (!autoRefresh || loadingAuth || !user) return;

    const minutes = Math.max(1, Number(autoRefreshMinutes) || 5);
    const intervalMs = minutes * 60 * 1000;

    const tick = async () => {
      if (syncBusy) return;
      try {
        // Sync incrementale: solo ultimi 7 giorni, senza esami (troppo lento)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const di = weekAgo.toISOString().slice(0, 10);

        await fetch(`${API_BASE}/api/sync/archivio-storico-completo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            includeEsami: false,
            includeRinnoviPat: true,
            includeRinnoviMed: true,
            includeRinnoviCqc: true,
            dataInizio: di,
            dataFine: todayISO(),
            windowDays: 30,
            tipoSync: "incrementale",
            triggerSource: "auto-refresh",
          }),
        });

        setLastAutoRefresh(new Date().toISOString());
        loadRiepilogo();
        loadLog();
      } catch (e) {
        console.warn("auto-refresh error", e);
      }
    };

    autoRefreshTimerRef.current = setInterval(tick, intervalMs);

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [autoRefresh, autoRefreshMinutes, loadingAuth, user, syncBusy, loadRiepilogo, loadLog]);

  const onLogout = useCallback(async () => {
    try { await logoutSession(); } catch (_) {}
    router.replace("/login");
  }, [router]);

  if (loadingAuth) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>Caricamento sessione…</div>
    );
  }

  // ── RENDER
  const tipiContati = riepilogo?.rinnovi_per_tipo || {};

  return (
    <ModernAppShell
      user={user}
      onLogout={onLogout}
      activeKey="archivio-portale"
      title="Archivio Storico Portale"
      subtitle="Sync completo dal Portale dell'Automobilista"
    >
      <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>📚 Archivio Storico Portale</h1>
            <p style={{ margin: "8px 0 0", color: "#666" }}>
              Scarica e mantieni aggiornato l'archivio completo dal Portale dell'Automobilista
              (candidati esami + rinnovi patente / medici / CQC).
            </p>
          </div>
          <button
            onClick={() => { loadRiepilogo(); loadLog(); }}
            disabled={loadingRiepilogo || loadingLog}
            style={{
              padding: "10px 20px", background: "#0066cc", color: "white",
              border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14,
            }}
          >
            🔄 Aggiorna dashboard
          </button>
        </div>

        {/* ──── RIEPILOGO (DASHBOARD CARDS) ──── */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))",
          gap: 16, marginBottom: 24,
        }}>
          <Card
            title="👥 Candidati totali"
            value={riepilogo?.candidati_totali ?? "–"}
            subtitle="Dall'archivio portale"
            color="#e3f2fd"
          />
          <Card
            title="🪪 Rinnovi patente"
            value={tipiContati.patente || 0}
            subtitle="Stati: tutti"
            color="#fff3e0"
          />
          <Card
            title="⚕️ Rinnovi medici TT2112"
            value={tipiContati.medico || 0}
            subtitle="Certificati medici"
            color="#f3e5f5"
          />
          <Card
            title="🚛 Rinnovi CQC"
            value={tipiContati.cqc || 0}
            subtitle="CQC merci/persone"
            color="#e8f5e9"
          />
          <Card
            title="📊 Rinnovi totali"
            value={riepilogo?.rinnovi_totali ?? "–"}
            subtitle={`Primo: ${formatDateIT(riepilogo?.primo_inserimento)}`}
            color="#ffebee"
          />
          <Card
            title="⏱ Ultimo sync"
            value={riepilogo?.ultimo_sync ? formatDateTimeIT(riepilogo.ultimo_sync) : "–"}
            subtitle={lastAutoRefresh ? `Auto: ${formatDateTimeIT(lastAutoRefresh)}` : "Manuale"}
            color="#f5f5f5"
          />
        </div>

        {/* ──── FORM SYNC ──── */}
        <div style={{
          background: "white", padding: 20, borderRadius: 8,
          border: "1px solid #e0e0e0", marginBottom: 20,
        }}>
          <h2 style={{ marginTop: 0 }}>⚙️ Configurazione Sync</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
            <FormField label="Data inizio">
              <input
                type="date" value={dataInizio}
                onChange={(e) => setDataInizio(e.target.value)}
                disabled={syncBusy}
                style={inputStyle}
              />
              <small style={{ color: "#666" }}>Default 2000-01-01 = tutto lo storico</small>
            </FormField>

            <FormField label="Data fine">
              <input
                type="date" value={dataFine}
                onChange={(e) => setDataFine(e.target.value)}
                disabled={syncBusy}
                style={inputStyle}
              />
            </FormField>

            <FormField label="Finestra iterazione (giorni)">
              <input
                type="number" value={windowDays} min={30} max={365}
                onChange={(e) => setWindowDays(parseInt(e.target.value, 10) || 180)}
                disabled={syncBusy}
                style={inputStyle}
              />
              <small style={{ color: "#666" }}>Raggio di scansione per ogni chiamata</small>
            </FormField>
          </div>

          <h3 style={{ marginBottom: 8 }}>Categorie da scaricare</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
            <Checkbox
              label="📋 Candidati da verbali esami (4 combinazioni)"
              checked={includeEsami}
              onChange={setIncludeEsami}
              disabled={syncBusy}
            />
            <Checkbox
              label="🪪 Rinnovi patente (tutti stati)"
              checked={includeRinnoviPat}
              onChange={setIncludeRinnoviPat}
              disabled={syncBusy}
            />
            <Checkbox
              label="⚕️ Rinnovi medici TT2112"
              checked={includeRinnoviMed}
              onChange={setIncludeRinnoviMed}
              disabled={syncBusy}
            />
            <Checkbox
              label="🚛 Rinnovi / Conseguimento CQC"
              checked={includeRinnoviCqc}
              onChange={setIncludeRinnoviCqc}
              disabled={syncBusy}
            />
          </div>

          {/* ──── STRATEGIA A (bypass limite 31 giorni) ──── */}
          <div style={{
            background: "#f0f9ff",
            border: "1px solid #93c5fd",
            borderRadius: 8,
            padding: 14,
            marginBottom: 16,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Checkbox
                label="🎯 Strategia A — Ricerca puntuale per persona (bypass limite 31 giorni)"
                checked={includeStrategiaA}
                onChange={setIncludeStrategiaA}
                disabled={syncBusy}
              />
            </div>
            <p style={{ margin: "0 0 10px 28px", fontSize: 12, color: "#4b5563" }}>
              Per ogni candidato/rinnovo già noto nel DB locale, interroga il portale con il filtro
              <code style={{ background: "#dbeafe", padding: "0 4px", borderRadius: 3 }}>(Cognome+Patente)</code> o
              <code style={{ background: "#dbeafe", padding: "0 4px", borderRadius: 3 }}>(CF+Patente)</code> senza
              date, recuperando TUTTI i rinnovi storici della persona (anche oltre i 31 giorni del portale).
              Applicato a <b>patenti, medici TT2112 e CQC</b>.
            </p>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginLeft: 28,
            }}>
              <FormField label="Max persone da iterare (0 = nessun limite)">
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={strategiaAMaxPersone}
                  onChange={(e) => setStrategiaAMaxPersone(parseInt(e.target.value, 10) || 0)}
                  disabled={syncBusy || !includeStrategiaA}
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Pausa tra chiamate (ms)">
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  value={strategiaADelayMs}
                  onChange={(e) => setStrategiaADelayMs(parseInt(e.target.value, 10) || 400)}
                  disabled={syncBusy || !includeStrategiaA}
                  style={inputStyle}
                />
              </FormField>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", borderTop: "1px solid #eee", paddingTop: 16, flexWrap: "wrap" }}>
            <button
              onClick={() => avviaSync()}
              disabled={syncBusy}
              style={{
                padding: "12px 24px",
                background: syncBusy ? "#999" : "#28a745",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: syncBusy ? "not-allowed" : "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {syncBusy ? "⏳ Sync in corso…" : "🚀 Avvia sync storico completo"}
            </button>

            <button
              onClick={() => avviaSync({
                includeEsami: false,
                includeRinnoviPat: true,
                includeRinnoviMed: true,
                includeRinnoviCqc: true,
                includeStrategiaA: true,
                tipoSync: "strategia_a",
                triggerSource: "manuale_strategia_a",
              })}
              disabled={syncBusy}
              title="Lancia SOLO la Strategia A (patenti+medici+CQC) — salta la fase baseline per andare più veloce"
              style={{
                padding: "12px 20px",
                background: syncBusy ? "#999" : "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: syncBusy ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              🎯 Solo Strategia A (rapido)
            </button>

            {syncBusy && (
              <button onClick={cancelSync} style={{
                padding: "12px 20px", background: "#dc3545", color: "white",
                border: "none", borderRadius: 6, cursor: "pointer",
              }}>
                ⏹ Interrompi
              </button>
            )}
          </div>
        </div>

        {/* ──── AUTO REFRESH (TEMPO REALE) ──── */}
        <div style={{
          background: "#fffbe6", padding: 16, borderRadius: 8,
          border: "1px solid #ffe58f", marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Checkbox
              label="🔴 Aggiornamento tempo reale (sync incrementale automatico)"
              checked={autoRefresh}
              onChange={setAutoRefresh}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Ogni
              <input
                type="number" min={1} max={60} value={autoRefreshMinutes}
                onChange={(e) => setAutoRefreshMinutes(parseInt(e.target.value, 10) || 5)}
                disabled={!autoRefresh}
                style={{ ...inputStyle, width: 70 }}
              />
              minuti
            </label>
            {lastAutoRefresh && (
              <span style={{ color: "#666", fontSize: 13 }}>
                Ultimo auto-refresh: {formatDateTimeIT(lastAutoRefresh)}
              </span>
            )}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#666" }}>
            Scarica automaticamente solo i rinnovi più recenti (ultimi 7 giorni) per mantenere
            il database allineato con il portale senza attendere il sync completo.
          </p>
        </div>

        {/* ──── PROGRESS MESSAGES ──── */}
        {syncMessages.length > 0 && (
          <div style={{
            background: "#1e1e1e", color: "#d4d4d4", padding: 16,
            borderRadius: 8, marginBottom: 20, fontFamily: "monospace",
            fontSize: 13, maxHeight: 320, overflowY: "auto",
          }}>
            <div style={{ color: "#569cd6", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
              📟 Log sincronizzazione
            </div>
            {syncMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: "#888" }}>
                  [{new Date(m.ts).toLocaleTimeString("it-IT")}]
                </span>{" "}
                <span style={{
                  color: m.event === "error" ? "#f48771" :
                         m.event === "done"  ? "#73c991" :
                         m.event === "start" ? "#dcdcaa" : "#9cdcfe",
                }}>
                  {FASE_LABEL[m.fase] || m.event || m.fase || "?"}
                </span>
                {m.message && <span> — {m.message}</span>}
                {m.raccolti !== undefined && (
                  <span> — raccolti: {m.raccolti}/{m.totale || "?"}</span>
                )}
                {m.count !== undefined && <span> — totale: {m.count}</span>}
                {m.completate !== undefined && m.totale !== undefined && (
                  <span> — finestra {m.completate}/{m.totale}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {syncResult && syncResult.event === "done" && (
          <div style={{
            background: "#d4edda", color: "#155724", padding: 16,
            borderRadius: 8, marginBottom: 20, border: "1px solid #c3e6cb",
          }}>
            <h3 style={{ marginTop: 0 }}>✅ Sync completato con successo</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Stat label="Candidati trovati" value={syncResult.candidati_trovati} />
              <Stat label="Candidati inseriti" value={syncResult.candidati_inseriti} />
              <Stat label="Rinnovi trovati" value={syncResult.rinnovi_trovati} />
              <Stat label="Rinnovi inseriti" value={syncResult.rinnovi_inseriti} />
              <Stat label="Rinnovi aggiornati" value={syncResult.rinnovi_aggiornati} />
              <Stat label="Errori" value={syncResult.errori} />
            </div>

            {(syncResult.strategia_a_persone_iterate > 0 ||
              syncResult.strategia_a_medici_persone_iterate > 0 ||
              syncResult.strategia_a_cqc_persone_iterate > 0) && (
              <div style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px dashed #86cfa5",
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>🎯 Statistiche Strategia A</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  <Stat
                    label="Patenti — persone iterate"
                    value={syncResult.strategia_a_persone_iterate}
                  />
                  <Stat
                    label="Patenti — rinnovi trovati"
                    value={syncResult.strategia_a_rinnovi_trovati}
                  />
                  <Stat
                    label="Patenti — media/persona"
                    value={
                      syncResult.strategia_a_persone_iterate
                        ? (syncResult.strategia_a_rinnovi_trovati / syncResult.strategia_a_persone_iterate).toFixed(1)
                        : "0"
                    }
                  />
                  <Stat
                    label="Medici — persone iterate"
                    value={syncResult.strategia_a_medici_persone_iterate}
                  />
                  <Stat
                    label="Medici — rinnovi trovati"
                    value={syncResult.strategia_a_medici_rinnovi_trovati}
                  />
                  <Stat
                    label="Medici — disponibile?"
                    value={syncResult.strategia_a_medici_servizio_non_disponibile ? "❌ NO" : "✓ SI"}
                  />
                  <Stat
                    label="CQC — persone iterate"
                    value={syncResult.strategia_a_cqc_persone_iterate}
                  />
                  <Stat
                    label="CQC — rinnovi trovati"
                    value={syncResult.strategia_a_cqc_rinnovi_trovati}
                  />
                  <Stat
                    label="CQC — disponibile?"
                    value={syncResult.strategia_a_cqc_servizio_non_disponibile ? "❌ NO" : "✓ SI"}
                  />
                </div>
              </div>
            )}

            <p style={{ margin: "12px 0 0", fontSize: 13 }}>
              Durata: {formatDurationMs(syncResult.durationMs)}
            </p>
          </div>
        )}

        {syncResult && syncResult.event === "error" && (
          <div style={{
            background: "#f8d7da", color: "#721c24", padding: 16,
            borderRadius: 8, marginBottom: 20, border: "1px solid #f5c6cb",
          }}>
            ❌ Errore: {syncResult.message}
          </div>
        )}

        {/* ──── LOG RUN ──── */}
        <div style={{
          background: "white", padding: 20, borderRadius: 8,
          border: "1px solid #e0e0e0",
        }}>
          <h2 style={{ marginTop: 0 }}>📜 Storico run di sincronizzazione</h2>
          {loadingLog ? (
            <p>Caricamento…</p>
          ) : runLog.length === 0 ? (
            <p style={{ color: "#999" }}>Nessun run ancora eseguito.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={th}>Avvio</th>
                    <th style={th}>Tipo</th>
                    <th style={th}>Stato</th>
                    <th style={th}>Candidati</th>
                    <th style={th}>Rinnovi (trov/ins/agg)</th>
                    <th style={th}>Errori</th>
                    <th style={th}>Durata</th>
                    <th style={th}>Trigger</th>
                  </tr>
                </thead>
                <tbody>
                  {runLog.map((run) => (
                    <tr key={run.id} style={{ borderTop: "1px solid #eee" }}>
                      <td style={td}>{formatDateTimeIT(run.started_at)}</td>
                      <td style={td}>{run.tipo_sync}</td>
                      <td style={{
                        ...td,
                        color: run.stato === "success" ? "#28a745" :
                               run.stato === "failed"  ? "#dc3545" :
                               run.stato === "running" ? "#ffc107" : "#666",
                        fontWeight: 600,
                      }}>
                        {run.stato}
                      </td>
                      <td style={td}>{run.candidati_trovati}</td>
                      <td style={td}>
                        {run.rinnovi_trovati} / {run.rinnovi_inseriti} / {run.rinnovi_aggiornati}
                      </td>
                      <td style={{ ...td, color: run.errori > 0 ? "#dc3545" : "#666" }}>
                        {run.errori}
                      </td>
                      <td style={td}>{formatDurationMs(run.duration_ms)}</td>
                      <td style={td}>{run.trigger_source || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </ModernAppShell>
  );
}

// ──────────────────────── COMPONENTI HELPER ────────────────────────

function Card({ title, value, subtitle, color }) {
  return (
    <div style={{
      background: color || "white",
      padding: 18,
      borderRadius: 8,
      border: "1px solid #e0e0e0",
    }}>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: "#888" }}>{subtitle}</div>}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Checkbox({ label, checked, onChange, disabled }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer" }}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#0c5460" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value ?? 0}</div>
    </div>
  );
}

const inputStyle = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 14,
  width: "100%",
};

const th = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "2px solid #ddd",
};

const td = {
  padding: "8px 12px",
};
