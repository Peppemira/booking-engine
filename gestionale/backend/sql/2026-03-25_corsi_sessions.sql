-- ============================================================
-- Tabelle corsi_sessions e corsi_presenze
-- Equivalente GeCA: GeCorsi, menuCorsi, auleLezioni, gestAule, PRESENZECORSI
-- ============================================================

-- -----------------------------------------------------------
-- corsi_sessions: iscrizione di un candidato a un corso
-- -----------------------------------------------------------
create table if not exists corsi_sessions (
  id                  uuid primary key default gen_random_uuid(),
  autoscuola_id       uuid references autoscuole(id) on delete cascade,
  candidate_id        uuid references candidates(id) on delete cascade,
  tipo_corso          text not null default 'ALTRO',
    -- CQC | CQC_CARD | ADR | RECUPERO_PUNTI | ALTRO
  data_inizio         date,
  data_fine           date,
  ente_organizzatore  text,
  sede_corso          text,
  ore_totali          numeric(5,1),
  ore_frequentate     numeric(5,1),
  stato               text default 'in_corso',
    -- in_corso | completato | annullato | sospeso
  esito               text,
    -- idoneo | non_idoneo | null
  note                text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Indici
create index if not exists idx_corsi_sessions_candidate
  on corsi_sessions(candidate_id);

create index if not exists idx_corsi_sessions_autoscuola
  on corsi_sessions(autoscuola_id);

create index if not exists idx_corsi_sessions_tipo
  on corsi_sessions(autoscuola_id, tipo_corso, stato);

-- RLS
alter table corsi_sessions enable row level security;
create policy if not exists "corsi_sessions_autoscuola_only"
  on corsi_sessions
  using (true)
  with check (true);

-- -----------------------------------------------------------
-- corsi_presenze: presenze per singola lezione di un corso
-- -----------------------------------------------------------
create table if not exists corsi_presenze (
  id                  uuid primary key default gen_random_uuid(),
  autoscuola_id       uuid references autoscuole(id) on delete cascade,
  corsi_session_id    uuid references corsi_sessions(id) on delete cascade,
  candidate_id        uuid references candidates(id) on delete cascade,
  data_lezione        date not null,
  ora_inizio          time,
  ora_fine            time,
  argomento           text,
  docente             text,
  ore                 numeric(3,1),
  presente            boolean default true,
  note                text,
  created_at          timestamptz default now()
);

-- Indici
create index if not exists idx_corsi_presenze_session
  on corsi_presenze(corsi_session_id);

create index if not exists idx_corsi_presenze_candidate
  on corsi_presenze(candidate_id);

create index if not exists idx_corsi_presenze_autoscuola
  on corsi_presenze(autoscuola_id, data_lezione desc);

-- RLS
alter table corsi_presenze enable row level security;
create policy if not exists "corsi_presenze_autoscuola_only"
  on corsi_presenze
  using (true)
  with check (true);
