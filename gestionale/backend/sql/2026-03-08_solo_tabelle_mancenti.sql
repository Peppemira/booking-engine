-- =============================================================================
-- Solo tabelle che spesso mancano: pratiche_patente, pagamenti
-- Esegui in Supabase SQL Editor se hai già autoscuole, candidates, waitlist.
-- Richiede che esistano: public.autoscuole, public.candidates
-- =============================================================================

begin;

-- pratiche_patente (sync portale Richiesta Patenti)
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

-- pagamenti (cassa / pagoPA / satispay)
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

commit;

notify pgrst, 'reload schema';
