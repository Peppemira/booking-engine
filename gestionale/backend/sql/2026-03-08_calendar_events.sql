-- =============================================================================
-- Tabella calendar_events per integrazione Google Calendar / scadenze / guide / appuntamenti
-- Esegui in Supabase: SQL Editor → incolla e Run
-- =============================================================================

begin;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  autoscuola_id uuid references public.autoscuole(id) on delete set null,
  title text not null,
  description text,
  tipo text not null default 'appuntamento',  -- scadenza | guida | appuntamento | lezione | esame | altro
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  candidate_id uuid references public.candidates(id) on delete set null,
  google_event_id text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_autoscuola_id on public.calendar_events(autoscuola_id);
create index if not exists idx_calendar_events_start_at on public.calendar_events(start_at);
create index if not exists idx_calendar_events_end_at on public.calendar_events(end_at);
create index if not exists idx_calendar_events_tipo on public.calendar_events(tipo);
create index if not exists idx_calendar_events_candidate_id on public.calendar_events(candidate_id);

commit;
