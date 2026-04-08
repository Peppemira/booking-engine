-- Google Calendar tokens per autoscuola (OAuth2)
-- Eseguire in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id     uuid NOT NULL UNIQUE REFERENCES autoscuole(id) ON DELETE CASCADE,
  access_token      text NOT NULL,
  refresh_token     text,
  expiry_date       timestamptz,
  token_type        text DEFAULT 'Bearer',
  scope             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- RLS: solo il backend (service role) può leggere/scrivere
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Aggiunge colonna google_event_id a calendar_events se non esiste
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS google_event_id text;

CREATE INDEX IF NOT EXISTS idx_google_cal_tokens_autoscuola
  ON google_calendar_tokens(autoscuola_id);
