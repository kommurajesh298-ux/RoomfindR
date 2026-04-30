BEGIN;

CREATE OR REPLACE FUNCTION public.handle_auth_user_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Null audit-style references first. Some environments may still have older
  -- foreign keys without ON DELETE SET NULL, and these should not block deletes.
  IF to_regclass('public.admin_actions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'admin_actions'
        AND column_name = 'actor_id'
    ) THEN
      UPDATE public.admin_actions
      SET actor_id = NULL
      WHERE actor_id = OLD.id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'admin_actions'
        AND column_name = 'admin_id'
    ) THEN
      UPDATE public.admin_actions
      SET admin_id = NULL
      WHERE admin_id = OLD.id;
    END IF;
  END IF;

  IF to_regclass('public.refunds') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'refunds'
        AND column_name = 'requested_by'
    ) THEN
      UPDATE public.refunds
      SET requested_by = NULL
      WHERE requested_by = OLD.id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'refunds'
        AND column_name = 'approved_by'
    ) THEN
      UPDATE public.refunds
      SET approved_by = NULL
      WHERE approved_by = OLD.id;
    END IF;
  END IF;

  IF to_regclass('public.payouts') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payouts'
        AND column_name = 'actioned_by'
    ) THEN
      UPDATE public.payouts
      SET actioned_by = NULL
      WHERE actioned_by = OLD.id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payouts'
        AND column_name = 'admin_id'
    ) THEN
      UPDATE public.payouts
      SET admin_id = NULL
      WHERE admin_id = OLD.id;
    END IF;
  END IF;

  IF to_regclass('public.payment_attempts') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_attempts'
        AND column_name = 'created_by'
    ) THEN
      UPDATE public.payment_attempts
      SET created_by = NULL
      WHERE created_by = OLD.id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_attempts'
        AND column_name = 'cancelled_by'
    ) THEN
      UPDATE public.payment_attempts
      SET cancelled_by = NULL
      WHERE cancelled_by = OLD.id;
    END IF;
  END IF;

  IF to_regclass('public.payment_attempt_history') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_attempt_history'
        AND column_name = 'changed_by'
    ) THEN
      UPDATE public.payment_attempt_history
      SET changed_by = NULL
      WHERE changed_by = OLD.id;
    END IF;
  END IF;

  IF to_regclass('public.settlements') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'settlements'
        AND column_name = 'approved_by'
    ) THEN
      UPDATE public.settlements
      SET approved_by = NULL
      WHERE approved_by = OLD.id;
    END IF;
  END IF;

  IF to_regclass('public.transaction_logs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'transaction_logs'
        AND column_name = 'created_by'
    ) THEN
      UPDATE public.transaction_logs
      SET created_by = NULL
      WHERE created_by = OLD.id;
    END IF;
  END IF;

  -- Remove rows that still hold required or RESTRICT-style references to auth.users.
  IF to_regclass('public.payouts') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payouts'
        AND column_name = 'owner_id'
    ) THEN
    DELETE FROM public.payouts
    WHERE owner_id = OLD.id;
  END IF;

  IF to_regclass('public.orders') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'customer_id'
    ) AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'owner_id'
    ) THEN
      DELETE FROM public.orders
      WHERE customer_id = OLD.id
         OR owner_id = OLD.id;
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'customer_id'
    ) THEN
      DELETE FROM public.orders
      WHERE customer_id = OLD.id;
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'owner_id'
    ) THEN
      DELETE FROM public.orders
      WHERE owner_id = OLD.id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted_cleanup ON auth.users;

CREATE TRIGGER on_auth_user_deleted_cleanup
BEFORE DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_delete_cleanup();

COMMENT ON FUNCTION public.handle_auth_user_delete_cleanup() IS
  'Pre-cleans payment and audit references so hard deletes from auth.users can complete.';

COMMIT;
