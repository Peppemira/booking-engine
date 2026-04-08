/**
 * Route REST per Google Calendar / eventi (scadenze, guide, appuntamenti).
 */

const router = require("express").Router();
const { calendarController } = require("../controllers");
const { requireAuth } = require("../server/auth");

// Gestionale events (Supabase)
router.get("/events", requireAuth, calendarController.getEvents);
router.post("/events", requireAuth, calendarController.createEvent);
router.delete("/events/:id", requireAuth, calendarController.deleteEvent);

// Google Calendar OAuth
router.get("/google/status", requireAuth, calendarController.googleStatus);
router.get("/google/auth-url", requireAuth, calendarController.googleAuthUrl);
router.get("/google/callback", calendarController.googleCallback); // no requireAuth: redirect da Google
router.delete("/google/disconnect", requireAuth, calendarController.googleDisconnect);

// Google Calendar events
router.get("/google/events", requireAuth, calendarController.googleEvents);
router.post("/google/events", requireAuth, calendarController.googleCreateEvent);
router.delete("/google/events/:googleEventId", requireAuth, calendarController.googleDeleteEvent);

module.exports = router;
