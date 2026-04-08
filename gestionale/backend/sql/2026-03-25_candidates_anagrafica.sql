-- ============================================================
-- Aggiunge colonne anagrafica mancanti a candidates
-- Applicata il: 2026-03-25
-- ============================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS ppg_data_scadenza       date,
  ADD COLUMN IF NOT EXISTS scade_il_documento      date,
  ADD COLUMN IF NOT EXISTS scade_il_patente        date,
  ADD COLUMN IF NOT EXISTS telefono_1              text,
  ADD COLUMN IF NOT EXISTS email_contatto          text,
  ADD COLUMN IF NOT EXISTS sesso                   text CHECK (sesso IN ('M','F',NULL)),
  ADD COLUMN IF NOT EXISTS data_iscrizione         date,
  ADD COLUMN IF NOT EXISTS marca_operativa         text,
  ADD COLUMN IF NOT EXISTS codice_statino          text,
  ADD COLUMN IF NOT EXISTS note                    text,
  ADD COLUMN IF NOT EXISTS codice_candidato        text,
  ADD COLUMN IF NOT EXISTS turno_prefer            text,
  ADD COLUMN IF NOT EXISTS lingua                  text,
  ADD COLUMN IF NOT EXISTS supporto_audio          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_documento          text,
  ADD COLUMN IF NOT EXISTS numero_documento        text,
  ADD COLUMN IF NOT EXISTS luogo_rilascio_doc      text,
  ADD COLUMN IF NOT EXISTS data_rilascio_doc       date,
  ADD COLUMN IF NOT EXISTS codice_autoscuola       text,
  ADD COLUMN IF NOT EXISTS updated_at              timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_candidates_ppg_scadenza   ON candidates(ppg_data_scadenza)   WHERE ppg_data_scadenza IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_scade_doc      ON candidates(scade_il_documento)  WHERE scade_il_documento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_scade_patente  ON candidates(scade_il_patente)    WHERE scade_il_patente IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_codice_cand    ON candidates(codice_candidato)    WHERE codice_candidato IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_codice_aut     ON candidates(codice_autoscuola)   WHERE codice_autoscuola IS NOT NULL;
