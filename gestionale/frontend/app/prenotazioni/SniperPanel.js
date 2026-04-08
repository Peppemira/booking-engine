"use client";

/**
 * SniperPanel — Pannello di controllo Sniper Engine
 * Connessione SSE real-time a /api/waitlist/sniper/stream
 * Mostra stato, log eventi live, start/stop/forceRun.
 */

import { useEffect, useRef, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const MAX_LOG = 60; // righe log visibili

const RESULT_COLOR = {
  ok:       "text-emerald-400",
  watching: "text-sky-400",
  booking:  "text-amber-400",
  booked:   "text-emerald-300",
  error:    "text-red-400",
  paused:   "text-slate-400",
  idle:     "text-slate-500",
  stopped:  "text-slate-500",
  starting: "text-yellow-300",
};

const RESULT_ICON = {
  ok:       "✅",
  watching: "👁️",
  booking:  "⚡",
  booked:   "🎯",
  error:    "❌",
  paused:   "⏸️",
  idle:     "💤",
  stopped:  "🔴",
  starting: "🟡",
};

function fmt(isoStr) {
  if (!isoStr) return "--";
  return new Date(isoStr).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SniperPanel() {
  const [status, setStatus]       = useState(null);
  const [log, setLog]             = useState([]);
  const [connected, setConnected] = useState(false);
  const [intervalMs, setIntervalMs] = useState(10000);
  const [busy, setBusy]           = useState(false);
  const esRef  = useRef(null);
  const logEnd = useRef(null);

  // Auto-scroll log
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  // SSE connection
  const connect = useCallback(() => {
    if (esRef.current) { esRef.current.close(); }

    const es = new EventSource(`${API}/api/waitlist/sniper/stream`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => { setConnected(false); };

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        const { event, at, ...data } = payload;

        if (event === "status") {
          setStatus(data);
        }

        // Aggiungi riga log per eventi interessanti
        if (["status", "tick", "booking", "booked", "error"].includes(event)) {
          const icon = event === "booked"  ? "🎯"
                     : event === "booking" ? "⚡"
                     : event === "tick"    ? "🔄"
                     : event === "error"   ? "❌"
                     : (RESULT_ICON[data.result] || "ℹ️");

          let msg = "";
          if (event === "booked")  msg = `Prenotato: ${data.nome || ""} (${data.elapsed}ms)`;
          else if (event === "booking") msg = `Prenoto: ${data.nome || ""} turno ${data.turno}`;
          else if (event === "tick") msg = `Ciclo #${data.cycle} — ${data.sessioni} sedute, ${data.pending} in attesa`;
          else msg = data.message || event;

          setLog(prev => {
            const next = [...prev, { icon, msg, at }];
            return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
          });

          if (event === "status") {
            setStatus(data);
          }
        }
      } catch (_) {}
    };

    return () => es.close();
  }, []);

  useEffect(() => {
    const cleanup = connect();
    return () => { cleanup?.(); esRef.current?.close(); };
  }, [connect]);

  async function apiCall(path, method = "POST", body) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/waitlist/${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return await r.json();
    } finally {
      setBusy(false);
    }
  }

  const handleStart = () => apiCall("sniper/start", "POST", { intervalMs });
  const handleStop  = () => apiCall("sniper/stop");
  const handleRun   = () => apiCall("sniper/run");

  const running = status?.running ?? false;
  const result  = status?.result  ?? "idle";
  const pulse   = running && result !== "stopped";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white">🎯 Sniper Engine</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-mono font-semibold ${
            running
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : "bg-slate-700 text-slate-400 border border-slate-600"
          }`}>
            {running ? "ATTIVO" : "FERMO"}
          </span>
          {/* Dot connessione SSE */}
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}`}
                title={connected ? "Stream connesso" : "Stream disconnesso"} />
        </div>
        <button
          onClick={connect}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          title="Riconnetti stream"
        >↺</button>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 bg-slate-850 border-b border-slate-800 flex items-center gap-3 text-sm">
        <span className={`text-lg ${pulse ? "animate-pulse" : ""}`}>{RESULT_ICON[result] || "ℹ️"}</span>
        <span className={`font-medium ${RESULT_COLOR[result] || "text-slate-400"}`}>
          {status?.message || "—"}
        </span>
        {status?.cycleCount > 0 && (
          <span className="ml-auto text-xs text-slate-500 font-mono">
            ciclo #{status.cycleCount}
          </span>
        )}
        {status?.lastAt && (
          <span className="text-xs text-slate-600 font-mono">{fmt(status.lastAt)}</span>
        )}
      </div>

      {/* Controlli */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-800">
        {/* Intervallo */}
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <span>ogni</span>
          <select
            value={intervalMs}
            onChange={e => setIntervalMs(Number(e.target.value))}
            className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-white text-xs"
            disabled={running}
          >
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={15000}>15s</option>
            <option value={30000}>30s</option>
            <option value={60000}>60s</option>
          </select>
        </div>

        {!running ? (
          <button
            onClick={handleStart}
            disabled={busy}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            ▶ Avvia
          </button>
        ) : (
          <button
            onClick={handleStop}
            disabled={busy}
            className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            ⏹ Ferma
          </button>
        )}

        <button
          onClick={handleRun}
          disabled={busy}
          className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          title="Esegui un singolo ciclo ora"
        >
          ⚡ Ciclo
        </button>

        {log.length > 0 && (
          <button
            onClick={() => setLog([])}
            className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            ✕ pulisci log
          </button>
        )}
      </div>

      {/* Log eventi */}
      <div className="h-48 overflow-y-auto font-mono text-xs bg-slate-950 px-3 py-2">
        {log.length === 0 ? (
          <p className="text-slate-700 italic mt-2">In attesa di eventi...</p>
        ) : (
          log.map((entry, i) => (
            <div key={i} className="flex gap-2 py-0.5 border-b border-slate-900 last:border-0">
              <span className="text-slate-600 shrink-0 w-20">{fmt(entry.at)}</span>
              <span className="shrink-0">{entry.icon}</span>
              <span className="text-slate-300">{entry.msg}</span>
            </div>
          ))
        )}
        <div ref={logEnd} />
      </div>

      {/* Footer stats */}
      {status && (
        <div className="px-4 py-2 text-xs text-slate-600 flex gap-4 border-t border-slate-800">
          <span>Sessione: <span className={status.sessionActive ? "text-emerald-500" : "text-slate-500"}>
            {status.sessionActive ? "attiva" : "non attiva"}
          </span></span>
          {status.intervalMs && (
            <span>Intervallo: <span className="text-slate-400">{status.intervalMs / 1000}s</span></span>
          )}
        </div>
      )}
    </div>
  );
}
