/**
 * ProgressPanel.js
 * ================
 * Hook e componente React per SSE progress streaming.
 *
 * Uso:
 *   const { messages, busy, error, result, run } = useProgressStream();
 *   await run("/api/trasmiss/portale/sessioni-esame", { method:"GET", params:{...} });
 *   // oppure
 *   await run("/api/trasmiss/portale/guide", { method:"POST", body:{...} });
 *
 * Componente:
 *   <ProgressPanel messages={messages} busy={busy} error={error} />
 */

"use client";

import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Hook useProgressStream
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   messages: string[],
 *   busy: boolean,
 *   error: string,
 *   result: any,
 *   run: (url: string, opts?: { method?: string, body?: object, params?: object, headers?: object }) => Promise<any>
 * }}
 */
export function useProgressStream() {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [result, setResult]     = useState(null);
  const esRef = useRef(null);

  const reset = useCallback(() => {
    setMessages([]);
    setBusy(false);
    setError("");
    setResult(null);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  }, []);

  /**
   * Esegui una chiamata SSE al backend.
   * Se il browser non supporta EventSource o la risposta non è SSE, cade back su fetch JSON.
   */
  const run = useCallback(async (url, opts = {}) => {
    reset();
    setBusy(true);

    const { method = "GET", body, params, headers: extraHeaders = {} } = opts;

    // Build final URL
    let finalUrl = url;
    if (params) {
      const qs = new URLSearchParams(params);
      finalUrl = `${url}?${qs}`;
    }

    // Auth token
    let tok = "";
    try { tok = localStorage.getItem("autoscuola_token") || ""; } catch (_) {}
    const authHeader = tok ? { Authorization: `Bearer ${tok}` } : {};

    // Try SSE via EventSource (only for GET; for POST we use fetch with streaming)
    if (method === "GET" && typeof EventSource !== "undefined") {
      return new Promise((resolve, reject) => {
        // Add sse=1 param to signal SSE mode
        const sseUrl = finalUrl.includes("?")
          ? `${finalUrl}&sse=1`
          : `${finalUrl}?sse=1`;

        // EventSource doesn't support custom headers in most browsers.
        // Workaround: append token as query param
        const urlWithToken = tok
          ? `${sseUrl}&_token=${encodeURIComponent(tok)}`
          : sseUrl;

        const es = new EventSource(urlWithToken);
        esRef.current = es;

        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.event === "progress" || data.event === "start") {
              if (data.message) setMessages((m) => [...m, data.message]);
            } else if (data.event === "done") {
              setBusy(false);
              es.close();
              esRef.current = null;
              if (data.error) { setError(data.error); reject(new Error(data.error)); }
              else { setResult(data); resolve(data); }
            } else if (data.event === "error") {
              setBusy(false);
              setError(data.message || "Errore sconosciuto");
              es.close();
              esRef.current = null;
              reject(new Error(data.message || "Errore"));
            }
          } catch (_) {}
        };

        es.onerror = () => {
          setBusy(false);
          setError("Connessione SSE interrotta");
          es.close();
          esRef.current = null;
          reject(new Error("Connessione SSE interrotta"));
        };
      });
    }

    // Fallback: fetch con ReadableStream (per POST o browser senza EventSource)
    try {
      const fetchOpts = {
        method,
        headers: {
          "Accept": "text/event-stream",
          "Content-Type": "application/json",
          ...authHeader,
          ...extraHeaders,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      };

      const res = await fetch(finalUrl, fetchOpts);

      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        // Streaming response
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalResult = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.event === "progress" || data.event === "start") {
                  if (data.message) setMessages((m) => [...m, data.message]);
                } else if (data.event === "done") {
                  finalResult = data;
                } else if (data.event === "error") {
                  throw new Error(data.message || "Errore SSE");
                }
              } catch (parseErr) {
                if (parseErr.message !== parseErr.message) throw parseErr;
              }
            }
          }
        }

        setBusy(false);
        if (finalResult?.error) {
          setError(finalResult.error);
          throw new Error(finalResult.error);
        }
        setResult(finalResult);
        return finalResult;
      } else {
        // Non-SSE JSON response
        const data = await res.json();
        setBusy(false);
        if (!res.ok || data.error) {
          setError(data.error || `HTTP ${res.status}`);
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setResult(data);
        return data;
      }
    } catch (e) {
      setBusy(false);
      setError(e.message || "Errore richiesta");
      throw e;
    }
  }, [reset]);

  return { messages, busy, error, result, run, reset };
}

// ---------------------------------------------------------------------------
// Componente ProgressPanel
// ---------------------------------------------------------------------------

/**
 * @param {{ messages: string[], busy: boolean, error: string, title?: string, maxHeight?: string }} props
 */
export function ProgressPanel({ messages, busy, error, title = "Progresso operazione", maxHeight = "200px" }) {
  if (!busy && messages.length === 0 && !error) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            In corso…
          </span>
        )}
        {!busy && !error && messages.length > 0 && (
          <span className="text-xs text-emerald-400">✅ Completato</span>
        )}
        {error && (
          <span className="text-xs text-red-400">❌ Errore</span>
        )}
      </div>
      <div
        className="p-3 overflow-y-auto font-mono text-xs space-y-0.5"
        style={{ maxHeight }}
        ref={(el) => { if (el && busy) el.scrollTop = el.scrollHeight; }}
      >
        {messages.map((m, i) => (
          <p key={i} className={`${m.startsWith("❌") ? "text-red-400" : m.startsWith("✅") ? "text-emerald-400" : "text-slate-300"}`}>
            {m}
          </p>
        ))}
        {error && <p className="text-red-400">❌ {error}</p>}
        {busy && <p className="text-slate-500 animate-pulse">▌</p>}
      </div>
    </div>
  );
}
