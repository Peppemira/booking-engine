-- ============================================================
-- Migration: Veicoli, Committenti, Listino Prezzi,
--            Impegni/Scadenze, Visite Mediche, Preventivi
-- Applicata il: 2026-03-26
-- Ispirata a: iPatenteCloud manuale utente (Cap 5, 6, 11, 14, 15)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. VEICOLI — Parco Veicoli (Cap 5 iPatenteCloud)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.veicoli (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,

  targa               text NOT NULL,
  marca               text,
  modello             text,
  colore              text DEFAULT '#3B82F6',  -- colore calendario (hex)
  anno                integer,
  tipo                text DEFAULT 'auto'      -- auto | moto | camion | furgone
    CHECK (tipo IN ('auto','moto','camion','furgone','altro')),
  categoria_patente   text,                    -- B, C, D, AM, A1, A2, A, BE, CQC

  km_acquisto         integer DEFAULT 0,
  km_attuali          integer DEFAULT 0,
  data_acquisto       date,
  data_immatricolazione date,
  scadenza_revisione  date,
  scadenza_assicurazione date,

  stato               text DEFAULT 'attivo'    -- attivo | manutenzione | dismesso
    CHECK (stato IN ('attivo','manutenzione','dismesso')),

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veicoli_autoscuola ON public.veicoli(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_veicoli_stato      ON public.veicoli(stato);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veicoli_targa_autoscuola ON public.veicoli(autoscuola_id, targa);

-- Aggiungi veicolo_id a guide_sessions (se esiste)
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS veicolo_id uuid REFERENCES public.veicoli(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_guide_sessions_veicolo ON public.guide_sessions(veicolo_id);


-- ============================================================
-- 2. COLLABORATORI — Gestione collaboratori (Cap 4 iPatenteCloud)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.collaboratori (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,

  nome                text NOT NULL,
  cognome             text NOT NULL,
  codice_fiscale      text,
  email               text,
  telefono            text,

  ruolo               text DEFAULT 'segretario'
    CHECK (ruolo IN ('amministratore','direttore_sede','segretario','insegnante','istruttore')),

  colore              text DEFAULT '#10B981',  -- colore calendario
  attivo              boolean DEFAULT true,
  pin_accesso         text,                    -- PIN per login rapido

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collaboratori_autoscuola ON public.collaboratori(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_collaboratori_ruolo      ON public.collaboratori(ruolo);

-- Aggiungi collaboratore_id a guide_sessions
ALTER TABLE public.guide_sessions ADD COLUMN IF NOT EXISTS collaboratore_id uuid REFERENCES public.collaboratori(id) ON DELETE SET NULL;


-- ============================================================
-- 3. COMMITTENTI — Terzi committenti (Cap 11 iPatenteCloud)
-- Privati, Aziende, Autoscuole che commissionano corsi
-- ============================================================
CREATE TABLE IF NOT EXISTS public.committenti (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,

  tipologia           text DEFAULT 'AZIENDA'
    CHECK (tipologia IN ('PRIVATO','AZIENDA','AUTOSCUOLA')),

  -- Dati anagrafici
  ragione_sociale     text NOT NULL,
  nome_referente      text,
  cognome_referente   text,
  codice_fiscale      text,
  partita_iva         text,

  -- Recapiti
  email               text,
  telefono            text,
  indirizzo           text,
  cap                 text,
  comune              text,
  provincia           text,

  -- Fatturazione
  codice_destinatario text,  -- SDI per fatturazione elettronica
  pec                 text,

  note                text,
  attivo              boolean DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_committenti_autoscuola ON public.committenti(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_committenti_piva       ON public.committenti(partita_iva) WHERE partita_iva IS NOT NULL;

-- Aggiungi committente_id alle pratiche (un servizio può essere per conto terzi)
ALTER TABLE public.pratiche_patente ADD COLUMN IF NOT EXISTS committente_id uuid REFERENCES public.committenti(id) ON DELETE SET NULL;


-- ============================================================
-- 4. LISTINO_PREZZI — Listino prezzi servizi (Cap 6 iPatenteCloud)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.listino_prezzi (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,

  categoria           text NOT NULL,           -- es. "Patente B", "CQC", "Patente A2"
  codice              text,                    -- codice interno
  descrizione         text NOT NULL,           -- nome del servizio
  descrizione_estesa  text,
  tipo_servizio       text DEFAULT 'corso'     -- corso | pratica | guida | esame | altro
    CHECK (tipo_servizio IN ('corso','pratica','guida','esame','visita_medica','altro')),

  prezzo_base         numeric(10,2) NOT NULL DEFAULT 0,
  iva_pct             numeric(5,2) DEFAULT 22.00,
  prezzo_iva_inclusa  boolean DEFAULT false,

  -- Rate / rateizzazione (Cap 10 iPatenteCloud)
  rateizzabile        boolean DEFAULT false,
  num_rate_default    integer DEFAULT 1,
  blocco_morosi       boolean DEFAULT false,   -- blocca app quiz se non paga

  attivo              boolean DEFAULT true,
  ordine              integer DEFAULT 0,

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listino_autoscuola  ON public.listino_prezzi(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_listino_categoria   ON public.listino_prezzi(autoscuola_id, categoria);
CREATE INDEX IF NOT EXISTS idx_listino_attivo      ON public.listino_prezzi(attivo) WHERE attivo = true;


-- ============================================================
-- 5. PREVENTIVI — Preventivi / offerte (Cap 6/9 iPatenteCloud)
-- Workflow: preventivo → accettato → pratica
-- ============================================================
CREATE TABLE IF NOT EXISTS public.preventivi (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  candidato_id        uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  committente_id      uuid REFERENCES public.committenti(id) ON DELETE SET NULL,

  numero_preventivo   text,                    -- numero progressivo es. "PRV-2026-001"
  data_preventivo     date DEFAULT CURRENT_DATE,
  data_scadenza       date,                    -- data di validità offerta

  stato               text DEFAULT 'bozza'
    CHECK (stato IN ('bozza','inviato','accettato','rifiutato','scaduto')),

  totale_imponibile   numeric(10,2) DEFAULT 0,
  totale_iva          numeric(10,2) DEFAULT 0,
  totale_finale       numeric(10,2) DEFAULT 0,

  note_interne        text,
  note_cliente        text,

  -- Voci del preventivo (JSON array: [{listino_id, qty, prezzo_unitario, descrizione}])
  voci                jsonb DEFAULT '[]'::jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preventivi_autoscuola ON public.preventivi(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_preventivi_candidato  ON public.preventivi(candidato_id);
CREATE INDEX IF NOT EXISTS idx_preventivi_stato      ON public.preventivi(stato);
CREATE INDEX IF NOT EXISTS idx_preventivi_data       ON public.preventivi(data_preventivo DESC);

-- Sequenza per numero progressivo preventivi
CREATE SEQUENCE IF NOT EXISTS seq_preventivi_autoscuola START 1;


-- ============================================================
-- 6. IMPEGNI_SCADENZE — Impegni e scadenze (Cap 15 iPatenteCloud)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.impegni_scadenze (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  candidato_id        uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  collaboratore_id    uuid REFERENCES public.collaboratori(id) ON DELETE SET NULL,

  titolo              text NOT NULL,
  descrizione         text,
  tipo                text DEFAULT 'promemoria'
    CHECK (tipo IN ('scadenza','appuntamento','promemoria','task','visita_medica','esame','corso')),

  data_inizio         timestamptz,
  data_fine           timestamptz,
  data_scadenza       date,

  priorita            text DEFAULT 'normale'
    CHECK (priorita IN ('bassa','normale','alta','urgente')),

  stato               text DEFAULT 'aperto'
    CHECK (stato IN ('aperto','in_corso','completato','annullato','scaduto')),

  -- Notifica WhatsApp/email
  notifica_abilitata  boolean DEFAULT false,
  notifica_minuti     integer DEFAULT 60,      -- quanti minuti prima
  notifica_inviata    boolean DEFAULT false,

  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impegni_autoscuola   ON public.impegni_scadenze(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_impegni_candidato    ON public.impegni_scadenze(candidato_id);
CREATE INDEX IF NOT EXISTS idx_impegni_stato        ON public.impegni_scadenze(stato) WHERE stato IN ('aperto','in_corso');
CREATE INDEX IF NOT EXISTS idx_impegni_scadenza     ON public.impegni_scadenze(data_scadenza) WHERE data_scadenza IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_impegni_tipo         ON public.impegni_scadenze(tipo);


-- ============================================================
-- 7. VISITE_MEDICHE — Calendario visite mediche (Cap 14 iPatenteCloud)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.visite_mediche (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autoscuola_id       uuid REFERENCES public.autoscuole(id) ON DELETE CASCADE,
  candidato_id        uuid REFERENCES public.candidates(id) ON DELETE SET NULL,

  data_visita         date NOT NULL,
  ora_inizio          time,
  ora_fine            time,

  medico              text,                    -- nome medico/struttura
  luogo               text,                    -- luogo/studio medico
  tipo_visita         text DEFAULT 'prima_visita'
    CHECK (tipo_visita IN ('prima_visita','rinnovo','cml','cqc','altro')),

  stato               text DEFAULT 'prenotata'
    CHECK (stato IN ('prenotata','confermata','completata','annullata','no_show')),

  esito               text,                    -- IDONEO | NON_IDONEO | SOSPESO | DA_RIVEDERE
  note                text,

  -- Remainder WhatsApp (Cap 14: "inviare un remainder tramite whatsapp")
  reminder_inviato    boolean DEFAULT false,
  reminder_inviato_il timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visite_mediche_autoscuola ON public.visite_mediche(autoscuola_id);
CREATE INDEX IF NOT EXISTS idx_visite_mediche_candidato  ON public.visite_mediche(candidato_id);
CREATE INDEX IF NOT EXISTS idx_visite_mediche_data       ON public.visite_mediche(data_visita DESC);
CREATE INDEX IF NOT EXISTS idx_visite_mediche_stato      ON public.visite_mediche(stato);


-- ============================================================
-- 8. Trigger updated_at per tutte le nuove tabelle
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  -- veicoli
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_veicoli_updated') THEN
    CREATE TRIGGER trg_veicoli_updated BEFORE UPDATE ON public.veicoli
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- collaboratori
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_collaboratori_updated') THEN
    CREATE TRIGGER trg_collaboratori_updated BEFORE UPDATE ON public.collaboratori
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- committenti
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_committenti_updated') THEN
    CREATE TRIGGER trg_committenti_updated BEFORE UPDATE ON public.committenti
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- listino_prezzi
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_listino_updated') THEN
    CREATE TRIGGER trg_listino_updated BEFORE UPDATE ON public.listino_prezzi
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- preventivi
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_preventivi_updated') THEN
    CREATE TRIGGER trg_preventivi_updated BEFORE UPDATE ON public.preventivi
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- impegni_scadenze
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_impegni_updated') THEN
    CREATE TRIGGER trg_impegni_updated BEFORE UPDATE ON public.impegni_scadenze
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  -- visite_mediche
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_visite_updated') THEN
    CREATE TRIGGER trg_visite_updated BEFORE UPDATE ON public.visite_mediche
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMIT;
