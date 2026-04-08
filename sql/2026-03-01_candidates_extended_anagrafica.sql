alter table if exists public.candidates
  add column if not exists patente_numero text,
  add column if not exists telefono text,
  add column if not exists email text,
  add column if not exists data_nascita date,
  add column if not exists comune_nascita text,
  add column if not exists provincia_nascita text,
  add column if not exists codice_autoscuola text,
  add column if not exists raw_portale jsonb default '{}'::jsonb;

update public.candidates
set raw_portale = '{}'::jsonb
where raw_portale is null;

create index if not exists idx_candidates_codice_autoscuola
  on public.candidates(codice_autoscuola);

notify pgrst, 'reload schema';
