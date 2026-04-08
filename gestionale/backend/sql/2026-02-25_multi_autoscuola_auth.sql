create extension if not exists pgcrypto;

create table if not exists autoscuole (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  password_hash text not null,
  portal_user text,
  portal_pass text,
  portal_pin text,
  created_at timestamptz not null default now()
);

alter table candidates add column if not exists autoscuola_id uuid references autoscuole(id) on delete set null;
alter table waitlist add column if not exists autoscuola_id uuid references autoscuole(id) on delete set null;
alter table prenotazioni add column if not exists autoscuola_id uuid references autoscuole(id) on delete set null;

create index if not exists idx_candidates_autoscuola_id on candidates(autoscuola_id);
create index if not exists idx_waitlist_autoscuola_id on waitlist(autoscuola_id);
create index if not exists idx_prenotazioni_autoscuola_id on prenotazioni(autoscuola_id);

create unique index if not exists ux_candidates_autoscuola_patente
  on candidates(autoscuola_id, patente_numero)
  where patente_numero is not null;
