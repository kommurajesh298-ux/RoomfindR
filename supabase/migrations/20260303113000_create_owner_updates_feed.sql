BEGIN;
CREATE TABLE IF NOT EXISTS public.owner_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_name text,
  property_name text,
  type text NOT NULL CHECK (type IN ('rent', 'advance', 'refund')),
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_status text,
  settlement_status text,
  transaction_id text NOT NULL,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE public.owner_updates
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS property_name text,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS settlement_status text,
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;
UPDATE public.owner_updates
SET amount = 0
WHERE amount IS NULL;
UPDATE public.owner_updates
SET created_at = NOW()
WHERE created_at IS NULL;
ALTER TABLE public.owner_updates
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN transaction_id SET NOT NULL,
  ALTER COLUMN amount SET DEFAULT 0,
  ALTER COLUMN amount SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.owner_updates
  DROP CONSTRAINT IF EXISTS owner_updates_type_check;
ALTER TABLE public.owner_updates
  ADD CONSTRAINT owner_updates_type_check
  CHECK (type IN ('rent', 'advance', 'refund'));
CREATE UNIQUE INDEX IF NOT EXISTS owner_updates_transaction_type_uk
  ON public.owner_updates(transaction_id, type);
CREATE INDEX IF NOT EXISTS owner_updates_owner_id_idx
  ON public.owner_updates(owner_id);
CREATE INDEX IF NOT EXISTS owner_updates_created_at_idx
  ON public.owner_updates(created_at DESC);
CREATE INDEX IF NOT EXISTS owner_updates_owner_created_idx
  ON public.owner_updates(owner_id, created_at DESC);
ALTER TABLE public.owner_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_updates_owner_select ON public.owner_updates;
CREATE POLICY owner_updates_owner_select
ON public.owner_updates
FOR SELECT
TO authenticated
USING (owner_id = auth.uid());
GRANT SELECT ON public.owner_updates TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.owner_updates FROM authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_updates;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
ALTER TABLE public.owner_updates REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
