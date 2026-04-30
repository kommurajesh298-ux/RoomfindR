BEGIN;
CREATE OR REPLACE FUNCTION public.has_verified_successful_payment(p_booking_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
SELECT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.booking_id = p_booking_id
            AND lower(
                coalesce(p.status::text, p.payment_status::text, '')
            ) IN ('completed', 'success', 'authorized', 'paid')
            AND (
                nullif(trim(coalesce(p.provider_payment_id, '')), '') IS NOT NULL
                OR p.verified_at IS NOT NULL
                OR p.payment_date IS NOT NULL
            )
    );
$$;
GRANT EXECUTE ON FUNCTION public.has_verified_successful_payment(UUID) TO authenticated,
    service_role;
CREATE OR REPLACE FUNCTION public.trigger_booking_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off AS $$
DECLARE supabase_url TEXT;
service_key TEXT;
headers JSONB;
status_lower TEXT;
actor_id UUID;
initiated_by TEXT := 'system';
reason TEXT;
reason_code TEXT;
BEGIN IF TG_OP <> 'UPDATE' THEN RETURN NEW;
END IF;
IF NEW.status IS NOT DISTINCT
FROM OLD.status THEN RETURN NEW;
END IF;
status_lower := lower(NEW.status::text);
IF status_lower NOT IN (
    'rejected',
    'cancelled',
    'cancelled_by_customer',
    'cancelled-by-customer'
) THEN RETURN NEW;
END IF;
IF EXISTS (
    SELECT 1
    FROM public.refunds r
    WHERE r.booking_id = NEW.id
        AND upper(
            coalesce(r.refund_status::text, r.status::text, '')
        ) IN (
            'PENDING',
            'PROCESSING',
            'SUCCESS',
            'PROCESSED',
            'REFUNDED',
            'COMPLETED'
        )
) THEN RETURN NEW;
END IF;
IF NOT public.has_verified_successful_payment(NEW.id) THEN RETURN NEW;
END IF;
actor_id := auth.uid();
IF actor_id IS NOT NULL THEN IF (auth.jwt()->'user_metadata'->>'role') = 'admin' THEN initiated_by := 'admin';
ELSIF actor_id = NEW.owner_id THEN initiated_by := 'owner';
ELSIF actor_id = NEW.customer_id THEN initiated_by := 'user';
END IF;
END IF;
IF status_lower = 'rejected' THEN reason := COALESCE(NEW.rejection_reason, 'Booking rejected');
reason_code := 'booking_rejected';
ELSE reason := COALESCE(NEW.rejection_reason, 'Booking cancelled');
reason_code := 'booking_cancelled';
END IF;
SELECT value INTO supabase_url
FROM public.config
WHERE key = 'supabase_url';
SELECT value INTO service_key
FROM public.config
WHERE key = 'supabase_service_role_key';
IF supabase_url IS NULL
OR service_key IS NULL THEN RAISE NOTICE 'Missing supabase_url or service key for refund automation';
RETURN NEW;
END IF;
headers := jsonb_build_object(
    'Content-Type',
    'application/json',
    'Authorization',
    'Bearer ' || service_key
);
BEGIN PERFORM net.http_post(
    url := supabase_url || '/functions/v1/cashfree-refund',
    headers := headers,
    body := jsonb_build_object(
        'bookingId',
        NEW.id,
        'reason',
        reason,
        'refundReason',
        reason_code,
        'initiatedBy',
        initiated_by
    )
);
EXCEPTION
WHEN OTHERS THEN RETURN NEW;
END;
RETURN NEW;
END;
$$;
COMMIT;
