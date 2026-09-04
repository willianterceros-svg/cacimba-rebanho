create or replace function public._rebanho_import_collection(
  p_entity text,
  p_items jsonb,
  p_user_id uuid
)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_item jsonb; v_data jsonb; v_uid text; v_table text; v_index bigint; v_count integer := 0;
begin
  v_table := case p_entity
    when 'animals' then 'rebanho_animals' when 'movements' then 'rebanho_movements'
    when 'reproducers' then 'rebanho_reproducers' when 'history' then 'rebanho_history'
    when 'historical_dams' then 'rebanho_historical_dams' when 'pedigree' then 'rebanho_pedigree'
    else null end;
  if v_table is null or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then return 0; end if;
  for v_item, v_index in select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_uid := case p_entity
      when 'animals' then v_item ->> 'uid' when 'movements' then v_item ->> 'eventUid'
      when 'reproducers' then v_item ->> 'uid' when 'historical_dams' then v_item ->> 'uid'
      when 'pedigree' then v_item ->> 'key'
      when 'history' then coalesce(v_item ->> 'uid', 'hist_' || md5(coalesce(v_item ->> 'when','') || '|' || coalesce(v_item ->> 'msg','') || '|' || v_index::text))
    end;
    if nullif(trim(coalesce(v_uid, '')), '') is null then raise exception 'Registro sem UID em % na posição %', p_entity, v_index; end if;
    v_data := v_item;
    if p_entity = 'history' and not (v_data ? 'uid') then v_data := v_data || jsonb_build_object('uid', v_uid); end if;
    execute format(
      'insert into public.%I(uid,data,version,updated_at,updated_by,deleted_at) values ($1,$2,1,now(),$3,null)
       on conflict (uid) do update set data=excluded.data,version=%I.version+1,updated_at=now(),updated_by=excluded.updated_by,deleted_at=null',
      v_table, v_table
    ) using v_uid, v_data, p_user_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.rebanho_import_backup(
  p_token text,
  p_backup jsonb,
  p_mode text default 'merge',
  p_source_name text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user record; v_root jsonb := p_backup; v_payload jsonb; v_counts jsonb; v_actual jsonb;
begin
  select * into v_user from public._rebanho_current_user(p_token);
  if v_user.uid is null then return jsonb_build_object('ok', false, 'error', 'INVALID_SESSION'); end if;
  if coalesce(v_user.role, '') <> 'OWNER' then return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED'); end if;
  if p_mode not in ('merge','replace') then return jsonb_build_object('ok', false, 'error', 'INVALID_MODE'); end if;
  if jsonb_typeof(v_root) = 'array' then v_root := v_root -> 0; end if;
  if v_root #> '{cloud,payload}' is not null then v_payload := v_root #> '{cloud,payload}';
  elsif v_root -> 'payload' is not null then v_payload := v_root -> 'payload';
  elsif v_root -> 'local' is not null then v_payload := v_root -> 'local';
  else v_payload := v_root; end if;
  if jsonb_typeof(v_payload -> 'herd') <> 'array' then return jsonb_build_object('ok', false, 'error', 'INVALID_BACKUP'); end if;

  v_counts := jsonb_build_object(
    'animals', jsonb_array_length(coalesce(v_payload -> 'herd','[]'::jsonb)),
    'movements', jsonb_array_length(coalesce(v_payload -> 'movementEvents','[]'::jsonb)),
    'reproducers', jsonb_array_length(coalesce(v_payload -> 'reproducers','[]'::jsonb)),
    'history', jsonb_array_length(coalesce(v_payload -> 'history','[]'::jsonb)),
    'historicalDams', jsonb_array_length(coalesce(v_payload -> 'historicalDams','[]'::jsonb)),
    'pedigree', jsonb_array_length(coalesce(v_payload -> 'pedigreeLibrary','[]'::jsonb))
  );
  insert into public.rebanho_imports(source_name, raw_backup, counts, imported_by)
  values (left(p_source_name, 250), p_backup, v_counts, v_user.uid);

  if p_mode = 'replace' then
    update public.rebanho_animals set version=version+1,updated_at=now(),updated_by=v_user.uid,deleted_at=now() where deleted_at is null;
    update public.rebanho_movements set version=version+1,updated_at=now(),updated_by=v_user.uid,deleted_at=now() where deleted_at is null;
    update public.rebanho_reproducers set version=version+1,updated_at=now(),updated_by=v_user.uid,deleted_at=now() where deleted_at is null;
    update public.rebanho_history set version=version+1,updated_at=now(),updated_by=v_user.uid,deleted_at=now() where deleted_at is null;
    update public.rebanho_historical_dams set version=version+1,updated_at=now(),updated_by=v_user.uid,deleted_at=now() where deleted_at is null;
    update public.rebanho_pedigree set version=version+1,updated_at=now(),updated_by=v_user.uid,deleted_at=now() where deleted_at is null;
  end if;

  perform public._rebanho_import_collection('animals', v_payload -> 'herd', v_user.uid);
  perform public._rebanho_import_collection('movements', v_payload -> 'movementEvents', v_user.uid);
  perform public._rebanho_import_collection('reproducers', v_payload -> 'reproducers', v_user.uid);
  perform public._rebanho_import_collection('history', v_payload -> 'history', v_user.uid);
  perform public._rebanho_import_collection('historical_dams', v_payload -> 'historicalDams', v_user.uid);
  perform public._rebanho_import_collection('pedigree', v_payload -> 'pedigreeLibrary', v_user.uid);

  v_actual := jsonb_build_object(
    'animals', (select count(*) from public.rebanho_animals where deleted_at is null),
    'movements', (select count(*) from public.rebanho_movements where deleted_at is null),
    'reproducers', (select count(*) from public.rebanho_reproducers where deleted_at is null),
    'history', (select count(*) from public.rebanho_history where deleted_at is null),
    'historicalDams', (select count(*) from public.rebanho_historical_dams where deleted_at is null),
    'pedigree', (select count(*) from public.rebanho_pedigree where deleted_at is null)
  );
  return jsonb_build_object('ok', true, 'sourceCounts', v_counts, 'counts', v_actual);
exception when others then
  raise;
end;
$$;

revoke all on function public._rebanho_import_collection(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.rebanho_import_backup(text, jsonb, text, text) from public;
grant execute on function public.rebanho_import_backup(text, jsonb, text, text) to anon, authenticated;
