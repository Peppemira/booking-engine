-- =============================================================================
-- MIGRAZIONE: trasmissione pratiche sul Portale dell'Automobilista
-- Data: 2026-03-27
-- Descr: Aggiunge colonne a pratiche_patente per tracciare la trasmissione
--        via form sul Portale Automobilista (Puppeteer/automazione).
--        Aggiunge anche tabella esercitazioni_guida per le ore di guida.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PRATICHE_PATENTE — nuove colonne trasmissione portale
-- -----------------------------------------------------------------------------

-- Stato pratica (rinomina semantica: 'stato' → 'stato_pratica')
-- La colonna 'stato' esiste già; aggiungiamo 'stato_pratica' come alias live
-- tramite colonna generata OR come colonna indipendente con default.
-- Scelta: colonna indipendente (compatibile con codice esistente).
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS stato_pratica text
  CHECK (stato_pratica IS NULL OR stato_pratica IN (
    'bozza', 'da_trasmettere', 'pronto', 'pronto_trasmissione',
    'in_trasmissione', 'trasmesso_portale', 'trasmesso',
    'approvato', 'respinto', 'sospeso', 'annullato'
  ));

-- Tipo di trasmissione portale
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS tipo_trasmissione text
  CHECK (tipo_trasmissione IS NULL OR tipo_trasmissione IN (
    'conseguimento', 'cqc', 'prima_fase', 'rinnovo',
    'rinnovo_medico', 'altro'
  ));

-- Categoria patente (es. B, A, C, D, AM, CQC)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS categoria_patente text;

-- Codice autoscuola (es. '0674')
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS codice_autoscuola text;

-- Codice statino (identificativo pratica interno Motorizzazione)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS codice_statino text;

-- Data iscrizione candidato al corso
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS data_iscrizione date;

-- Progressivo portale (numero progressivo assegnato dal portale)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS progressivo_portale text;

-- Codice estremi pagamento (codice bollettino / pagoPA restituito dal portale)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS codice_estremi_pagamento text;

-- Data/ora trasmissione effettiva al portale
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS data_trasmissione_portale timestamptz;

-- Ultimo errore portale (stringa errore dell'ultimo tentativo fallito)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS ultimo_errore_portale text;

-- Data/ora dell'ultimo errore portale
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS data_ultimo_errore_portale timestamptz;

-- Bollettini postali in formato JSON (array di { tipo, importo, codice })
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS bollettini jsonb;

-- Foto candidato (base64 o storage path)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS foto_path text;

-- Firma candidato (base64 o storage path)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS firma_path text;

-- Messaggio di risposta del portale all'ultima trasmissione
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS messaggio_portale text;

-- Log di debug dell'ultima trasmissione (array di step)
ALTER TABLE public.pratiche_patente
  ADD COLUMN IF NOT EXISTS log_trasmissione jsonb;

-- -----------------------------------------------------------------------------
-- 2. INDICI pratiche_patente
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pratiche_stato_pratica
  ON public.pratiche_patente (stato_pratica);

CREATE INDEX IF NOT EXISTS idx_pratiche_tipo_trasmissione
  ON public.pratiche_patente (tipo_trasmissione);

CREATE INDEX IF NOT EXISTS idx_pratiche_codice_autoscuola
  ON public.pratiche_patente (codice_autoscuola);

-- -----------------------------------------------------------------------------
-- 3. ESERCITAZIONI_GUIDA — ore di guida per candidato
-- (Punto 6 del gap analysis: registrazione esercitazioni guida)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.esercitazioni_guida (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id   uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id    uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  pratica_id      uuid REFERENCES public.pratiche_patente(id) ON DELETE SET NULL,

  -- Dati esercitazione
  data_esercitazione date NOT NULL,
  ora_inizio         time,
  ora_fine           time,
  durata_minuti      integer,
  tipo_guida         text CHECK (tipo_guida IN ('normale', 'extraurbana', 'notturna', 'autostrada', 'condizioni_avverse')),

  -- Veicolo utilizzato
  targa_veicolo      text,
  tipo_veicolo       text,

  -- Istruttore
  istruttore_nome    text,
  istruttore_id      uuid,

  -- Stato trasmissione portale
  trasmessa_portale  boolean NOT NULL DEFAULT false,
  data_trasmissione  timestamptz,
  id_trasmissione    text,

  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esercitazioni_candidato
  ON public.esercitazioni_guida (candidato_id);

CREATE INDEX IF NOT EXISTS idx_esercitazioni_autoscuola
  ON public.esercitazioni_guida (autoscuola_id);

CREATE INDEX IF NOT EXISTS idx_esercitazioni_data
  ON public.esercitazioni_guida (data_esercitazione);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER set_esercitazioni_guida_updated_at
  BEFORE UPDATE ON public.esercitazioni_guida
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 4. ESITI_ESAMI — pass/fail per sessione (Punto 10 gap analysis)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.esiti_esami (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id   uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id    uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  pratica_id      uuid REFERENCES public.pratiche_patente(id) ON DELETE SET NULL,

  -- Dati sessione esame
  data_esame          date NOT NULL,
  tipo_esame          text CHECK (tipo_esame IN ('teoria', 'guida', 'cqc_teoria', 'cqc_guida')),
  codice_sessione     text,
  sede_esame          text,
  commissione         text,

  -- Esito
  esito               text CHECK (esito IN ('idoneo', 'non_idoneo', 'assente', 'ritirato', 'sospeso')),
  punteggio           integer,
  errori              integer,

  -- Dati portale
  id_verbale_portale  text,
  data_sync_portale   timestamptz,

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esiti_candidato  ON public.esiti_esami (candidato_id);
CREATE INDEX IF NOT EXISTS idx_esiti_autoscuola ON public.esiti_esami (autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_esiti_data       ON public.esiti_esami (data_esame);

CREATE OR REPLACE TRIGGER set_esiti_esami_updated_at
  BEFORE UPDATE ON public.esiti_esami
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 5. RICEVUTE_SOSTITUTIVE — tracciamento ricevute sostitutive (Punto 7)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ricevute_sostitutive (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id   uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id    uuid REFERENCES public.candidates(id) ON DELETE CASCADE,

  -- Dati ricevuta dal portale
  numero_ricevuta     text,
  data_rilascio       date,
  data_scadenza       date,
  tipo_documento      text,  -- es. 'FOGLIO_ROSA', 'PATENTE_PROVVISORIA'

  -- Dati portale
  id_richiesta_portale text,
  data_sync_portale    timestamptz,
  raw_portale          jsonb,  -- risposta grezza dal portale

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ricevute_candidato  ON public.ricevute_sostitutive (candidato_id);
CREATE INDEX IF NOT EXISTS idx_ricevute_autoscuola ON public.ricevute_sostitutive (autoscuola_id);

CREATE OR REPLACE TRIGGER set_ricevute_sostitutive_updated_at
  BEFORE UPDATE ON public.ricevute_sostitutive
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 6. CERTIFICATI_MEDICI — TT2112 (Punto 8 gap analysis)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificati_medici (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id   uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id    uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  pratica_id      uuid REFERENCES public.pratiche_patente(id) ON DELETE SET NULL,

  -- Dati certificato
  tipo_certificato    text DEFAULT 'TT2112',
  numero_certificato  text,
  data_rilascio       date,
  data_scadenza       date,
  medico_nome         text,
  medico_codice       text,
  commissione_medica  text,
  idoneità            text CHECK (idoneità IN ('idoneo', 'idoneo_con_prescrizioni', 'non_idoneo', 'sospeso')),
  prescrizioni        text,

  -- Dati portale
  id_protocollo_medico text,
  data_sync_portale    timestamptz,
  raw_portale          jsonb,

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificati_candidato  ON public.certificati_medici (candidato_id);
CREATE INDEX IF NOT EXISTS idx_certificati_autoscuola ON public.certificati_medici (autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_certificati_protocollo ON public.certificati_medici (id_protocollo_medico);

CREATE OR REPLACE TRIGGER set_certificati_medici_updated_at
  BEFORE UPDATE ON public.certificati_medici
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- FINE MIGRAZIONE
-- =============================================================================
