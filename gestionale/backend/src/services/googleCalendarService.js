/**
 * GoogleCalendarService - OAuth2 + Google Calendar API per autoscuola.
 * Ogni autoscuola connette il proprio account Google; i token vengono
 * salvati in Supabase (tabella google_calendar_tokens).
 */

const { google } = require("googleapis");
const supabase = require("../database/supabase");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/calendar/google/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function createOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

/**
 * Genera URL per autorizzazione OAuth2 Google.
 * @param {string} autoscuolaId
 */
function getAuthUrl(autoscuolaId) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: autoscuolaId,
  });
}

/**
 * Scambia code → tokens e li salva in Supabase.
 * @param {string} code - authorization code da Google
 * @param {string} autoscuolaId
 */
async function handleCallback(code, autoscuolaId) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  await saveTokens(autoscuolaId, tokens);
  return tokens;
}

/**
 * Salva/aggiorna tokens in Supabase.
 */
async function saveTokens(autoscuolaId, tokens) {
  const row = {
    autoscuola_id: autoscuolaId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("google_calendar_tokens")
    .upsert([row], { onConflict: "autoscuola_id" });

  if (error) throw new Error(`Errore salvataggio token: ${error.message}`);
}

/**
 * Carica tokens da Supabase e restituisce un oauth2Client autenticato.
 * @param {string} autoscuolaId
 */
async function getAuthenticatedClient(autoscuolaId) {
  const { data, error } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("autoscuola_id", autoscuolaId)
    .maybeSingle();

  if (error) throw new Error(`Errore lettura token: ${error.message}`);
  if (!data) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date ? new Date(data.expiry_date).getTime() : undefined,
    token_type: data.token_type,
  });

  // Auto-refresh: aggiorna token se scaduto
  oauth2Client.on("tokens", async (tokens) => {
    const updated = {
      access_token: tokens.access_token || data.access_token,
      refresh_token: tokens.refresh_token || data.refresh_token,
      expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : data.expiry_date,
      token_type: tokens.token_type || data.token_type,
      scope: tokens.scope || data.scope,
      updated_at: new Date().toISOString(),
    };
    await supabase
      .from("google_calendar_tokens")
      .update(updated)
      .eq("autoscuola_id", autoscuolaId);
  });

  return oauth2Client;
}

/**
 * Controlla se l'autoscuola ha Google Calendar connesso.
 * @param {string} autoscuolaId
 */
async function getConnectionStatus(autoscuolaId) {
  const { data } = await supabase
    .from("google_calendar_tokens")
    .select("autoscuola_id, updated_at, scope")
    .eq("autoscuola_id", autoscuolaId)
    .maybeSingle();
  return { connected: Boolean(data), updatedAt: data?.updated_at || null };
}

/**
 * Disconnette Google Calendar (elimina tokens).
 * @param {string} autoscuolaId
 */
async function disconnect(autoscuolaId) {
  const { error } = await supabase
    .from("google_calendar_tokens")
    .delete()
    .eq("autoscuola_id", autoscuolaId);
  if (error) throw new Error(`Errore disconnessione: ${error.message}`);
}

/**
 * Legge eventi da Google Calendar in un intervallo date.
 * @param {string} autoscuolaId
 * @param {string} startIso
 * @param {string} endIso
 * @param {string} [calendarId="primary"]
 */
async function listEvents(autoscuolaId, startIso, endIso, calendarId = "primary") {
  const auth = await getAuthenticatedClient(autoscuolaId);
  if (!auth) return { events: [], connected: false };

  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId,
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  const items = (res.data.items || []).map((ev) => ({
    id: ev.id,
    title: ev.summary || "(senza titolo)",
    description: ev.description || "",
    start_at: ev.start?.dateTime || ev.start?.date,
    end_at: ev.end?.dateTime || ev.end?.date,
    all_day: Boolean(ev.start?.date && !ev.start?.dateTime),
    tipo: "google",
    source: "google",
    google_event_id: ev.id,
    color: ev.colorId || null,
    html_link: ev.htmlLink || null,
  }));

  return { events: items, connected: true };
}

/**
 * Crea evento in Google Calendar.
 * @param {string} autoscuolaId
 * @param {object} eventData - { title, description, start_at, end_at, all_day }
 * @param {string} [calendarId="primary"]
 */
async function createEvent(autoscuolaId, eventData, calendarId = "primary") {
  const auth = await getAuthenticatedClient(autoscuolaId);
  if (!auth) throw new Error("Google Calendar non connesso");

  const calendar = google.calendar({ version: "v3", auth });
  const isAllDay = Boolean(eventData.all_day);

  const resource = {
    summary: eventData.title,
    description: eventData.description || "",
    start: isAllDay
      ? { date: String(eventData.start_at).slice(0, 10) }
      : { dateTime: eventData.start_at, timeZone: "Europe/Rome" },
    end: isAllDay
      ? { date: String(eventData.end_at).slice(0, 10) }
      : { dateTime: eventData.end_at, timeZone: "Europe/Rome" },
  };

  const res = await calendar.events.insert({ calendarId, resource });
  return res.data;
}

/**
 * Elimina evento da Google Calendar.
 * @param {string} autoscuolaId
 * @param {string} googleEventId
 * @param {string} [calendarId="primary"]
 */
async function deleteEvent(autoscuolaId, googleEventId, calendarId = "primary") {
  const auth = await getAuthenticatedClient(autoscuolaId);
  if (!auth) throw new Error("Google Calendar non connesso");

  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId, eventId: googleEventId });
}

module.exports = {
  isConfigured,
  getAuthUrl,
  handleCallback,
  getConnectionStatus,
  disconnect,
  listEvents,
  createEvent,
  deleteEvent,
};
