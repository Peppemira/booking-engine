-- Codice autoscuola per import/sync dal portale dell'automobilista (per codice scuola).
-- Esegui in Supabase SQL Editor se la colonna non esiste già.
alter table public.autoscuole add column if not exists codice_autoscuola text;
comment on column public.autoscuole.codice_autoscuola is 'Codice meccanografico autoscuola (portale automobilista). Usato per Aggiorna da portale.';
