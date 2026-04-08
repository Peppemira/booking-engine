alter table if exists public.prenotazioni
  add column if not exists created_at timestamptz not null default now();

update public.prenotazioni
set created_at = now()
where created_at is null;

create index if not exists idx_prenotazioni_created_at
  on public.prenotazioni(created_at desc);

notify pgrst, 'reload schema';
