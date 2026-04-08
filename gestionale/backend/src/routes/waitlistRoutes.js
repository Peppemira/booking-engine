/**
 * Route REST per waitlist (lista d'attesa prenotazione esami).
 * Base path: /api/waitlist
 */

const router = require("express").Router();
const waitlistController = require("../controllers/waitlistController");
const { requireAuth } = require("../server/auth");
const sniper = require("../sniperEngine");

// ---------------------------------------------------------------------------
// CRUD waitlist
// ---------------------------------------------------------------------------
router.get("/", requireAuth, waitlistController.list);
router.get("/queue", requireAuth, waitlistController.queue);
router.post("/", requireAuth, waitlistController.create);
router.post("/bulk", requireAuth, waitlistController.bulk);
router.post("/from-portal", requireAuth, waitlistController.fromPortal);
router.post("/select", requireAuth, waitlistController.select);
router.put("/:id", requireAuth, waitlistController.update);
router.delete("/:id", requireAuth, waitlistController.remove);
router.patch("/:id/priority", requireAuth, waitlistController.updatePriority);
router.post("/:id/retry", requireAuth, waitlistController.retry);

// ---------------------------------------------------------------------------
// SNIPER ENGINE — controllo e stream real-time
// ---------------------------------------------------------------------------

/** GET /api/waitlist/sniper/status  — stato corrente */
router.get("/sniper/status", requireAuth, (req, res) => {
  res.json(sniper.getStatus());
});

/** POST /api/waitlist/sniper/start  — avvia motore */
router.post("/sniper/start", requireAuth, (req, res) => {
  const { intervalMs } = req.body || {};
  sniper.start({ intervalMs: intervalMs ? Number(intervalMs) : undefined });
  res.json({ success: true, status: sniper.getStatus() });
});

/** POST /api/waitlist/sniper/stop   — ferma motore */
router.post("/sniper/stop", requireAuth, (req, res) => {
  sniper.stop();
  res.json({ success: true, status: sniper.getStatus() });
});

/** POST /api/waitlist/sniper/run    — singolo ciclo forzato */
router.post("/sniper/run", requireAuth, async (req, res) => {
  try {
    await sniper.forceRun();
    res.json({ success: true, status: sniper.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/waitlist/sniper/stream
 * Server-Sent Events: il frontend riceve aggiornamenti in tempo reale.
 * Emette: tick, booking, booked, error, status
 *
 * Esempio client-side:
 *   const es = new EventSource('/api/waitlist/sniper/stream');
 *   es.onmessage = e => console.log(JSON.parse(e.data));
 */
router.get("/sniper/stream", requireAuth, (req, res) => {
  res.set({
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Stato iniziale
  const initial = sniper.getStatus();
  res.write(`data: ${JSON.stringify({ event: "status", ...initial })}\n\n`);

  // Sottoscrivi agli eventi sniper
  const unsub = sniper.subscribe((payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (_) { /* client disconnesso */ }
  });

  // Heartbeat ogni 25s
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch (_) {}
  }, 25_000);

  req.on("close", () => {
    unsub();
    clearInterval(heartbeat);
  });
});

module.exports = router;
