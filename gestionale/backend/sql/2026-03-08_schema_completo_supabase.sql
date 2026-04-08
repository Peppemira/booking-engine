-- =============================================================================
-- Schema completo Supabase per il gestionale autoscuola
-- Esegui in Supabase: SQL Editor → incolla e Run
-- Crea tutte le tabelle necessarie (se non esistono) e aggiunge colonne mancanti.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Estensioni
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 2. autoscuole (login gestionale + credenziali portale)
-- -----------------------------------------------------------------------------
create table if not exists public.autoscuole (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null,
  password_hash text not null,
  portal_user text,
  portal_pass text,
  portal_pin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_autoscuole_email on public.autoscuole(lower(email));

-- -----------------------------------------------------------------------------
-- 3. candidates (anagrafica candidati)
-- -----------------------------------------------------------------------------
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  nome text,
  cognome text,
  codice_fiscale text,
  data_nascita date,
  comune_nascita text,
  provincia_nascita text,
  indirizzo text,
  cap text,
  telefono text,
  email text,
  categoria_patente text,
  patente_numero text,
  codice_foglio_rosa text,
  codice_autoscuola text,
  tentativi_quiz integer,
  stato text,
  raw_portale jsonb default '{}'::jsonb,
  autoscuola_id uuid references public.autoscuole(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_candidates_autoscuola_id on public.candidates(autoscuola_id);
create index if not exists idx_candidates_codice_fiscale on public.candidates(codice_fiscale);
create index if not exists idx_candidates_codice_autoscuola on public.candidates(codice_autoscuola);

-- Colonne aggiuntive se lo schema esisteva già senza
alter table public.candidates add column if not exists patente_numero text;
alter table public.candidates add column if not exists telefono text;
alter table public.candidates add column if not exists email text;
alter table public.candidates add column if not exists data_nascita date;
alter table public.candidates add column if not exists comune_nascita text;
alter table public.candidates add column if not exists provincia_nascita text;
alter table public.candidates add column if not exists codice_autoscuola text;
alter table public.candidates add column if not exists raw_portale jsonb default '{}'::jsonb;
alter table public.candidates add column if not exists autoscuola_id uuid references public.autoscuole(id) on delete set null;
alter table public.candidates add column if not exists codice_foglio_rosa text;
alter table public.candidates add column if not exists indirizzo text;
alter table public.candidates add column if not exists cap text;
alter table public.candidates add column if not exists tentativi_quiz integer;
alter table public.candidates add column if not exists stato text;
alter table public.candidates add column if not exists updated_at timestamptz default now();

-- -----------------------------------------------------------------------------
-- 4. waitlist (lista attesa esami / radar)
-- -----------------------------------------------------------------------------
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  status text not null default 'pending',
  priority integer not null default 100,
  last_error text,
  last_attempt_at timestamptz,
  autoscuola_id uuid references public.autoscuole(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_waitlist_autoscuola_id on public.waitlist(autoscuola_id);
create index if not exists idx_waitlist_candidate_id on public.waitlist(candidate_id);
create index if not exists idx_waitlist_status on public.waitlist(status);
create index if not exists idx_waitlist_priority on public.waitlist(priority);
create index if not exists idx_waitlist_updated_at on public.waitlist(updated_at desc);

alter table public.waitlist add column if not exists last_error text;
alter table public.waitlist add column if not exists last_attempt_at timestamptz;
alter table public.waitlist add column if not exists updated_at timestamptz default now();
alter table public.waitlist add column if not exists autoscuola_id uuid references public.autoscuole(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 5. prenotazioni (prenotazioni esame)
-- -----------------------------------------------------------------------------
create table if not exists public.prenotazioni (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  sessione_id text,
  data_prenotazione timestamptz,
  nome text,
  cognome text,
  data text,
  categoria text,
  ora text,
  luogo text,
  esito text default 'inviata',
  autoscuola_id uuid references public.autoscuole(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prenotazioni_autoscuola_id on public.prenotazioni(autoscuola_id);
create index if not exists idx_prenotazioni_candidate_id on public.prenotazioni(candidate_id);
create index if not exists idx_prenotazioni_created_at on public.prenotazioni(created_at desc);

alter table public.prenotazioni add column if not exists autoscuola_id uuid references public.autoscuole(id) on delete set null;
alter table public.prenotazioni add column if not exists created_at timestamptz default now();
alter table public.prenotazioni add column if not exists updated_at timestamptz default now();

-- -----------------------------------------------------------------------------
-- 6. pratiche_patente (sync portale / Richiesta Patenti)
-- -----------------------------------------------------------------------------
create table if not exists public.pratiche_patente (
  id uuid primary key default gen_random_uuid(),
  autoscuola_id uuid references public.autoscuole(id) on delete set null,
  candidato_id uuid references public.candidates(id) on delete set null,
  tipo_pratica text default 'richiesta_patente',
  categoria text,
  stato text,
  id_richiesta_portale text,
  data_richiesta date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pratiche_patente_autoscuola_id on public.pratiche_patente(autoscuola_id);
create index if not exists idx_pratiche_patente_candidato_id on public.pratiche_patente(candidato_id);
create index if not exists idx_pratiche_patente_id_richiesta on public.pratiche_patente(id_richiesta_portale);

-- -----------------------------------------------------------------------------
-- 7. pagamenti (cassa / pagoPA / satispay)
-- -----------------------------------------------------------------------------
create table if not exists public.pagamenti (
  id uuid primary key default gen_random_uuid(),
  autoscuola_id uuid references public.autoscuole(id) on delete set null,
  candidato_id uuid references public.candidates(id) on delete set null,
  tipo text,
  importo numeric(10,2),
  causale text,
  idtrx text,
  progressivo text,
  esito text,
  data_pagamento date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pagamenti_autoscuola_id on public.pagamenti(autoscuola_id);
create index if not exists idx_pagamenti_candidato_id on public.pagamenti(candidato_id);
create index if not exists idx_pagamenti_created_at on public.pagamenti(created_at desc);

-- -----------------------------------------------------------------------------
-- 8. remote_capture_sessions (acquisizione remota CIE)
-- -----------------------------------------------------------------------------
create table if not exists public.remote_capture_sessions (
  token text primary key,
  autoscuola_id uuid references public.autoscuole(id) on delete cascade,
  mode text not null default 'cie_mobile',
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_remote_capture_sessions_autoscuola_id on public.remote_capture_sessions(autoscuola_id);
create index if not exists idx_remote_capture_sessions_expires_at on public.remote_capture_sessions(expires_at);
create index if not exists idx_remote_capture_sessions_updated_at on public.remote_capture_sessions(updated_at desc);

-- -----------------------------------------------------------------------------
-- RLS (Row Level Security) – opzionale: abilita se vuoi policy per utente
-- Per ora le policy sono disabilitate; il backend usa service_role.
-- -----------------------------------------------------------------------------
-- alter table public.autoscuole enable row level security;
-- alter table public.candidates enable row level security;
-- ...

commit;

-- Notifica PostgREST di ricaricare lo schema
notify pgrst, 'reload schema';
