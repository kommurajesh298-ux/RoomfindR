BEGIN;
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payouts'
      AND column_name = 'actioned_by'
  ) THEN
    SELECT con.conname
    INTO v_conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'public.payouts'::regclass
      AND con.confrelid = 'auth.users'::regclass
      AND att.attname = 'actioned_by'
    LIMIT 1;

    IF v_conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.payouts DROP CONSTRAINT %I', v_conname);
    END IF;

    ALTER TABLE public.payouts
      ADD CONSTRAINT payouts_actioned_by_fkey
      FOREIGN KEY (actioned_by)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'refunds'
      AND column_name = 'requested_by'
  ) THEN
    SELECT con.conname
    INTO v_conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'public.refunds'::regclass
      AND con.confrelid = 'auth.users'::regclass
      AND att.attname = 'requested_by'
    LIMIT 1;

    IF v_conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.refunds DROP CONSTRAINT %I', v_conname);
    END IF;

    ALTER TABLE public.refunds
      ADD CONSTRAINT refunds_requested_by_fkey
      FOREIGN KEY (requested_by)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_actions'
      AND column_name = 'actor_id'
  ) THEN
    SELECT con.conname
    INTO v_conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'public.admin_actions'::regclass
      AND con.confrelid = 'auth.users'::regclass
      AND att.attname = 'actor_id'
    LIMIT 1;

    IF v_conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.admin_actions DROP CONSTRAINT %I', v_conname);
    END IF;

    ALTER TABLE public.admin_actions
      ADD CONSTRAINT admin_actions_actor_id_fkey
      FOREIGN KEY (actor_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
COMMIT;
