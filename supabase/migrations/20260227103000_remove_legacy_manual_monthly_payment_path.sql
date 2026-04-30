BEGIN;
DO $$
DECLARE
    fn regprocedure;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'record_monthly_payment'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn);
    END LOOP;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
