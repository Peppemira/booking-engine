-- ============================================================
-- Commissioni PagoPA della piattaforma (docs/commissioni-pagopa.md)
-- Additiva: nessuna colonna o tabella esistente viene modificata o rimossa.
-- Accesso solo dal backend (service role): RLS attiva senza policy,
-- come le altre tabelle del progetto.
-- ============================================================

BEGIN;

-- ---------- Autoscuole: dati fiscali e stato billing ----------
ALTER TABLE public.autoscuole
  ADD COLUMN IF NOT EXISTS ragione_sociale          text,
  ADD COLUMN IF NOT EXISTS codice_fiscale           text,
  ADD COLUMN IF NOT EXISTS codice_sdi               text,
  ADD COLUMN IF NOT EXISTS pec                      text,
  ADD COLUMN IF NOT EXISTS cap                      text,
  ADD COLUMN IF NOT EXISTS comune                   text,
  ADD COLUMN IF NOT EXISTS provincia                text,
  ADD COLUMN IF NOT EXISTS is_admin                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_esente           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_customer_id       text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   text,
  ADD COLUMN IF NOT EXISTS stato_billing            text NOT NULL DEFAULT 'non_attivo',
  ADD COLUMN IF NOT EXISTS billing_sospeso_dal      timestamptz,
  ADD COLUMN IF NOT EXISTS billing_aggiornato_il    timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autoscuole_stato_billing_chk') THEN
    ALTER TABLE public.autoscuole
      ADD CONSTRAINT autoscuole_stato_billing_chk
      CHECK (stato_billing IN ('non_attivo','attiva','in_sospeso','bloccata'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_autoscuole_stripe_customer
  ON public.autoscuole(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ---------- Eventi PagoPA contati per la commissione ----------
CREATE TABLE IF NOT EXISTS public.pagopa_eventi (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id         uuid NOT NULL REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  identificativo_pagopa text NOT NULL,          -- IUV / id pratica: chiave di idempotenza
  pratica_ref           text,                   -- prenotazione / pratica collegata
  quantita              integer NOT NULL DEFAULT 1,  -- -1 per storno
  stornato              boolean NOT NULL DEFAULT false,
  inviato_stripe        boolean NOT NULL DEFAULT false,
  tentativi_invio       integer NOT NULL DEFAULT 0,
  ultimo_errore         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  inviato_il            timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pagopa_eventi_idem
  ON public.pagopa_eventi(autoscuola_id, identificativo_pagopa, quantita);
CREATE INDEX IF NOT EXISTS idx_pagopa_eventi_autoscuola_data
  ON public.pagopa_eventi(autoscuola_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pagopa_eventi_da_inviare
  ON public.pagopa_eventi(created_at) WHERE inviato_stripe = false;

-- ---------- Fatture della piattaforma verso le autoscuole ----------
CREATE TABLE IF NOT EXISTS public.fatture_piattaforma (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id         uuid NOT NULL REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  stripe_invoice_id     text NOT NULL UNIQUE,
  periodo_inizio        timestamptz,
  periodo_fine          timestamptz,
  numero_pagopa         integer,
  imponibile            numeric(10,2),
  iva                   numeric(10,2),
  totale                numeric(10,2),
  stato_pagamento       text NOT NULL DEFAULT 'in_attesa'
    CHECK (stato_pagamento IN ('in_attesa','pagata','fallita','annullata')),
  tentativi_falliti     integer NOT NULL DEFAULT 0,
  link_pagamento        text,
  numero_sdi            text,
  stato_sdi             text NOT NULL DEFAULT 'da_emettere'
    CHECK (stato_sdi IN ('da_emettere','inviata','consegnata','scartata','errore')),
  provider_sdi_id       text,
  errore_sdi            text,
  pdf_url               text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fatture_piattaforma_autoscuola
  ON public.fatture_piattaforma(autoscuola_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fatture_piattaforma_updated') THEN
    CREATE TRIGGER trg_fatture_piattaforma_updated BEFORE UPDATE ON public.fatture_piattaforma
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ---------- Webhook Stripe già elaborati (idempotenza) ----------
CREATE TABLE IF NOT EXISTS public.stripe_webhook_eventi (
  id            text PRIMARY KEY,               -- evt_...
  tipo          text NOT NULL,
  ricevuto_il   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pagopa_eventi         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fatture_piattaforma   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_eventi ENABLE ROW LEVEL SECURITY;

COMMIT;
