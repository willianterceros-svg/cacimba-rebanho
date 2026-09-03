-- RPC pública usada pelo frontend para baixar somente alterações posteriores ao cursor.
create or replace function public.rebanho_pull_changes(
  p_token text,
  p_after_seq bigint default 0,
  p_limit integer default 750
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 750), 1000));
  v_changes jsonb;
  v_next bigint := coalesce(p_after_seq, 0);
  v_more boolean := false;
begin
  select * into v_user from public._rebanho_current_user(p_token);
  if v_user.uid is null then return jsonb_build_object('ok', false, 'error', 'INVALID_SESSION'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'seq', selected.seq, 'entity', selected.entity_type, 'uid', selected.entity_uid,
           'operation', selected.operation, 'record', selected.record
         ) order by selected.seq), '[]'::jsonb),
         coalesce(max(selected.seq), coalesce(p_after_seq, 0))
    into v_changes, v_next
    from (
      select seq, entity_type, entity_uid, operation, record
        from public.rebanho_change_log
       where seq > coalesce(p_after_seq, 0)
       order by seq
       limit v_limit
    ) selected;

  select exists(select 1 from public.rebanho_change_log where seq > v_next) into v_more;
  return jsonb_build_object('ok', true, 'changes', v_changes, 'nextCursor', v_next, 'hasMore', v_more);
end;
$$;

revoke all on function public.rebanho_pull_changes(text, bigint, integer) from public;
grant execute on function public.rebanho_pull_changes(text, bigint, integer) to anon, authenticated;

