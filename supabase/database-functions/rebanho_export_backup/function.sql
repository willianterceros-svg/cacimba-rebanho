create or replace function public.rebanho_export_backup(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_user record; v_payload jsonb; v_cursor bigint;
begin
  select * into v_user from public._rebanho_current_user(p_token);
  if v_user.uid is null then return jsonb_build_object('ok', false, 'error', 'INVALID_SESSION'); end if;
  select coalesce(max(seq), 0) into v_cursor from public.rebanho_change_log;
  v_payload := jsonb_build_object(
    'schemaVersion', 5,
    'herd', (select coalesce(jsonb_agg(data order by uid), '[]'::jsonb) from public.rebanho_animals where deleted_at is null),
    'movementEvents', (select coalesce(jsonb_agg(data order by uid), '[]'::jsonb) from public.rebanho_movements where deleted_at is null),
    'reproducers', (select coalesce(jsonb_agg(data order by uid), '[]'::jsonb) from public.rebanho_reproducers where deleted_at is null),
    'history', (select coalesce(jsonb_agg(data order by updated_at desc), '[]'::jsonb) from public.rebanho_history where deleted_at is null),
    'historicalDams', (select coalesce(jsonb_agg(data order by uid), '[]'::jsonb) from public.rebanho_historical_dams where deleted_at is null),
    'pedigreeLibrary', (select coalesce(jsonb_agg(data order by uid), '[]'::jsonb) from public.rebanho_pedigree where deleted_at is null)
  );
  return jsonb_build_object('ok', true, 'backup', jsonb_build_object(
    'app', 'Agropecuária Cacimba — Gestão do Rebanho', 'backupVersion', 5,
    'generatedAt', now(), 'source', 'supabase-separated-tables', 'cursor', v_cursor, 'payload', v_payload
  ));
end;
$$;

revoke all on function public.rebanho_export_backup(text) from public;
grant execute on function public.rebanho_export_backup(text) to anon, authenticated;

