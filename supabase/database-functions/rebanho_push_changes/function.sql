-- Aplica um lote lógico (ex.: animal + movimentação + histórico) em uma transação.
-- O batch_id torna a repetição segura quando a resposta da rede se perde.
create or replace function public.rebanho_push_changes(
  p_token text,
  p_batch_id text,
  p_changes jsonb
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
  v_operation text;
  v_base bigint;
  v_existing jsonb;
  v_data jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_seen_key text;
  v_result jsonb;
  v_cursor bigint;
begin
  select * into v_user from public._rebanho_current_user(p_token);
  if v_user.uid is null then return jsonb_build_object('ok', false, 'error', 'INVALID_SESSION'); end if;
  if coalesce(v_user.role, '') not in ('OWNER','ADMIN','FIELD') then return jsonb_build_object('ok', false, 'error', 'ROLE_DENIED'); end if;
  if nullif(trim(coalesce(p_batch_id, '')), '') is null or length(p_batch_id) > 200 then return jsonb_build_object('ok', false, 'error', 'INVALID_BATCH_ID'); end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then return jsonb_build_object('ok', false, 'error', 'INVALID_CHANGES'); end if;
  if jsonb_array_length(p_changes) > 2000 then return jsonb_build_object('ok', false, 'error', 'BATCH_TOO_LARGE'); end if;

  select result into v_result from public.rebanho_applied_batches where batch_id = p_batch_id;
  if v_result is not null then return v_result || jsonb_build_object('duplicate', true); end if;

  -- Primeiro valida o lote inteiro. Se houver conflito, nenhuma linha é alterada.
  for v_item in select value from jsonb_array_elements(p_changes)
  loop
    v_entity := v_item ->> 'entity';
    v_table := case v_entity
      when 'animals' then 'rebanho_animals' when 'movements' then 'rebanho_movements'
      when 'reproducers' then 'rebanho_reproducers' when 'history' then 'rebanho_history'
      when 'historical_dams' then 'rebanho_historical_dams' when 'pedigree' then 'rebanho_pedigree'
      else null end;
    if v_table is null then return jsonb_build_object('ok', false, 'error', 'INVALID_ENTITY'); end if;
    v_uid := nullif(trim(v_item ->> 'uid'), '');
    v_operation := v_item ->> 'operation';
    v_base := coalesce((v_item ->> 'baseVersion')::bigint, 0);
    v_data := coalesce(v_item -> 'data', '{}'::jsonb);
    if v_uid is null or v_operation not in ('insert','update','delete') or jsonb_typeof(v_data) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_CHANGE');
    end if;
    v_seen_key := v_entity || ':' || v_uid;
    if v_seen ? v_seen_key then return jsonb_build_object('ok', false, 'error', 'DUPLICATE_CHANGE'); end if;
    v_seen := v_seen || jsonb_build_object(v_seen_key, true);
    execute format('select to_jsonb(t) from public.%I t where uid = $1', v_table) into v_existing using v_uid;
    if (v_operation = 'insert' and v_existing is not null)
       or (v_operation in ('update','delete') and (v_existing is null or coalesce((v_existing ->> 'version')::bigint, 0) <> v_base)) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('entity', v_entity, 'uid', v_uid, 'server', v_existing, 'local', v_item));
    end if;

    -- Mantém exatamente os mesmos perfis da autenticação antiga.
    if v_user.role = 'FIELD' then
      if v_entity in ('reproducers','historical_dams','pedigree') or v_operation = 'delete' then
        return jsonb_build_object('ok', false, 'error', 'ROLE_DENIED');
      elsif v_entity = 'animals' and v_operation = 'insert' and coalesce(v_data ->> 'origin', '') <> 'Nascimento' then
        return jsonb_build_object('ok', false, 'error', 'FIELD_CAN_ONLY_REGISTER_BIRTH');
      elsif v_entity = 'animals' and v_operation = 'update' and v_existing is not null then
        if (v_data - 'status') is distinct from ((v_existing -> 'data') - 'status')
           or coalesce(v_data ->> 'status', '') not in ('VENDIDO','MORTO') then
          return jsonb_build_object('ok', false, 'error', 'FIELD_CANNOT_EDIT_ANIMAL');
        end if;
      elsif v_entity in ('movements','history') and v_operation <> 'insert' then
        return jsonb_build_object('ok', false, 'error', 'FIELD_CANNOT_EDIT_HISTORY');
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT', 'conflicts', v_conflicts);
  end if;

  for v_item in select value from jsonb_array_elements(p_changes)
  loop
    v_entity := v_item ->> 'entity';
    v_table := case v_entity
      when 'animals' then 'rebanho_animals' when 'movements' then 'rebanho_movements'
      when 'reproducers' then 'rebanho_reproducers' when 'history' then 'rebanho_history'
      when 'historical_dams' then 'rebanho_historical_dams' when 'pedigree' then 'rebanho_pedigree' end;
    v_uid := v_item ->> 'uid'; v_operation := v_item ->> 'operation'; v_data := v_item -> 'data';
    if v_operation = 'insert' then
      execute format('insert into public.%I(uid,data,version,updated_at,updated_by,deleted_at) values ($1,$2,1,now(),$3,null)', v_table)
        using v_uid, v_data, v_user.uid;
    elsif v_operation = 'update' then
      execute format('update public.%I set data=$2,version=version+1,updated_at=now(),updated_by=$3,deleted_at=null where uid=$1', v_table)
        using v_uid, v_data, v_user.uid;
    else
      execute format('update public.%I set version=version+1,updated_at=now(),updated_by=$2,deleted_at=now() where uid=$1', v_table)
        using v_uid, v_user.uid;
    end if;
  end loop;

  select coalesce(max(seq), 0) into v_cursor from public.rebanho_change_log;
  v_result := jsonb_build_object('ok', true, 'cursor', v_cursor, 'applied', jsonb_array_length(p_changes));
  insert into public.rebanho_applied_batches(batch_id, result, applied_by) values (p_batch_id, v_result, v_user.uid);
  return v_result;
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'DUPLICATE_VALUE', 'detail', sqlerrm);
end;
$$;

revoke all on function public.rebanho_push_changes(text, text, jsonb) from public;
grant execute on function public.rebanho_push_changes(text, text, jsonb) to anon, authenticated;
