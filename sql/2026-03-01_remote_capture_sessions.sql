create table if not exists public.remote_capture_sessions (
  token text primary key,
  autoscuola_id uuid null references public.autoscuole(id) on delete cascade,
  mode text not null default 'cie_mobile',
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_remote_capture_sessions_autoscuola_id
  on public.remote_capture_sessions(autoscuola_id);

create index if not exists idx_remote_capture_sessions_expires_at
  on public.remote_capture_sessions(expires_at);

create index if not exists idx_remote_capture_sessions_updated_at
  on public.remote_capture_sessions(updated_at desc);

notify pgrst, 'reload schema';
