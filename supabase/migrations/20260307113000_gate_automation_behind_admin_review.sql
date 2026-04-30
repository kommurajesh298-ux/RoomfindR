SET search_path = public;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS admin_approved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS admin_review_notes TEXT;
UPDATE public.bookings
SET admin_approved = COALESCE(admin_approved, FALSE)
WHERE admin_approved IS NULL;
ALTER TABLE public.bookings
  ALTER COLUMN admin_approved SET DEFAULT FALSE,
  ALTER COLUMN admin_approved SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_admin_reviewed_by_fkey'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_admin_reviewed_by_fkey
      FOREIGN KEY (admin_reviewed_by) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_bookings_admin_approved
  ON public.bookings(admin_approved, status);
CREATE OR REPLACE FUNCTION public.trigger_booking_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
    status_lower TEXT;
    actor_id UUID;
    initiated_by TEXT := 'system';
    reason TEXT;
    reason_code TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.admin_approved IS NOT DISTINCT FROM OLD.admin_approved THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.admin_approved, FALSE) IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    status_lower := lower(NEW.status::text);
    IF status_lower NOT IN ('rejected','cancelled','cancelled_by_customer','cancelled-by-customer') THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM refunds
        WHERE booking_id = NEW.id
          AND status IN ('PENDING','PROCESSING','SUCCESS','PROCESSED')
    ) THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM payments
        WHERE booking_id = NEW.id
          AND status IN ('completed','success','authorized')
    ) THEN
        RETURN NEW;
    END IF;

    actor_id := auth.uid();
    IF actor_id IS NOT NULL THEN
        IF is_admin() THEN
            initiated_by := 'admin';
        ELSIF actor_id = NEW.owner_id THEN
            initiated_by := 'owner';
        ELSIF actor_id = NEW.customer_id THEN
            initiated_by := 'user';
        END IF;
    END IF;

    IF status_lower = 'rejected' THEN
        reason := COALESCE(NEW.rejection_reason, 'Booking rejected');
        reason_code := 'booking_rejected';
    ELSE
        reason := COALESCE(NEW.rejection_reason, 'Booking cancelled');
        reason_code := 'booking_cancelled';
    END IF;

    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for refund automation';
        RETURN NEW;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/cashfree-refund',
        headers := headers,
        body := jsonb_build_object(
            'bookingId', NEW.id,
            'reason', reason,
            'refundReason', reason_code,
            'initiatedBy', initiated_by
        )
    );

    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.trigger_payment_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
    booking_status TEXT;
    booking_admin_approved BOOLEAN;
    booking_amount_due NUMERIC;
    booking_advance NUMERIC;
    booking_monthly NUMERIC;
    expected_amount NUMERIC;
    reason_code TEXT;
    reason TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF lower(NEW.status::text) NOT IN ('completed','success') THEN
        RETURN NEW;
    END IF;

    IF lower(OLD.status::text) IN ('completed','success') THEN
        RETURN NEW;
    END IF;

    IF lower(COALESCE(NEW.payment_type, '')) = 'monthly' THEN
        RETURN NEW;
    END IF;

    SELECT status, admin_approved, amount_due, advance_paid, monthly_rent
    INTO booking_status, booking_admin_approved, booking_amount_due, booking_advance, booking_monthly
    FROM bookings
    WHERE id = NEW.booking_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF COALESCE(booking_admin_approved, FALSE) IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    IF lower(booking_status::text) IN ('rejected','cancelled','cancelled_by_customer','cancelled-by-customer') THEN
        reason_code := 'booking_failed';
        reason := 'Payment received but booking failed';
    END IF;

    IF reason_code IS NULL AND EXISTS (
        SELECT 1 FROM payments
        WHERE booking_id = NEW.booking_id
          AND id <> NEW.id
          AND status IN ('completed','success','authorized')
          AND COALESCE(payment_type, '') = COALESCE(NEW.payment_type, '')
    ) THEN
        reason_code := 'duplicate_payment';
        reason := 'Duplicate payment detected';
    END IF;

    expected_amount := COALESCE(booking_amount_due, booking_advance, booking_monthly, NEW.amount);
    IF reason_code IS NULL AND expected_amount IS NOT NULL AND NEW.amount < (expected_amount - 0.01) THEN
        reason_code := 'partial_payment';
        reason := 'Partial payment detected';
    END IF;

    IF reason_code IS NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM refunds
        WHERE payment_id = NEW.id
          AND status IN ('PENDING','PROCESSING','SUCCESS','PROCESSED')
    ) THEN
        RETURN NEW;
    END IF;

    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for refund automation';
        RETURN NEW;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/cashfree-refund',
        headers := headers,
        body := jsonb_build_object(
            'paymentId', NEW.id,
            'bookingId', NEW.booking_id,
            'reason', reason,
            'refundReason', reason_code,
            'initiatedBy', 'system'
        )
    );

    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.trigger_booking_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.admin_approved IS NOT DISTINCT FROM OLD.admin_approved THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.admin_approved, FALSE) IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    IF lower(COALESCE(NEW.status::text, '')) = 'approved' THEN
        IF EXISTS (
            SELECT 1 FROM settlements
            WHERE booking_id = NEW.id
        ) THEN
            RETURN NEW;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM payments
            WHERE booking_id = NEW.id
              AND status IN ('completed','success','authorized')
        ) THEN
            RETURN NEW;
        END IF;

        SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
        SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

        IF supabase_url IS NULL OR service_key IS NULL THEN
            RAISE NOTICE 'Missing supabase_url or service key for settlement automation';
            RETURN NEW;
        END IF;

        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_key
        );

        PERFORM net.http_post(
            url := supabase_url || '/functions/v1/cashfree-settlement',
            headers := headers,
            body := jsonb_build_object(
                'bookingId', NEW.id
            )
        );
    END IF;

    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.trigger_payment_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    normalized_status TEXT := lower(COALESCE(NEW.status, NEW.payment_status, ''));
    previous_status TEXT := lower(COALESCE(OLD.status, OLD.payment_status, ''));
    booking_status TEXT;
    booking_admin_approved BOOLEAN;
    supabase_url TEXT;
    service_key TEXT;
    headers JSONB;
BEGIN
    IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
        RETURN NEW;
    END IF;

    IF lower(COALESCE(NEW.provider, '')) <> 'cashfree' THEN
        RETURN NEW;
    END IF;

    IF normalized_status NOT IN ('completed', 'success', 'authorized') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND previous_status = normalized_status
       AND previous_status IN ('completed', 'success', 'authorized') THEN
        RETURN NEW;
    END IF;

    SELECT lower(status::text), admin_approved
    INTO booking_status, booking_admin_approved
    FROM bookings
    WHERE id = NEW.booking_id;

    IF booking_status IS NULL THEN
        RETURN NEW;
    END IF;

    IF COALESCE(booking_admin_approved, FALSE) IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    IF booking_status NOT IN ('approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing') THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM settlements
        WHERE payment_id = NEW.id
    ) THEN
        RETURN NEW;
    END IF;

    SELECT value INTO supabase_url FROM config WHERE key = 'supabase_url';
    SELECT value INTO service_key FROM config WHERE key = 'supabase_service_role_key';

    IF supabase_url IS NULL OR service_key IS NULL THEN
        RAISE NOTICE 'Missing supabase_url or service key for settlement automation';
        RETURN NEW;
    END IF;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
    );

    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/cashfree-settlement',
        headers := headers,
        body := jsonb_build_object(
            'bookingId', NEW.booking_id,
            'paymentId', NEW.id
        )
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_refund_trigger ON public.bookings;
CREATE TRIGGER bookings_refund_trigger
AFTER UPDATE OF status, admin_approved ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_booking_refund();
DROP TRIGGER IF EXISTS payments_refund_trigger ON public.payments;
CREATE TRIGGER payments_refund_trigger
AFTER UPDATE OF status ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.trigger_payment_refund();
DROP TRIGGER IF EXISTS bookings_settlement_trigger ON public.bookings;
CREATE TRIGGER bookings_settlement_trigger
AFTER UPDATE OF status, admin_approved ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trigger_booking_settlement();
DROP TRIGGER IF EXISTS payments_settlement_trigger ON public.payments;
CREATE TRIGGER payments_settlement_trigger
AFTER INSERT OR UPDATE OF status, payment_status ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.trigger_payment_settlement();
NOTIFY pgrst, 'reload schema';
