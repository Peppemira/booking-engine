-- Campo storico per archivio attuale/storico (GeCA: iscritti.storico 0=attuale, 1=storico).
alter table public.candidates add column if not exists storico boolean not null default false;
comment on column public.candidates.storico is 'Archivio: false=Attuale, true=Storico (GeCA: iscritti.storico)';
