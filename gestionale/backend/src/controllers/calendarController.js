/**
 * Controller REST per Google Calendar / eventi (scadenze, guide, appuntamenti).
 * - Gestionale events: salvati in Supabase (calendar_events)
 * - Google Calendar: OAuth2 per autoscuola, via googleCalendarService
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const googleCal = require("../services/googleCalendarService");

function getAutoscuolaId(req) {
  return req.autoscuola?.id || req.autoscuolaId || null;
}

// =============================================================================
// Gestionale events (Supabase calendar_events)
// =============================================================================

async function getEvents(req, res) {
  try {
    const start = req.query?.start;
    const end = req.query?.end;
    const tipo = req.query?.tipo;

    if (!start || !end) {
      return res.status(400).json({ error: "Parametri start e end obbligatori (ISO date)" });
    }

    let q = supabase
      .from("calendar_events")
      .select("*")
      .gte("end_at", start)
      .lte("start_at", end)
      .order("start_at", { ascending: true });

    q = withTenantFilter(q, req);
    if (tipo) q = q.eq("tipo", tipo);

    const { data, error } = await q;

    if (error) {
      if (error.code === "42P01") {
        return res.json({ success: true, events: [], message: "Tabella calendar_events non esistente. Esegui lo script SQL." });
      }
      throw error;
    }

    res.json({ success: true, events: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Errore lettura eventi" });
  }
}

async function createEvent(req, res) {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) return res.status(400).json({ error: "Titolo obbligatorio" });

    const startAt = body.start_at;
    const endAt = body.end_at;
    if (!startAt || !endAt) return res.status(400).json({ error: "start_at e end_at obbligatori (ISO)" });

    const payload = {
      title,
      description: String(body.description || "").trim() || null,
      tipo: ["scadenza", "guida", "appuntamento", "lezione", "esame", "altro"].includes(body.tipo)
        ? body.tipo
        : "appuntamento",
      start_at: startAt,
      end_at: endAt,
      all_day: Boolean(body.all_day),
      candidate_id: body.candidate_id || null,
      color: String(body.color || "").trim() || null,
      google_event_id: null,
      ...tenantField(req),
    };

    const { data, error } = await supabase
      .from("calendar_events")
      .insert([payload])
      .select()
      .single();

    if (error) {
      if (error.code === "42P01") {
        return res.status(503).json({ error: "Tabella calendar_events non esistente. Esegui lo script SQL." });
      }
      throw error;
    }

    // Sync opzionale su Google Calendar
    let googleEventId = null;
    if (body.sync_google !== false) {
      const autoscuolaId = getAutoscuolaId(req);
      if (autoscuolaId && googleCal.isConfigured()) {
        try {
          const gev = await googleCal.createEvent(autoscuolaId, {
            title: payload.title,
            description: payload.description || "",
            start_at: startAt,
            end_at: endAt,
            all_day: payload.all_day,
          });
          googleEventId = gev?.id || null;
          if (googleEventId) {
            await supabase
              .from("calendar_events")
              .update({ google_event_id: googleEventId })
              .eq("id", data.id);
          }
        } catch (gErr) {
          console.warn("[calendarController] Google Calendar sync error:", gErr.message);
        }
      }
    }

    res.json({ success: true, event: { ...data, google_event_id: googleEventId } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Errore creazione evento" });
  }
}

async function deleteEvent(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "id obbligatorio" });

    // Recupera google_event_id prima di eliminare
    let googleEventId = null;
    const { data: existing } = await supabase
      .from("calendar_events")
      .select("google_event_id")
      .eq("id", id)
      .maybeSingle();
    googleEventId = existing?.google_event_id || null;

    let q = supabase.from("calendar_events").delete().eq("id", id);
    q = withTenantFilter(q, req);
    const { error } = await q;

    if (error) {
      if (error.code === "42P01") {
        return res.status(503).json({ error: "Tabella calendar_events non esistente." });
      }
      throw error;
    }

    // Elimina anche da Google Calendar se collegato
    if (googleEventId && googleCal.isConfigured()) {
      const autoscuolaId = getAutoscuolaId(req);
      if (autoscuolaId) {
        try {
          await googleCal.deleteEvent(autoscuolaId, googleEventId);
        } catch (gErr) {
          console.warn("[calendarController] Google Calendar delete error:", gErr.message);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Errore eliminazione evento" });
  }
}

// =============================================================================
// Google Calendar OAuth
// =============================================================================

async function googleStatus(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    if (!autoscuolaId) return res.status(400).json({ error: "autoscuola_id mancante" });

    const configured = googleCal.isConfigured();
    if (!configured) {
      return res.json({ configured: false, connected: false });
    }

    const { connected, updatedAt } = await googleCal.getConnectionStatus(autoscuolaId);
    res.json({ configured: true, connected, updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function googleAuthUrl(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    if (!autoscuolaId) return res.status(400).json({ error: "autoscuola_id mancante" });
    if (!googleCal.isConfigured()) {
      return res.status(503).json({ error: "Google Calendar non configurato (manca GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET)" });
    }
    const url = googleCal.getAuthUrl(autoscuolaId);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function googleCallback(req, res) {
  try {
    const { code, state: autoscuolaId, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3001"}/calendar?google_error=${encodeURIComponent(oauthError)}`);
    }
    if (!code || !autoscuolaId) {
      return res.status(400).send("Parametri mancanti (code, state)");
    }

    await googleCal.handleCallback(code, autoscuolaId);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3001"}/calendar?google_connected=1`);
  } catch (e) {
    console.error("[calendarController] Google callback error:", e.message);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3001"}/calendar?google_error=${encodeURIComponent(e.message)}`);
  }
}

async function googleDisconnect(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    if (!autoscuolaId) return res.status(400).json({ error: "autoscuola_id mancante" });
    await googleCal.disconnect(autoscuolaId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// =============================================================================
// Google Calendar events
// =============================================================================

async function googleEvents(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    if (!autoscuolaId) return res.status(400).json({ error: "autoscuola_id mancante" });

    const start = req.query?.start;
    const end = req.query?.end;
    if (!start || !end) return res.status(400).json({ error: "start e end obbligatori" });

    const { events, connected } = await googleCal.listEvents(autoscuolaId, start, end);
    res.json({ success: true, events, connected });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

async function googleCreateEvent(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    if (!autoscuolaId) return res.status(400).json({ error: "autoscuola_id mancante" });
    const body = req.body || {};
    const event = await googleCal.createEvent(autoscuolaId, body);
    res.json({ success: true, event });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

async function googleDeleteEvent(req, res) {
  try {
    const autoscuolaId = getAutoscuolaId(req);
    if (!autoscuolaId) return res.status(400).json({ error: "autoscuola_id mancante" });
    const { googleEventId } = req.params;
    await googleCal.deleteEvent(autoscuolaId, googleEventId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = {
  getEvents,
  createEvent,
  deleteEvent,
  googleStatus,
  googleAuthUrl,
  googleCallback,
  googleDisconnect,
  googleEvents,
  googleCreateEvent,
  googleDeleteEvent,
};
