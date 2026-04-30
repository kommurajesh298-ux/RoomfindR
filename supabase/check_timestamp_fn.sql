-- check definition of the timestamp trigger function
select pg_get_functiondef('update_updated_at_column'::regproc);