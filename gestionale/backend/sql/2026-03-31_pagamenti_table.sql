-- ============================================================
-- Tabella: pagamenti (Punto 18, 22 — gestione cassa)
-- Applicata il: 2026-03-31
-- ============================================================

BEGIN;

-- ============================================================
-- PAGAMENTI — Registrazione pagamenti candidati
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pagamenti (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  candidato_id        uuid REFERENCES public.candidates(id) ON DELETE CASCADE,

  -- Importo e tipo
  importo             numeric(10,2) NOT NULL,
  tipo                text DEFAULT 'corso'
    CHECK (tipo IN ('corso','pratica','guida','esame','visita_medica','altro')),
  causale             text,                       -- descrizione servizio
  note                text,

  -- Metodo di pagamento
  metodo              text DEFAULT 'contante'
    CHECK (metodo IN ('contante','assegno','bonifico','pagoPA','satispay','carta','altro')),

  -- Stato e tracciamento
  esito               text DEFAULT 'completato'
    CHECK (esito IN ('completato','sospeso','rifiutato','rimborso')),

  -- Integrazione piattaforme esterne
  provider            text,                       -- pagoPA, satispay, etc.
  provider_id         text,                       -- ID transazione presso provider
  url_pagamento       text,                       -- URL per pagoPA/Satispay

  -- Rate (se rateizzato)
  numero_rata         integer,
  numero_rate_totali  integer,

  -- Audit
  operatore_id        uuid REFERENCES public.operatori(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagamenti_autoscuola   ON public.pagamenti(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_pagamenti_candidato    ON public.pagamenti(candidato_id);
CREATE INDEX IF NOT EXISTS idx_pagamenti_data         ON public.pagamenti(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pagamenti_metodo       ON public.pagamenti(metodo);
CREATE INDEX IF NOT EXISTS idx_pagamenti_esito        ON public.pagamenti(esito);
CREATE INDEX IF NOT EXISTS idx_pagamenti_provider     ON public.pagamenti(provider_id) WHERE provider_id IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pagamenti_updated') THEN
    CREATE TRIGGER trg_pagamenti_updated BEFORE UPDATE ON public.pagamenti
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMIT;
