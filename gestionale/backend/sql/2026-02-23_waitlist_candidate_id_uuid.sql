-- Esegui in Supabase SQL Editor
-- Obiettivo: allineare waitlist.candidate_id (UUID) con candidates.id (UUID)

begin;

alter table public.waitlist
  drop constraint if exists waitlist_candidate_id_fkey;

-- Rimuove eventuale FK con nome diverso
do $$
declare
  fk_name text;
begin
  for fk_name in
    select tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'waitlist'
      and tc.constraint_type = 'FOREIGN KEY'
      and kcu.column_name = 'candidate_id'
  loop
    execute format('alter table public.waitlist drop constraint %I', fk_name);
  end loop;
end $$;

-- Se candidate_id è bigint, convertiamo il tipo a UUID
-- I valori numerici esistenti non sono convertibili a UUID: vengono azzerati a NULL
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'waitlist'
      and column_name = 'candidate_id'
      and udt_name = 'int8'
  ) then
    execute 'alter table public.waitlist alter column candidate_id type uuid using null::uuid';
  end if;
end $$;

-- FK corretta verso candidates(id)
alter table public.waitlist
  add constraint waitlist_candidate_id_fkey
  foreign key (candidate_id)
  references public.candidates(id)
  on delete set null;

-- Indice utile
create index if not exists idx_waitlist_candidate_id
  on public.waitlist(candidate_id);

commit;

-- Verifica finale: deve risultare udt_name = 'uuid'
select table_schema, table_name, column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'waitlist'
  and column_name = 'candidate_id';
