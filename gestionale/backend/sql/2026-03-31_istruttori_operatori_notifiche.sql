-- ============================================================
-- Tabelle: istruttori, operatori, notifiche_candidati, esercitazioni_guida
-- Applicata il: 2026-03-31
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ISTRUTTORI — Gestione istruttori (Punto 20)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.istruttori (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,

  cognome             text NOT NULL,
  nome                text NOT NULL,
  codice_fiscale      text,
  data_nascita        date,

  email               text,
  telefono            text,

  -- Qualifiche e abilitazioni
  qualifiche          jsonb DEFAULT '[]'::jsonb,  -- es. ["B", "C", "D", "CQC"]
  data_abilitazione   date,
  numero_patente      text,

  -- Disponibilità
  orari_disponibilita text,                       -- es. JSON con giorni/orari

  attivo              boolean DEFAULT true,

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_istruttori_autoscuola ON public.istruttori(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_istruttori_attivo    ON public.istruttori(attivo) WHERE attivo = true;
CREATE INDEX IF NOT EXISTS idx_istruttori_cognome   ON public.istruttori(autoscuola_id, cognome);


-- ============================================================
-- 2. OPERATORI — Gestione operatori per sede con ruoli (Punto 24)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.operatori (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,

  email               text NOT NULL,
  password_hash       text NOT NULL,

  nome                text,
  cognome             text,
  telefono            text,

  -- Ruolo e associazioni
  ruolo               text DEFAULT 'operatore'
    CHECK (ruolo IN ('admin','operatore','segreteria','istruttore')),
  istruttore_id       uuid REFERENCES public.istruttori(id) ON DELETE SET NULL,

  attivo              boolean DEFAULT true,

  -- Audit
  ultimo_accesso      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_operatori_email_autoscuola
  ON public.operatori(autoscuola_id, email);
CREATE INDEX IF NOT EXISTS idx_operatori_autoscuola ON public.operatori(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_operatori_ruolo      ON public.operatori(ruolo);


-- ============================================================
-- 3. NOTIFICHE_CANDIDATI — Storico notifiche (Punto 21)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifiche_candidati (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  candidato_id        uuid REFERENCES public.candidates(id) ON DELETE CASCADE,

  email_destinatario  text NOT NULL,
  tipo                text DEFAULT 'email'
    CHECK (tipo IN ('email','sms','whatsapp','push','portale')),

  template_key        text,                       -- es. 'esame_prenotato'
  subject             text,
  corpo               text,

  esito               text DEFAULT 'inviato'
    CHECK (esito IN ('inviato','bounced','failed','rejected')),

  provider            text,                       -- brevo, sendgrid, mailgun, sms, whatsapp
  provider_id         text,                       -- ID esterno dalla piattaforma

  variables           jsonb DEFAULT '{}'::jsonb,  -- variabili template utilizzate
  note                text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifiche_autoscuola  ON public.notifiche_candidati(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_notifiche_candidato   ON public.notifiche_candidati(candidato_id);
CREATE INDEX IF NOT EXISTS idx_notifiche_data        ON public.notifiche_candidati(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifiche_esito       ON public.notifiche_candidati(esito) WHERE esito IN ('failed','bounced');


-- ============================================================
-- 4. ESERCITAZIONI_GUIDA — Esercitazioni guida autonoma (dal portale)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.esercitazioni_guida (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  candidate_id        uuid REFERENCES public.candidates(id) ON DELETE CASCADE,

  pratica_id          uuid REFERENCES public.pratiche_patente(id) ON DELETE SET NULL,

  data_esercitazione  date NOT NULL,
  ora_inizio          time,
  durata_minuti       integer,

  tipo_guida          text DEFAULT 'A',           -- es. A, B, C, etc.
  targa_veicolo       text,
  istruttore_nome     text,
  istruttore_cognome  text,

  n_iscrizione        text,                       -- numero iscrizione candidato
  note                text,

  trasmessa_portale   boolean DEFAULT false,      -- è stata sincronizzata al portale?

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esercitazioni_candidate    ON public.esercitazioni_guida(candidate_id);
CREATE INDEX IF NOT EXISTS idx_esercitazioni_autoscuola   ON public.esercitazioni_guida(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_esercitazioni_data         ON public.esercitazioni_guida(data_esercitazione DESC);
CREATE INDEX IF NOT EXISTS idx_esercitazioni_trasmessa    ON public.esercitazioni_guida(trasmessa_portale)
  WHERE trasmessa_portale = false;


-- ============================================================
-- Aggiunte colonne guide_sessions per guida accompagnata (Punto 23)
-- ============================================================
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS istruttore_id uuid REFERENCES public.istruttori(id) ON DELETE SET NULL;
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS accompagnatore_cognome text;
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS accompagnatore_nome text;
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS accompagnatore_data_nascita date;
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS accompagnatore_patente_n text;
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS accompagnatore_patente_data date;
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS foglio_rosa_numero text;

CREATE INDEX IF NOT EXISTS idx_guide_sessions_istruttore_id ON public.guide_sessions(istruttore_id);


-- ============================================================
-- Trigger updated_at per nuove tabelle
-- ============================================================
DO $$ BEGIN
  -- istruttori
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_istruttori_updated') THEN
    CREATE TRIGGER trg_istruttori_updated BEFORE UPDATE ON public.istruttori
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- operatori
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_operatori_updated') THEN
    CREATE TRIGGER trg_operatori_updated BEFORE UPDATE ON public.operatori
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- esercitazioni_guida
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_esercitazioni_updated') THEN
    CREATE TRIGGER trg_esercitazioni_updated BEFORE UPDATE ON public.esercitazioni_guida
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMIT;
