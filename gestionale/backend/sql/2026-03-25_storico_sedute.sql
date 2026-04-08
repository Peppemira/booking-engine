-- ============================================================
-- Tabella storico_sedute
-- Usata da: gestionale/backend/tools/storico_sedute.js
-- Scraper Puppeteer che legge le sedute (teoria/guida/CQC)
-- dal Portale dell'Automobilista e le salva qui per uso offline.
-- Equivalente GeCA: readSessioniQuizInterne / radar sedute
-- ============================================================

create table if not exists storico_sedute (
  id                  uuid primary key default gen_random_uuid(),
  id_sessione         text,                    -- id univoco dal portale
  tipo_seduta         text not null,           -- TEORIA | GUIDA | CQC
  codice_autoscuola   text,

  -- Date
  data_sessione       date,
  data_apertura       date,
  data_chiusura       date,

  -- Info seduta
  stato               text,
  tipo_patente        text,
  aula                text,
  posti_totali        integer default 0,
  posti_occupati      integer default 0,
  posti_liberi        integer default 0,

  -- Metadati
  raw_data            jsonb,                   -- dati grezzi dal portale
  aggiornato_il       timestamptz default now(),
  created_at          timestamptz default now()
);

-- Indice univoco per upsert (stesso approccio dello scraper)
create unique index if not exists idx_storico_sedute_unique
  on storico_sedute(id_sessione, tipo_seduta)
  where id_sessione is not null;

-- Indici per query frequenti
create index if not exists idx_storico_sedute_tipo
  on storico_sedute(tipo_seduta, data_sessione desc);

create index if not exists idx_storico_sedute_codice
  on storico_sedute(codice_autoscuola, data_sessione desc);

create index if not exists idx_storico_sedute_aggiornato
  on storico_sedute(aggiornato_il desc);

-- RLS (il backend usa service_role key, ma abilita comunque)
alter table storico_sedute enable row level security;
create policy if not exists "storico_sedute_public_read"
  on storico_sedute for select
  using (true);
create policy if not exists "storico_sedute_service_write"
  on storico_sedute for all
  using (true)
  with check (true);
