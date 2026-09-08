-- Retorna, sem alterar dados, as três versões necessárias para resolver conflitos:
-- base histórica, alteração local (enviada pelo frontend) e registro atual da nuvem.
create or replace function public.rebanho_conflict_context(
  p_token text,
  p_items jsonb
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user record;
  v_item jsonb;
  v_entity text;
  v_table text;
  v_uid text;
  v_base_version bigint;
  v_base_record jsonb;
  v_server_record jsonb;
  v_contexts jsonb := '[]'::jsonb;
begin
  select * into v_user from public._rebanho_current_user(p_token);
  if v_user.uid is null then return jsonb_build_object('ok', false, 'error', 'INVALID_SESSION'); end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then return jsonb_build_object('ok', false, 'error', 'INVALID_ITEMS'); end if;
  if jsonb_array_length(p_items) > 2000 then return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ITEMS'); end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_entity := v_item ->> 'entity';
    v_table := case v_entity
      when 'animals' then 'rebanho_animals' when 'movements' then 'rebanho_movements'
      when 'reproducers' then 'rebanho_reproducers' when 'history' then 'rebanho_history'
      when 'historical_dams' then 'rebanho_historical_dams' when 'pedigree' then 'rebanho_pedigree'
      else null end;
    v_uid := nullif(trim(v_item ->> 'uid'), '');
    if v_table is null or v_uid is null or coalesce(v_item ->> 'baseVersion', '') !~ '^[0-9]+$' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_ITEM');
    end if;
    v_base_version := greatest(0, (v_item ->> 'baseVersion')::bigint);

    v_server_record := null;
    execute format('select to_jsonb(t) from public.%I t where uid = $1', v_table)
      into v_server_record using v_uid;

    v_base_record := null;
    if jsonb_typeof(v_item -> 'baseData') = 'object' then
      v_base_record := jsonb_build_object('version', v_base_version, 'data', v_item -> 'baseData');
    elsif v_base_version > 0 then
      select record into v_base_record
        from public.rebanho_change_log
       where entity_type = v_entity
         and entity_uid = v_uid
         and record ->> 'version' = v_base_version::text
       order by seq desc
       limit 1;
    end if;

    v_contexts := v_contexts || jsonb_build_array(jsonb_build_object(
      'entity', v_entity,
      'uid', v_uid,
      'baseVersion', v_base_version,
      'base', v_base_record,
      'server', v_server_record
    ));
  end loop;

  return jsonb_build_object('ok', true, 'contexts', v_contexts);
end;
$$;

revoke all on function public.rebanho_conflict_context(text, jsonb) from public;
grant execute on function public.rebanho_conflict_context(text, jsonb) to anon, authenticated;
