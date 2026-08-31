-- Migration: tabella tracking delivery per link acquisizione remota.
-- Data: 2026-04-17
-- Spec: docs/superpowers/specs/2026-04-17-p1-link-delivery-design.md
-- Idempotente (IF NOT EXISTS), safe re-run.

CREATE TABLE IF NOT EXISTS remote_capture_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text NOT NULL REFERENCES remote_capture_sessions(token) ON DELETE CASCADE,  -- text per matchare PK di remote_capture_sessions
  channel       text NOT NULL CHECK (channel IN ('email','whatsapp')),
  recipient     text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','failed','opened')),
  error_message text,
  user_id       uuid,
  autoscuola_id uuid NOT NULL REFERENCES autoscuole(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rcd_token       ON remote_capture_deliveries(token);
CREATE INDEX IF NOT EXISTS idx_rcd_autoscuola  ON remote_capture_deliveries(autoscuola_id, sent_at DESC);

ALTER TABLE remote_capture_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON remote_capture_deliveries;
CREATE POLICY tenant_isolation ON remote_capture_deliveries
  USING (autoscuola_id = current_setting('app.autoscuola_id', true)::uuid);
