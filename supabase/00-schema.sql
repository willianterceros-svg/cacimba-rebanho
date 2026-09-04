-- Cacimba Rebanho - estrutura incremental conservadora
-- Não remove nem altera rebanho_users, rebanho_sessions ou rebanho_state.
-- Execute primeiro em homologação e somente depois de validar o backup.

begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rebanho_animals (
  uid text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.rebanho_users(id),
  deleted_at timestamptz
);
create unique index if not exists rebanho_animals_identification_unique
  on public.rebanho_animals (lower(data ->> 'id'))
  where deleted_at is null and nullif(trim(data ->> 'id'), '') is not null;
create index if not exists rebanho_animals_status_idx on public.rebanho_animals ((data ->> 'status')) where deleted_at is null;

create table if not exists public.rebanho_movements (
  uid text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.rebanho_users(id),
  deleted_at timestamptz
);
create index if not exists rebanho_movements_animal_idx on public.rebanho_movements ((data ->> 'animalUid')) where deleted_at is null;
create index if not exists rebanho_movements_date_idx on public.rebanho_movements ((data ->> 'date')) where deleted_at is null;

create table if not exists public.rebanho_reproducers (
  uid text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.rebanho_users(id),
  deleted_at timestamptz
);
create unique index if not exists rebanho_reproducers_name_unique on public.rebanho_reproducers (lower(data ->> 'name')) where deleted_at is null;

create table if not exists public.rebanho_history (
  uid text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.rebanho_users(id),
  deleted_at timestamptz
);

create table if not exists public.rebanho_historical_dams (
  uid text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.rebanho_users(id),
  deleted_at timestamptz
);

create table if not exists public.rebanho_pedigree (
  uid text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.rebanho_users(id),
  deleted_at timestamptz
);

create table if not exists public.rebanho_change_log (
  seq bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('animals','movements','reproducers','history','historical_dams','pedigree')),
  entity_uid text not null,
  operation text not null check (operation in ('upsert','delete')),
  record jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.rebanho_users(id)
);
create index if not exists rebanho_change_log_entity_idx on public.rebanho_change_log (entity_type, entity_uid, seq desc);

create table if not exists public.rebanho_applied_batches (
  batch_id text primary key,
  result jsonb not null,
  applied_at timestamptz not null default now(),
  applied_by uuid references public.rebanho_users(id)
);

create table if not exists public.rebanho_imports (
  id uuid primary key default gen_random_uuid(),
  source_name text,
  raw_backup jsonb not null,
  counts jsonb not null,
  imported_at timestamptz not null default now(),
  imported_by uuid not null references public.rebanho_users(id)
);

create or replace function public._rebanho_current_user(p_token text)
returns table(uid uuid, name text, login text, role text)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select u.id, u.name, u.login, u.role
    from public.rebanho_sessions s
    join public.rebanho_users u on u.id = s.user_id
   where s.token_hash = encode(digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
     and s.expires_at > now()
     and u.active = true
   limit 1;
$$;

create or replace function public._rebanho_record_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_record jsonb; v_operation text; v_uid text; v_changed_by uuid;
begin
  if tg_op = 'DELETE' then
    v_record := to_jsonb(old); v_operation := 'delete'; v_uid := old.uid; v_changed_by := old.updated_by;
  else
    v_record := to_jsonb(new); v_uid := new.uid; v_changed_by := new.updated_by;
    v_operation := case when new.deleted_at is null then 'upsert' else 'delete' end;
  end if;
  insert into public.rebanho_change_log(entity_type, entity_uid, operation, record, changed_by)
  values (tg_argv[0], v_uid, v_operation, v_record, v_changed_by);
  return coalesce(new, old);
end;
$$;

do $$
declare item record;
begin
  for item in select * from (values
    ('rebanho_animals','animals'), ('rebanho_movements','movements'), ('rebanho_reproducers','reproducers'),
    ('rebanho_history','history'), ('rebanho_historical_dams','historical_dams'), ('rebanho_pedigree','pedigree')
  ) as definitions(table_name, entity_name)
  loop
    execute format('drop trigger if exists %I on public.%I', item.table_name || '_change', item.table_name);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._rebanho_record_change(%L)', item.table_name || '_change', item.table_name, item.entity_name);
  end loop;
end $$;

alter table public.rebanho_animals enable row level security;
alter table public.rebanho_movements enable row level security;
alter table public.rebanho_reproducers enable row level security;
alter table public.rebanho_history enable row level security;
alter table public.rebanho_historical_dams enable row level security;
alter table public.rebanho_pedigree enable row level security;
alter table public.rebanho_change_log enable row level security;
alter table public.rebanho_applied_batches enable row level security;
alter table public.rebanho_imports enable row level security;

revoke all on public.rebanho_animals, public.rebanho_movements, public.rebanho_reproducers,
  public.rebanho_history, public.rebanho_historical_dams, public.rebanho_pedigree,
  public.rebanho_change_log, public.rebanho_applied_batches, public.rebanho_imports
  from public, anon, authenticated;
revoke all on function public._rebanho_current_user(text), public._rebanho_record_change() from public, anon, authenticated;
commit;
