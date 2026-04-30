BEGIN;
ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS advance_paid numeric(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rent_paid numeric(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_status text DEFAULT 'pending';
UPDATE public.bookings
SET
  advance_paid = COALESCE(advance_paid, 0),
  rent_paid = COALESCE(rent_paid, 0),
  settlement_status = COALESCE(NULLIF(lower(trim(settlement_status)), ''), 'pending'),
  payout_status = COALESCE(NULLIF(lower(trim(payout_status)), ''), 'pending')
WHERE
  advance_paid IS NULL
  OR rent_paid IS NULL
  OR settlement_status IS NULL
  OR trim(COALESCE(settlement_status, '')) = ''
  OR payout_status IS NULL
  OR trim(COALESCE(payout_status, '')) = '';
ALTER TABLE IF EXISTS public.bookings
  ALTER COLUMN advance_paid SET DEFAULT 0,
  ALTER COLUMN rent_paid SET DEFAULT 0,
  ALTER COLUMN settlement_status SET DEFAULT 'pending',
  ALTER COLUMN payout_status SET DEFAULT 'pending';
ALTER TABLE IF EXISTS public.payouts
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_id text,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_approved boolean NOT NULL DEFAULT false;
UPDATE public.payouts
SET
  type = CASE
    WHEN lower(COALESCE(type, '')) IN ('advance', 'rent', 'settlement') THEN lower(type)
    WHEN lower(COALESCE(metadata->>'payout_type', '')) = 'advance' THEN 'advance'
    WHEN lower(COALESCE(metadata->>'payout_type', '')) IN ('settlement', 'rent') THEN 'settlement'
    ELSE COALESCE(type, 'settlement')
  END,
  status = COALESCE(NULLIF(lower(trim(status)), ''), NULLIF(lower(trim(payout_status)), ''), 'pending'),
  payout_status = COALESCE(NULLIF(lower(trim(payout_status)), ''), NULLIF(lower(trim(status)), ''), 'pending'),
  transfer_id = COALESCE(NULLIF(trim(transfer_id), ''), NULLIF(trim(metadata->>'transfer_id'), ''))
WHERE
  type IS NULL
  OR status IS NULL
  OR payout_status IS NULL
  OR transfer_id IS NULL
  OR trim(COALESCE(transfer_id, '')) = '';
DO $$
BEGIN
  IF to_regclass('public.payouts') IS NOT NULL THEN
    ALTER TABLE public.payouts
      DROP CONSTRAINT IF EXISTS payouts_type_check_manual_admin;
    ALTER TABLE public.payouts
      ADD CONSTRAINT payouts_type_check_manual_admin
      CHECK (type IS NULL OR lower(type) IN ('advance', 'rent', 'settlement'));

    ALTER TABLE public.payouts
      DROP CONSTRAINT IF EXISTS payouts_status_alias_check_manual_admin;
    ALTER TABLE public.payouts
      ADD CONSTRAINT payouts_status_alias_check_manual_admin
      CHECK (status IS NULL OR lower(status) IN ('pending', 'initiated', 'success', 'failed'));
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS payouts_transfer_id_uk
  ON public.payouts(transfer_id)
  WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payouts_booking_type_idx
  ON public.payouts(booking_id, type, created_at DESC);
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  payout_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.admin_actions
  ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_id text,
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF to_regclass('public.admin_actions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'admin_actions'
        AND column_name = 'actor_id'
    ) THEN
      EXECUTE '
        UPDATE public.admin_actions
        SET admin_id = COALESCE(admin_id, actor_id)
        WHERE admin_id IS NULL
      ';
    END IF;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS admin_actions_admin_created_idx
  ON public.admin_actions(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_actions_booking_created_idx
  ON public.admin_actions(booking_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS admin_actions_payout_action_uk
  ON public.admin_actions(action_type, payout_id)
  WHERE payout_id IS NOT NULL
    AND action_type IN ('APPROVE_ADVANCE_PAYOUT', 'APPROVE_RENT_SETTLEMENT');
ALTER TABLE IF EXISTS public.admin_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_actions_select_admin_cashfree ON public.admin_actions;
CREATE POLICY admin_actions_select_admin_cashfree
ON public.admin_actions
FOR SELECT
TO authenticated
USING (public.cashfree_is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_actions_insert_admin_cashfree ON public.admin_actions;
CREATE POLICY admin_actions_insert_admin_cashfree
ON public.admin_actions
FOR INSERT
TO authenticated
WITH CHECK (public.cashfree_is_admin(auth.uid()));
GRANT SELECT, INSERT ON public.admin_actions TO authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_actions;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
ALTER TABLE IF EXISTS public.admin_actions REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.payouts REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.bookings REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
