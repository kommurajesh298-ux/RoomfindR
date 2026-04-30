BEGIN;
-- Atomic payment success handling (updates payments, bookings, rent_payments, commission_records)
CREATE OR REPLACE FUNCTION public.apply_payment_success(
    p_payment_id UUID,
    p_provider_payment_id TEXT DEFAULT NULL,
    p_verified_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_payment payments%ROWTYPE;
    v_booking bookings%ROWTYPE;
    v_status_lower TEXT;
    v_next_status TEXT;
    v_month_token TEXT;
    v_month_date DATE;
    v_month INTEGER;
    v_year INTEGER;
    v_rent_amount NUMERIC;
    v_paid_amount NUMERIC;
    v_payment_status TEXT;
    v_rent_payment_id UUID;
    v_commission_pct NUMERIC;
    v_base_amount NUMERIC;
    v_commission_amount NUMERIC;
    v_owner_amount NUMERIC;
BEGIN
    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
    END IF;

    IF lower(coalesce(v_payment.status::text, '')) IN ('refunded') THEN
        RETURN jsonb_build_object('status', 'ignored', 'reason', 'refunded');
    END IF;

    IF lower(coalesce(v_payment.status::text, '')) NOT IN ('completed','success') THEN
        UPDATE public.payments
        SET status = 'completed',
            payment_status = 'completed',
            provider_payment_id = COALESCE(p_provider_payment_id, v_payment.provider_payment_id),
            verified_at = COALESCE(p_verified_at, NOW()),
            webhook_received = TRUE,
            failure_reason = NULL
        WHERE id = v_payment.id;
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_payment.booking_id
    FOR UPDATE;

    IF FOUND THEN
        IF lower(coalesce(v_payment.payment_type, '')) = 'monthly' THEN
            UPDATE public.bookings
            SET payment_status = 'paid',
                payment_id = v_payment.id,
                next_payment_date = (
                    date_trunc('month', COALESCE(v_payment.payment_date, v_payment.created_at, NOW())) + INTERVAL '1 month'
                )
            WHERE id = v_booking.id;
        ELSE
            v_status_lower := lower(coalesce(v_booking.status::text, ''));
            IF v_status_lower IN ('accepted','approved','checked-in','checked_in','confirmed') THEN
                v_next_status := v_booking.status::text;
            ELSIF v_status_lower IN ('rejected','cancelled','refunded','checked-out','checked_out','completed') THEN
                v_next_status := v_booking.status::text;
            ELSE
                v_next_status := 'confirmed';
            END IF;

            UPDATE public.bookings
            SET status = v_next_status,
                payment_status = 'paid',
                payment_id = v_payment.id,
                amount_paid = COALESCE(v_payment.amount, 0)
            WHERE id = v_booking.id;
        END IF;
    END IF;

    IF lower(coalesce(v_payment.payment_type, '')) = 'monthly' AND FOUND THEN
        v_month_token := COALESCE(
            v_payment.metadata->'client_context'->>'month',
            v_payment.metadata->>'month',
            v_payment.metadata->>'month_token'
        );
        IF v_month_token ~ '^\d{4}-\d{2}$' THEN
            v_month_date := to_date(v_month_token || '-01', 'YYYY-MM-DD');
        ELSE
            v_month_date := COALESCE(v_payment.payment_date::date, v_payment.created_at::date, CURRENT_DATE);
        END IF;

        v_month := EXTRACT(MONTH FROM v_month_date);
        v_year := EXTRACT(YEAR FROM v_month_date);
        v_rent_amount := COALESCE(v_booking.monthly_rent, v_payment.amount, 0);
        v_paid_amount := COALESCE(v_payment.amount, 0);

        INSERT INTO public.rent_payments (
            booking_id,
            user_id,
            owner_id,
            property_id,
            room_id,
            month,
            year,
            rent_amount,
            paid_amount,
            payment_status,
            payment_id,
            paid_at
        )
        VALUES (
            v_booking.id,
            v_booking.customer_id,
            v_booking.owner_id,
            v_booking.property_id,
            v_booking.room_id,
            v_month,
            v_year,
            v_rent_amount,
            v_paid_amount,
            CASE
                WHEN v_rent_amount > 0 AND v_paid_amount >= v_rent_amount THEN 'paid'
                WHEN v_paid_amount > 0 THEN 'partial'
                ELSE 'pending'
            END,
            v_payment.id,
            CASE WHEN v_paid_amount > 0 THEN NOW() ELSE NULL END
        )
        ON CONFLICT (booking_id, year, month) DO UPDATE SET
            rent_amount = GREATEST(public.rent_payments.rent_amount, EXCLUDED.rent_amount),
            paid_amount = CASE
                WHEN public.rent_payments.payment_id = EXCLUDED.payment_id THEN public.rent_payments.paid_amount
                ELSE public.rent_payments.paid_amount + EXCLUDED.paid_amount
            END,
            payment_status = CASE
                WHEN (
                    CASE
                        WHEN public.rent_payments.payment_id = EXCLUDED.payment_id THEN public.rent_payments.paid_amount
                        ELSE public.rent_payments.paid_amount + EXCLUDED.paid_amount
                    END
                ) >= GREATEST(public.rent_payments.rent_amount, EXCLUDED.rent_amount) THEN 'paid'
                WHEN (
                    CASE
                        WHEN public.rent_payments.payment_id = EXCLUDED.payment_id THEN public.rent_payments.paid_amount
                        ELSE public.rent_payments.paid_amount + EXCLUDED.paid_amount
                    END
                ) > 0 THEN 'partial'
                ELSE 'pending'
            END,
            payment_id = EXCLUDED.payment_id,
            paid_at = CASE
                WHEN EXCLUDED.paid_amount > 0 THEN COALESCE(public.rent_payments.paid_at, EXCLUDED.paid_at)
                ELSE public.rent_payments.paid_at
            END,
            updated_at = NOW()
        RETURNING id, rent_amount, paid_amount, payment_status
        INTO v_rent_payment_id, v_rent_amount, v_paid_amount, v_payment_status;

        SELECT commission_percentage INTO v_commission_pct
        FROM public.admin_commission_settings
        ORDER BY active_from DESC
        LIMIT 1;
        v_commission_pct := COALESCE(v_commission_pct, 10);

        v_base_amount := CASE
            WHEN v_payment_status = 'partial' THEN v_paid_amount
            ELSE v_rent_amount
        END;
        v_commission_amount := ROUND((v_base_amount * v_commission_pct) / 100, 2);
        v_owner_amount := ROUND(v_base_amount - v_commission_amount, 2);

        INSERT INTO public.commission_records (
            rent_payment_id,
            rent_amount,
            commission_percentage,
            commission_amount,
            owner_amount
        )
        VALUES (
            v_rent_payment_id,
            v_base_amount,
            v_commission_pct,
            v_commission_amount,
            v_owner_amount
        )
        ON CONFLICT (rent_payment_id) DO UPDATE SET
            rent_amount = EXCLUDED.rent_amount,
            commission_percentage = EXCLUDED.commission_percentage,
            commission_amount = EXCLUDED.commission_amount,
            owner_amount = EXCLUDED.owner_amount;
    END IF;

    RETURN jsonb_build_object('status', 'ok', 'payment_id', v_payment.id);
END;
$$;
CREATE OR REPLACE FUNCTION public.apply_payment_failure(
    p_payment_id UUID,
    p_failure_reason TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_payment payments%ROWTYPE;
BEGIN
    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.payments
    SET status = 'failed',
        payment_status = 'failed',
        failure_reason = COALESCE(p_failure_reason, v_payment.failure_reason)
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET payment_status = 'failed'
    WHERE id = v_payment.booking_id;
END;
$$;
-- Manual monthly payment (idempotent, accounting-safe)
CREATE OR REPLACE FUNCTION public.record_monthly_payment(
    p_booking_id UUID,
    p_amount NUMERIC,
    p_month_token TEXT DEFAULT NULL,
    p_transaction_id TEXT DEFAULT NULL,
    p_payment_method TEXT DEFAULT 'manual',
    p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_payment_id UUID;
    v_idem TEXT;
    v_month TEXT;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT';
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    IF NOT (
        public.is_admin(auth.uid())
        OR v_booking.owner_id = auth.uid()
        OR v_booking.customer_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    v_month := NULLIF(trim(COALESCE(p_month_token, '')), '');
    IF v_month IS NULL THEN
        v_month := to_char(COALESCE(NOW(), CURRENT_DATE), 'YYYY-MM');
    END IF;

    v_idem := NULLIF(trim(COALESCE(p_transaction_id, '')), '');
    IF v_idem IS NULL THEN
        v_idem := format('manual_%s_%s_%s', p_booking_id, v_month, p_amount);
    END IF;

    BEGIN
        INSERT INTO public.payments (
            booking_id,
            customer_id,
            amount,
            status,
            payment_status,
            payment_method,
            payment_type,
            currency,
            idempotency_key,
            notes,
            payment_date
        )
        VALUES (
            v_booking.id,
            v_booking.customer_id,
            p_amount,
            'completed',
            'completed',
            p_payment_method,
            'monthly',
            v_booking.currency,
            v_idem,
            p_notes,
            NOW()
        )
        RETURNING id INTO v_payment_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT id INTO v_payment_id
            FROM public.payments
            WHERE idempotency_key = v_idem
            LIMIT 1;
    END;

    IF v_payment_id IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_NOT_CREATED';
    END IF;

    PERFORM public.apply_payment_success(v_payment_id, NULL, NOW());

    RETURN v_payment_id;
END;
$$;
-- Admin refund preparation (locks rows, idempotent)
CREATE OR REPLACE FUNCTION public.admin_prepare_refund(
    p_booking_id UUID DEFAULT NULL,
    p_payment_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT 'Refund initiated',
    p_refund_reason TEXT DEFAULT NULL,
    p_initiated_by TEXT DEFAULT 'admin',
    p_refund_amount NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_payment payments%ROWTYPE;
    v_existing refunds%ROWTYPE;
    v_refund_amount NUMERIC;
    v_refund_id TEXT;
    v_fixed_fee NUMERIC;
    v_reason_code TEXT;
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    IF p_booking_id IS NULL AND p_payment_id IS NULL THEN
        RAISE EXCEPTION 'bookingId or paymentId is required';
    END IF;

    IF p_payment_id IS NOT NULL THEN
        SELECT * INTO v_payment
        FROM public.payments
        WHERE id = p_payment_id
        FOR UPDATE;
    ELSE
        SELECT * INTO v_payment
        FROM public.payments
        WHERE booking_id = p_booking_id
          AND status IN ('completed','success','authorized')
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
    END IF;

    IF p_booking_id IS NOT NULL THEN
        SELECT * INTO v_booking
        FROM public.bookings
        WHERE id = p_booking_id
        FOR UPDATE;
    ELSE
        SELECT * INTO v_booking
        FROM public.bookings
        WHERE id = v_payment.booking_id
        FOR UPDATE;
    END IF;

    SELECT * INTO v_existing
    FROM public.refunds
    WHERE payment_id = v_payment.id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND upper(coalesce(v_existing.status::text, '')) <> 'FAILED' THEN
        RETURN jsonb_build_object(
            'refund', row_to_json(v_existing),
            'payment', row_to_json(v_payment),
            'booking', row_to_json(v_booking),
            'already_exists', true
        );
    END IF;

    v_refund_amount := COALESCE(p_refund_amount, v_payment.amount);
    IF v_refund_amount IS NULL OR v_refund_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount for refund';
    END IF;
    IF v_refund_amount > v_payment.amount THEN
        RAISE EXCEPTION 'Refund amount exceeds paid amount';
    END IF;

    v_reason_code := lower(COALESCE(p_refund_reason, ''));
    IF v_reason_code NOT IN ('duplicate_payment','partial_payment','payment_failed','booking_failed','auto_refund') THEN
        SELECT value::numeric INTO v_fixed_fee
        FROM public.config
        WHERE key = 'fixed_platform_fee';
        v_refund_amount := v_refund_amount - COALESCE(v_fixed_fee, 0);
    END IF;

    v_refund_amount := ROUND(v_refund_amount::numeric, 2);
    IF v_refund_amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount is zero or negative';
    END IF;

    v_refund_id := COALESCE(v_existing.refund_id, 'refund_' || v_payment.id::text);

    IF v_existing.id IS NULL THEN
        INSERT INTO public.refunds (
            payment_id,
            booking_id,
            customer_id,
            refund_amount,
            reason,
            refund_reason,
            status,
            refund_status,
            refund_id,
            initiated_by,
            provider,
            processed_at
        )
        VALUES (
            v_payment.id,
            v_payment.booking_id,
            v_payment.customer_id,
            v_refund_amount,
            p_reason,
            p_refund_reason,
            'PROCESSING',
            'PROCESSING',
            v_refund_id,
            p_initiated_by,
            'cashfree',
            NULL
        )
        RETURNING * INTO v_existing;
    ELSE
        UPDATE public.refunds
        SET status = 'PROCESSING',
            refund_status = 'PROCESSING',
            processed_at = NULL
        WHERE id = v_existing.id
        RETURNING * INTO v_existing;
    END IF;

    RETURN jsonb_build_object(
        'refund', row_to_json(v_existing),
        'payment', row_to_json(v_payment),
        'booking', row_to_json(v_booking),
        'refund_amount', v_refund_amount
    );
END;
$$;
-- Settlement concurrency + wallet atomic updates
CREATE OR REPLACE FUNCTION public.reserve_settlement_for_payout(
    p_settlement_id UUID,
    p_transfer_id TEXT,
    p_reference TEXT DEFAULT NULL
) RETURNS public.settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_settlement public.settlements%ROWTYPE;
BEGIN
    UPDATE public.settlements
    SET status = 'PROCESSING',
        provider = 'cashfree',
        provider_transfer_id = p_transfer_id,
        provider_reference = COALESCE(p_reference, provider_reference),
        processed_at = NULL
    WHERE id = p_settlement_id
      AND status = 'PENDING'
    RETURNING * INTO v_settlement;

    RETURN v_settlement;
END;
$$;
CREATE OR REPLACE FUNCTION public.ensure_wallet_transaction(
    p_wallet_id UUID,
    p_settlement_id UUID,
    p_amount NUMERIC,
    p_reference TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.wallet_transactions WHERE settlement_id = p_settlement_id
    ) INTO v_exists;

    IF v_exists THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.wallet_transactions (
        wallet_id,
        settlement_id,
        amount,
        type,
        status,
        reference
    )
    VALUES (
        p_wallet_id,
        p_settlement_id,
        p_amount,
        'credit',
        'pending',
        p_reference
    );

    UPDATE public.wallets
    SET pending_balance = pending_balance + p_amount
    WHERE id = p_wallet_id;

    RETURN TRUE;
END;
$$;
CREATE OR REPLACE FUNCTION public.apply_settlement_success(
    p_settlement_id UUID,
    p_amount NUMERIC,
    p_reference TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_owner_id UUID;
    v_wallet_id UUID;
BEGIN
    SELECT owner_id INTO v_owner_id
    FROM public.settlements
    WHERE id = p_settlement_id;

    UPDATE public.settlements
    SET status = 'COMPLETED',
        processed_at = NOW(),
        provider_reference = COALESCE(p_reference, provider_reference)
    WHERE id = p_settlement_id;

    UPDATE public.wallet_transactions
    SET status = 'completed'
    WHERE settlement_id = p_settlement_id
      AND status <> 'completed';

    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE owner_id = v_owner_id;

    IF v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET pending_balance = GREATEST(0, pending_balance - p_amount),
            available_balance = available_balance + p_amount
        WHERE id = v_wallet_id;
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.apply_settlement_failure(
    p_settlement_id UUID,
    p_amount NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_owner_id UUID;
    v_wallet_id UUID;
BEGIN
    SELECT owner_id INTO v_owner_id
    FROM public.settlements
    WHERE id = p_settlement_id;

    UPDATE public.settlements
    SET status = 'FAILED'
    WHERE id = p_settlement_id;

    UPDATE public.wallet_transactions
    SET status = 'failed'
    WHERE settlement_id = p_settlement_id
      AND status <> 'failed';

    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE owner_id = v_owner_id;

    IF v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET pending_balance = GREATEST(0, pending_balance - p_amount)
        WHERE id = v_wallet_id;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_payment_success(UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_failure(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_monthly_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_prepare_refund(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_settlement_for_payout(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_wallet_transaction(UUID, UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_success(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC) TO service_role;
COMMIT;
