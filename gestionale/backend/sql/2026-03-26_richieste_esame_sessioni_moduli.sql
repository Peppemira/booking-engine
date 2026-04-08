-- ============================================================
-- Migration: Tabelle richieste_esame, sessioni_portale, moduli_log
--            + campi XSD mancanti su candidates
-- Applicata il: 2026-03-26
-- Basata su: MIT-EP06 WS + GRPW Appendice XSD types
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CANDIDATI — campi aggiuntivi da XSD DatiRichiestaEsameType
-- ============================================================

-- Categoria patente richiesta / disponibile (da XSD: categoriaRichiesta, categoriaDisponibile)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS categoria_richiesta       text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS categoria_disponibile     text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS categoria_posseduta       text;

-- Cambio automatico (XSD: cambioAutomatico = S/N)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cambio_automatico         boolean DEFAULT false;

-- Validità patente richiesta (XSD: validitaPatenteRichiestaMM, validitaPatenteRichiestaAA)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS validita_patente_mm       integer;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS validita_patente_aa       integer;

-- Dati medici (XSD: DatiMediciType)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS data_visita_medica        date;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS codice_iscrizione_medico  text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS luogo_visita_medica       text;

-- CQC (XSD: cqcPosseduta, dataInizioCorsoCqc)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cqc_posseduta             text;
ALTER TABLE candidates ADD COLUMN IF not exists data_inizio_corso_cqc    date;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS numero_patente_cqc       text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS data_scadenza_cqc        date;

-- Patente estera (XSD: patenteEstera)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS patente_estera_nazione    text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS patente_estera_numero     text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS patente_estera_scadenza   date;

-- Pagamento preferito (XSD: tipologiaPagamento)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tipo_pagamento            text CHECK (
  tipo_pagamento IS NULL OR tipo_pagamento IN ('BOLLETTINO','DECURTAZIONE','PAGOPA')
);

-- CIA (scuola guida di appartenenza)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS provincia_cia             text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS codice_cia                text;

-- Prescrizioni tecniche (lista JSON)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS prescrizioni_tecniche     jsonb DEFAULT '[]'::jsonb;

-- Obblighi visita CML
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS obbligo_visita_cml       boolean DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS esente_visita_cml        boolean DEFAULT false;

-- Tempo esteso prova teoria (disabilità)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tempo_esteso_teoria       boolean DEFAULT false;

-- Lingua preferita per il quiz
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS codice_statino_portale   text;


-- ============================================================
-- 2. RICHIESTE_ESAME — richieste patente sul portale MIT
-- Corrisponde a XSD: DatiRichiestaEsameType / DatiRichiestaEsameInserimentoType
-- ============================================================

CREATE TABLE IF NOT EXISTS public.richieste_esame (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id           uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id            uuid REFERENCES public.candidates(id) ON DELETE SET NULL,

  -- Identificazione portale (XSD: IdentificativoRichiestaEsameType)
  marca_operativa         text,          -- es. "06740830ME"
  codice_operatore        text,          -- 4 cifre
  ufficio_operativo       text,          -- 2 lettere (ME)
  protocollo_richiesta    text,          -- numero protocollo MIT assegnato
  id_richiesta_portale    text,          -- ID univoco sul portale

  -- Stato (XSD: StatoPrenotazioneCQCType / stati richiesta)
  stato                   text DEFAULT 'bozza', -- bozza | inviata | acquisita | rifiutata | annullata
  data_richiesta          date,
  data_variazione_stato   timestamptz,

  -- Categoria (XSD: categoriaRichiesta, categoriaDisponibile)
  categoria_richiesta     text NOT NULL, -- B, C, D, CQC, ecc.
  categoria_disponibile   text,
  abilitazione_cat_a      text,          -- A1, A2, A
  cambio_automatico       boolean DEFAULT false,

  -- Validità patente (XSD: validitaPatenteRichiestaMM/AA)
  validita_mm             integer DEFAULT 0,
  validita_aa             integer DEFAULT 10,

  -- Pagamento (XSD: tipologiaPagamento)
  tipo_pagamento          text CHECK (tipo_pagamento IN ('BOLLETTINO','DECURTAZIONE','PAGOPA')),
  codice_pagamento        text,

  -- Dati medici (XSD: DatiMediciType)
  data_visita_medica      date,
  codice_medico           text,
  luogo_visita_medica     text,
  protocollo_cert_medico  text,

  -- CQC
  cqc_posseduta           text,
  data_inizio_corso_cqc   date,

  -- Foglio Rosa
  codice_foglio_rosa      text,
  data_foglio_rosa        date,
  data_scadenza_fr        date,

  -- Flags
  obbligo_visita_cml      boolean DEFAULT false,
  esente_visita_cml       boolean DEFAULT false,
  tempo_esteso_teoria     boolean DEFAULT false,

  -- JSON payload raw (per debug / riprocessamento)
  payload_portale         jsonb DEFAULT '{}'::jsonb,
  risposta_portale        jsonb DEFAULT '{}'::jsonb,

  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_richieste_esame_autoscuola ON public.richieste_esame(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_richieste_esame_candidato  ON public.richieste_esame(candidato_id);
CREATE INDEX IF NOT EXISTS idx_richieste_esame_stato      ON public.richieste_esame(stato);
CREATE INDEX IF NOT EXISTS idx_richieste_esame_data       ON public.richieste_esame(data_richiesta DESC);
CREATE INDEX IF NOT EXISTS idx_richieste_esame_protocollo ON public.richieste_esame(protocollo_richiesta)
  WHERE protocollo_richiesta IS NOT NULL;


-- ============================================================
-- 3. SESSIONI_PORTALE — sessioni esame scaricate dal portale
-- Corrisponde alle response di /prenotazione/sessioneEsameAbilitazioneEP/...
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sessioni_portale (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id         uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,

  -- Tipo sessione (indicatoreTipoSessione)
  tipo_sessione         text NOT NULL, -- SQI | SGOS | SCQCA | SCQC | SQA | VAC | VSC | VAQ | VSQ | VSR

  -- Dati sessione dal portale
  id_sessione_portale   text,          -- ID univoco sul portale
  data_sessione         date NOT NULL,
  ora_sessione          text,
  luogo_sessione        text,
  sede_esame            text,
  provincia_esame       text,
  posti_disponibili     integer,
  posti_totali          integer,
  stato_sessione        text,          -- APERTA | CHIUSA | ANNULLATA

  -- Info extra (presenti in alcune tipologie)
  codice_sessione       text,
  numero_verbale        text,
  tipo_esame            text,          -- TEORIA | GUIDA | ORALE

  -- JSON raw per tutti gli altri campi non mappati
  raw                   jsonb DEFAULT '{}'::jsonb,

  -- Quando è stata scaricata dal portale
  sincronizzata_il      timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessioni_portale_autoscuola ON public.sessioni_portale(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_sessioni_portale_tipo       ON public.sessioni_portale(tipo_sessione);
CREATE INDEX IF NOT EXISTS idx_sessioni_portale_data       ON public.sessioni_portale(data_sessione DESC);
CREATE INDEX IF NOT EXISTS idx_sessioni_portale_id_portale ON public.sessioni_portale(id_sessione_portale)
  WHERE id_sessione_portale IS NOT NULL;


-- ============================================================
-- 4. MODULI_LOG — log dei moduli PDF generati
-- ============================================================

CREATE TABLE IF NOT EXISTS public.moduli_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE SET NULL,
  candidato_id        uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  richiesta_esame_id  uuid REFERENCES public.richieste_esame(id) ON DELETE SET NULL,

  tipo_modulo         text NOT NULL, -- TT2112 | FOGLIO_ROSA | COMUNICAZIONE | RICEVUTA | VERBALE
  nome_file           text,
  dimensione_bytes    integer,
  generato_da         text,          -- utente o sistema
  note                text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moduli_log_autoscuola  ON public.moduli_log(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_moduli_log_candidato   ON public.moduli_log(candidato_id);
CREATE INDEX IF NOT EXISTS idx_moduli_log_tipo        ON public.moduli_log(tipo_modulo);
CREATE INDEX IF NOT EXISTS idx_moduli_log_data        ON public.moduli_log(created_at DESC);


-- ============================================================
-- 5. PRATICHE_PATENTE — aggiungi colonne mancanti
-- ============================================================

ALTER TABLE public.pratiche_patente ADD COLUMN IF NOT EXISTS richiesta_esame_id uuid
  REFERENCES public.richieste_esame(id) ON DELETE SET NULL;

ALTER TABLE public.pratiche_patente ADD COLUMN IF NOT EXISTS tipo_pagamento text
  CHECK (tipo_pagamento IS NULL OR tipo_pagamento IN ('BOLLETTINO','DECURTAZIONE','PAGOPA'));

ALTER TABLE public.pratiche_patente ADD COLUMN IF NOT EXISTS codice_pagamento text;

ALTER TABLE public.pratiche_patente ADD COLUMN IF NOT EXISTS marca_operativa text;


-- ============================================================
-- 6. Trigger updated_at per nuove tabelle
-- ============================================================

-- Funzione generica (crea solo se non esiste)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Trigger su richieste_esame
DROP TRIGGER IF EXISTS trg_richieste_esame_updated ON public.richieste_esame;
CREATE TRIGGER trg_richieste_esame_updated
  BEFORE UPDATE ON public.richieste_esame
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


COMMIT;
