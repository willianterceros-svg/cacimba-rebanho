-- Consulta somente leitura. Execute antes de 00-schema.sql.
-- Todos os itens devem retornar status OK.
with required_tables(object_name) as (
  values ('rebanho_users'), ('rebanho_sessions'), ('rebanho_state')
)
select 'table' as object_type, object_name,
       case when to_regclass('public.' || object_name) is null then 'MISSING' else 'OK' end as status
from required_tables
order by object_name;

with required_columns(table_name, column_name, expected_type) as (
  values
    ('rebanho_users', 'id', 'uuid'),
    ('rebanho_users', 'name', 'text'),
    ('rebanho_users', 'login', 'text'),
    ('rebanho_users', 'role', 'text'),
    ('rebanho_users', 'active', 'boolean'),
    ('rebanho_sessions', 'token_hash', 'text'),
    ('rebanho_sessions', 'user_id', 'uuid'),
    ('rebanho_sessions', 'expires_at', 'timestamp with time zone'),
    ('rebanho_state', 'payload', 'jsonb')
)
select r.table_name || '.' || r.column_name as object_name,
       case
         when c.column_name is null then 'MISSING'
         when c.data_type <> r.expected_type then 'TYPE_MISMATCH: ' || c.data_type
         else 'OK'
       end as status
from required_columns r
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = r.table_name
 and c.column_name = r.column_name
order by r.table_name, r.column_name;

with required_functions(object_name) as (
  values
    ('rebanho_login'),
    ('rebanho_change_password'),
    ('rebanho_list_users'),
    ('rebanho_create_user'),
    ('rebanho_reset_user_password'),
    ('rebanho_toggle_user'),
    ('rebanho_delete_user')
)
select object_name,
       case when exists (
         select 1
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = object_name
       ) then 'OK' else 'MISSING' end as status
from required_functions
order by object_name;
