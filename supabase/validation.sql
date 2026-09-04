-- Execute após a importação e compare com o relatório do validador local.
select 'animals' as entity, count(*) as active_records from public.rebanho_animals where deleted_at is null
union all select 'movements', count(*) from public.rebanho_movements where deleted_at is null
union all select 'reproducers', count(*) from public.rebanho_reproducers where deleted_at is null
union all select 'history', count(*) from public.rebanho_history where deleted_at is null
union all select 'historical_dams', count(*) from public.rebanho_historical_dams where deleted_at is null
union all select 'pedigree', count(*) from public.rebanho_pedigree where deleted_at is null;

select count(*) as archived_imports, max(imported_at) as last_import
from public.rebanho_imports;

select count(*) as changes_available, coalesce(max(seq), 0) as current_cursor
from public.rebanho_change_log;

