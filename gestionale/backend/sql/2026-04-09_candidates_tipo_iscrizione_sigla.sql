-- =============================================================================
-- MIGRAZIONE: Candidates — sigla tipo iscrizione + stato iscrizione
-- Data: 2026-04-09
-- Descr: Aggiunge colonne necessarie al flusso candidato-centric di trasmissione
--        pratiche al Portale Automobilista (replica GeCA Trasmiss.cs).
--
--        La sigla tipo_iscrizione (IN, PR, RE, CM, CV, PC, CC, GA, D|, Y|, L|,
--        S|, R|, M|, E|, ecc.) determina quale handler di trasmissione invocare.
--
--        Vedi: trasmissController.js → SIGLA_TO_OPERAZIONE
--        Vedi: ModalOmonimi.js → SIGLA_LABELS
--        Vedi: frontend/app/trasmissione-portale/page.js
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sigla tipo iscrizione (22 sigle GeCA)
-- -----------------------------------------------------------------------------
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS tipo_iscrizione_sigla text,
  ADD COLUMN IF NOT EXISTS tipo_iscrizione       text,
  ADD COLUMN IF NOT EXISTS tipo_iscrizione_label text;

-- Index per filtri per sigla (es. /api/trasmiss/candidati-pronti?sigla=IN)
CREATE INDEX IF NOT EXISTS idx_candidates_tipo_iscrizione_sigla
  ON public.candidates(tipo_iscrizione_sigla)
  WHERE tipo_iscrizione_sigla IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Stato iscrizione (ATTIVA, SOSPESA, ARCHIVIATA, ...)
-- -----------------------------------------------------------------------------
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS stato_iscrizione text DEFAULT 'ATTIVA';

CREATE INDEX IF NOT EXISTS idx_candidates_stato_iscrizione
  ON public.candidates(stato_iscrizione)
  WHERE stato_iscrizione IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Backfill della sigla dai raw_portale (per i candidati già esistenti)
-- -----------------------------------------------------------------------------
UPDATE public.candidates
SET tipo_iscrizione_sigla = raw_portale->>'tipo_iscrizione_sigla'
WHERE tipo_iscrizione_sigla IS NULL
  AND raw_portale IS NOT NULL
  AND raw_portale ? 'tipo_iscrizione_sigla';

UPDATE public.candidates
SET tipo_iscrizione_sigla = raw_portale->>'sigla'
WHERE tipo_iscrizione_sigla IS NULL
  AND raw_portale IS NOT NULL
  AND raw_portale ? 'sigla';

-- Backfill stato_iscrizione per i candidati esistenti
UPDATE public.candidates
SET stato_iscrizione = 'ATTIVA'
WHERE stato_iscrizione IS NULL
  AND (storico IS NULL OR storico = false);

UPDATE public.candidates
SET stato_iscrizione = 'ARCHIVIATA'
WHERE stato_iscrizione IS NULL
  AND storico = true;

-- -----------------------------------------------------------------------------
-- 4. Reload PostgREST schema (Supabase)
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- FINE MIGRAZIONE
-- =============================================================================
