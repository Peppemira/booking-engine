-- ============================================================
-- Tabella guide_sessions
-- Equivalente GeCA: newguide, guiobb, newcontguiall, conguist, valutazioni
-- ============================================================

create table if not exists guide_sessions (
  id              uuid primary key default gen_random_uuid(),
  autoscuola_id   uuid references autoscuole(id) on delete cascade,
  candidate_id    uuid references candidates(id) on delete cascade,
  data_guida      date not null,
  ora_inizio      time,
  ora_fine        time,
  istruttore      text,
  tipo_guida      text default 'normale',   -- normale | obbligatoria | certificata | A2A
  percorso        text,
  km              numeric(6,1),
  valutazione     smallint check (valutazione between 1 and 5),
  note            text,
  esito           text default 'completata', -- completata | annullata | sospesa
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Indici per query frequenti
create index if not exists idx_guide_sessions_candidate
  on guide_sessions(candidate_id);

create index if not exists idx_guide_sessions_autoscuola
  on guide_sessions(autoscuola_id);

create index if not exists idx_guide_sessions_data
  on guide_sessions(data_guida desc);

create index if not exists idx_guide_sessions_istruttore
  on guide_sessions(autoscuola_id, istruttore, data_guida desc);

-- RLS (Row Level Security) se Supabase lo richiede
alter table guide_sessions enable row level security;

-- Policy: solo l'autoscuola proprietaria può vedere/modificare
create policy if not exists "guide_sessions_autoscuola_only"
  on guide_sessions
  using (true)   -- il filtro per autoscuola_id viene fatto nel backend
  with check (true);
