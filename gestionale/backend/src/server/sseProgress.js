/**
 * sseProgress.js
 * ==============
 * Utility per SSE (Server-Sent Events) progress streaming.
 * Usato dai controller Puppeteer-based (trasmissioni portale) per
 * inviare aggiornamenti real-time al frontend.
 *
 * Pattern:
 *   const sse = setupSSE(req, res);
 *   if (!sse) return; // risposta JSON classica gestita dal caller
 *   sse.emit("start", { message: "Avvio operazione..." });
 *   // ... operazione lunga ...
 *   sse.emit("progress", { message: "Step 2/3...", pct: 66 });
 *   sse.done({ success: true, ... });
 */

"use strict";

/**
 * Inizializza SSE se il client lo supporta.
 * Ritorna un oggetto { emit, done, isSSE } oppure null se non SSE.
 *
 * @param {Request}  req
 * @param {Response} res
 * @returns {{ emit(event, data): void, done(result): void, isSSE: true } | null}
 */
function setupSSE(req, res) {
  const wantsSSE = (req.headers.accept || "").includes("text/event-stream") ||
                   req.query?.sse === "1";
  if (!wantsSSE) return null;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  const emit = (event, data = {}) => {
    try {
      res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch (_) { /* client disconnected */ }
  };

  const done = (result = {}) => {
    emit("done", result);
    res.end();
  };

  return { emit, done, isSSE: true };
}

/**
 * Crea una funzione logMsg che emette sia nel log array che via SSE.
 *
 * @param {Array}    log       - Array dove aggiungere i messaggi
 * @param {function} onProgress - Callback opzionale onProgress({ message })
 * @returns {function} logMsg(message)
 */
function makeLogMsg(log, onProgress = null) {
  return function logMsg(message) {
    log.push(message);
    if (onProgress) {
      try { onProgress({ message }); } catch (_) {}
    }
  };
}

/**
 * Wrapper generico: esegue una funzione Puppeteer e risponde con SSE o JSON.
 *
 * @param {Request}  req
 * @param {Response} res
 * @param {function} fn   - async fn(onProgress) → { success, log, ...rest }
 */
async function runWithSSE(req, res, fn) {
  const sse = setupSSE(req, res);

  if (sse) {
    sse.emit("start", { message: "Operazione avviata..." });
    try {
      const result = await fn((data) => sse.emit("progress", data));
      sse.done(result);
    } catch (err) {
      sse.done({ success: false, error: err.message });
    }
  } else {
    try {
      const result = await fn(null);
      if (!result.success) return res.status(500).json({ error: result.error, log: result.log });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = { setupSSE, makeLogMsg, runWithSSE };
