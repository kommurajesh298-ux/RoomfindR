BEGIN;

CREATE OR REPLACE FUNCTION public.handle_auth_user_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  fk record;
BEGIN
  -- Clear nullable audit references first.
  FOR fk IN
    SELECT
      ns.nspname AS table_schema,
      cls.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cls
      ON cls.oid = con.conrelid
    JOIN pg_namespace ns
      ON ns.oid = cls.relnamespace
    JOIN unnest(con.conkey) AS key_cols(attnum)
      ON TRUE
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = key_cols.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND con.confdeltype = 'n'
      AND ns.nspname = 'public'
    ORDER BY ns.nspname, cls.relname, att.attname
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = NULL WHERE %I = $1',
      fk.table_schema,
      fk.table_name,
      fk.column_name,
      fk.column_name
    )
    USING OLD.id;
  END LOOP;

  -- Delete every non-nullable direct reference under postgres privileges so the
  -- auth service role does not need cross-schema DELETE permissions.
  FOR fk IN
    SELECT
      ns.nspname AS table_schema,
      cls.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cls
      ON cls.oid = con.conrelid
    JOIN pg_namespace ns
      ON ns.oid = cls.relnamespace
    JOIN unnest(con.conkey) AS key_cols(attnum)
      ON TRUE
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = key_cols.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND con.confdeltype IN ('a', 'c', 'd', 'r')
      AND ns.nspname = 'public'
    ORDER BY
      CASE cls.relname
        WHEN 'orders' THEN 0
        WHEN 'payouts' THEN 1
        ELSE 2
      END,
      ns.nspname,
      cls.relname,
      att.attname
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I WHERE %I = $1',
      fk.table_schema,
      fk.table_name,
      fk.column_name
    )
    USING OLD.id;
  END LOOP;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.handle_auth_user_delete_cleanup() IS
  'Pre-cleans every direct public->auth.users foreign-key reference so Auth hard deletes can complete under service-role permissions.';

COMMIT;
