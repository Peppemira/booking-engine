-- =============================================================================
-- MIGRAZIONE: Archivio storico rinnovi dal Portale Automobilista
-- Data: 2026-04-10
-- Descr: Tabella unica per archivio storico di TUTTI i rinnovi scaricati dal
--        Portale dell'Automobilista. Copre 3 categorie:
--          1. Rinnovi patente (ReadGestRinnAgenzia)
--          2. Rinnovi medici / TT2112 (ReadGestRinnMed)
--          3. Rinnovi CQC e conseguimento CQC (ReadRichPatCqc)
--
--        Usata dal flusso syncArchivioStoricoCompleto che scarica TUTTO lo
--        storico (tutti gli stati, tutti gli anni) dal portale e mantiene
--        l'archivio aggiornato in tempo reale via sync incrementale.
--
--        Relazioni:
--          - autoscuola_id  → autoscuole (tenant filter)
--          - candidato_id   → candidates (opzionale, match per CF/nome/cognome)
--          - marca_operativa è l'identificativo univoco portale
--
--        Vedi: connector/portalSync.js → leggiRinnoviStoriciPatente / Medici / Cqc
--        Vedi: connector/syncArchivioStorico.js → orchestratore
--        Vedi: frontend/app/archivio-portale/page.js → UI dashboard
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABELLA rinnovi_portale — archivio unico
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rinnovi_portale (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant + collegamento candidato
  autoscuola_id        uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id         uuid REFERENCES public.candidates(id) ON DELETE SET NULL,

  -- Identificativo portale
  marca_operativa      text NOT NULL,
  tipo_rinnovo         text NOT NULL CHECK (tipo_rinnovo IN (
    'patente',        -- Rinnovo/Conferma Validità (ReadGestRinnAgenzia)
    'medico',         -- Certificato medico TT2112  (ReadGestRinnMed)
    'cqc',            -- Richiesta/Rinnovo CQC      (ReadRichPatCqc)
    'duplicato',      -- Duplicato documento        (da estensioni)
    'altro'           -- Fallback
  )),

  -- Stato portale (A=Attivo, D=Disdetto, R=Rifiutato, S=Scaduto, C=Completato, ...)
  stato_portale        text,
  stato_descr          text,   -- descrizione leggibile

  -- Anagrafica candidato
  cognome              text,
  nome                 text,
  codice_fiscale       text,
  data_nascita         date,
  sesso                text,
  comune_nascita       text,
  provincia_nascita    text,

  -- Residenza
  indirizzo            text,
  cap                  text,
  comune_residenza     text,
  provincia_residenza  text,

  -- Documenti
  patente_posseduta    text,   -- patente in possesso al momento del rinnovo
  patente_emessa       text,   -- patente eventualmente emessa
  categoria_patente    text,
  cqc_categoria        text,   -- CQC merci/persone (solo tipo_rinnovo=cqc)

  -- Date
  data_inserimento     date,   -- data inserimento richiesta su portale
  data_rilascio        date,
  data_scadenza        date,
  data_rinnovo         date,

  -- Metadati / Raw
  dettaglio            jsonb,  -- dati dettaglio scaricati dalla scheda del rinnovo
  raw_portale          jsonb,  -- riga grezza tabella lista portale

  -- Sync tracking (per sync incrementale real-time)
  last_synced_at       timestamptz NOT NULL DEFAULT now(),
  sync_generation      bigint NOT NULL DEFAULT 1,  -- incrementato ad ogni modifica
  hash_contenuto       text,                       -- hash dei campi per change detection

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Unicità: stesso tenant + stesso rinnovo (marca_operativa) + stesso tipo
CREATE UNIQUE INDEX IF NOT EXISTS ux_rinnovi_portale_tenant_marca_tipo
  ON public.rinnovi_portale (autoscuola_id, marca_operativa, tipo_rinnovo)
  WHERE autoscuola_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rinnovi_portale_global_marca_tipo
  ON public.rinnovi_portale (marca_operativa, tipo_rinnovo)
  WHERE autoscuola_id IS NULL;

-- Indici di ricerca
CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_candidato
  ON public.rinnovi_portale (candidato_id);

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_autoscuola
  ON public.rinnovi_portale (autoscuola_id);

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_tipo
  ON public.rinnovi_portale (tipo_rinnovo);

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_stato
  ON public.rinnovi_portale (stato_portale)
  WHERE stato_portale IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_cf
  ON public.rinnovi_portale (codice_fiscale)
  WHERE codice_fiscale IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_data_inserimento
  ON public.rinnovi_portale (data_inserimento DESC);

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_last_synced
  ON public.rinnovi_portale (last_synced_at DESC);

-- -----------------------------------------------------------------------------
-- 2. TRIGGER updated_at (usa funzione handle_updated_at già presente nel DB)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_rinnovi_portale_updated_at ON public.rinnovi_portale;
CREATE TRIGGER set_rinnovi_portale_updated_at
  BEFORE UPDATE ON public.rinnovi_portale
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 3. TABELLA archivio_sync_log — tracciamento run di sincronizzazione
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.archivio_sync_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id        uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,

  tipo_sync            text NOT NULL CHECK (tipo_sync IN (
    'full',            -- sync storico completo (manuale)
    'incrementale',    -- sync periodico automatico
    'manuale'          -- sync parziale ad-hoc
  )),
  trigger_source       text,  -- 'manuale', 'cron', 'webhook', ...

  -- Parametri richiesta
  include_esami        boolean NOT NULL DEFAULT true,
  include_rinnovi_pat  boolean NOT NULL DEFAULT true,
  include_rinnovi_med  boolean NOT NULL DEFAULT true,
  include_rinnovi_cqc  boolean NOT NULL DEFAULT true,
  data_inizio          date,
  data_fine            date,

  -- Statistiche risultato
  candidati_trovati    integer NOT NULL DEFAULT 0,
  candidati_inseriti   integer NOT NULL DEFAULT 0,
  candidati_aggiornati integer NOT NULL DEFAULT 0,
  rinnovi_trovati      integer NOT NULL DEFAULT 0,
  rinnovi_inseriti     integer NOT NULL DEFAULT 0,
  rinnovi_aggiornati   integer NOT NULL DEFAULT 0,
  errori               integer NOT NULL DEFAULT 0,

  -- Timing
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  duration_ms          integer,

  -- Stato / errore
  stato                text NOT NULL DEFAULT 'running' CHECK (stato IN (
    'running', 'success', 'failed', 'cancelled'
  )),
  ultimo_errore        text,
  log_dettaglio        jsonb
);

CREATE INDEX IF NOT EXISTS idx_archivio_sync_log_autoscuola
  ON public.archivio_sync_log (autoscuola_id);

CREATE INDEX IF NOT EXISTS idx_archivio_sync_log_started_at
  ON public.archivio_sync_log (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_archivio_sync_log_tipo
  ON public.archivio_sync_log (tipo_sync, stato);

-- -----------------------------------------------------------------------------
-- 4. VISTA di riepilogo per dashboard archivio
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_archivio_portale_riepilogo AS
SELECT
  autoscuola_id,
  tipo_rinnovo,
  stato_portale,
  COUNT(*)                          AS totale,
  MIN(data_inserimento)             AS primo_inserimento,
  MAX(data_inserimento)             AS ultimo_inserimento,
  MAX(last_synced_at)               AS ultimo_sync
FROM public.rinnovi_portale
GROUP BY autoscuola_id, tipo_rinnovo, stato_portale;

-- -----------------------------------------------------------------------------
-- 5. Reload PostgREST schema (Supabase)
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- FINE MIGRAZIONE
-- =============================================================================
