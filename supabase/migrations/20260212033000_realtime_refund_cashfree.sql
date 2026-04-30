BEGIN;
ALTER TABLE public.refunds
    ADD COLUMN IF NOT EXISTS refund_transaction_id TEXT,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;
UPDATE public.refunds
SET refund_transaction_id = COALESCE(refund_transaction_id, provider_refund_id, refund_id)
WHERE refund_transaction_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_refund_status ON public.refunds(refund_status);
CREATE INDEX IF NOT EXISTS idx_refunds_refund_transaction_id ON public.refunds(refund_transaction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_approved_by ON public.refunds(approved_by);
CREATE TABLE IF NOT EXISTS public.transaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL DEFAULT 'settlement',
    entity_id UUID,
    settlement_id UUID REFERENCES public.settlements(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    status TEXT,
    transaction_id TEXT,
    message TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.transaction_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_transaction_logs_all ON public.transaction_logs;
CREATE POLICY admin_transaction_logs_all
ON public.transaction_logs
FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS owner_transaction_logs_select ON public.transaction_logs;
CREATE POLICY owner_transaction_logs_select
ON public.transaction_logs
FOR SELECT
USING (owner_id = auth.uid());
ALTER TABLE IF EXISTS public.transaction_logs
    ADD COLUMN IF NOT EXISTS refund_id UUID REFERENCES public.refunds(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_transaction_logs_refund_id ON public.transaction_logs(refund_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_settlement_id ON public.transaction_logs(settlement_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_owner_id ON public.transaction_logs(owner_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_created_at ON public.transaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_event_type ON public.transaction_logs(event_type);
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
    v_booking_status TEXT;
    v_payment_status TEXT;
    v_existing_status TEXT;
    v_allow_non_terminal_booking BOOLEAN;
BEGIN
    IF auth.role() <> 'service_role' AND NOT public.is_admin(auth.uid()) THEN
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
          AND lower(coalesce(status::text, payment_status::text, '')) IN ('completed', 'success', 'authorized', 'paid')
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;

    v_payment_status := lower(coalesce(v_payment.status::text, v_payment.payment_status::text, ''));
    IF v_payment_status NOT IN ('completed', 'success', 'authorized', 'paid') THEN
        IF v_payment_status = 'refunded' THEN
            RAISE EXCEPTION 'REFUND_ALREADY_PROCESSED';
        END IF;
        RAISE EXCEPTION 'PAYMENT_NOT_ELIGIBLE_FOR_REFUND';
    END IF;

    v_reason_code := lower(coalesce(p_refund_reason, ''));
    v_booking_status := lower(coalesce(v_booking.status::text, ''));
    v_allow_non_terminal_booking := v_reason_code IN ('duplicate_payment', 'partial_payment', 'payment_failed', 'booking_failed', 'auto_refund');

    IF NOT v_allow_non_terminal_booking
        AND v_booking_status NOT IN ('rejected', 'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'refunded') THEN
        RAISE EXCEPTION 'BOOKING_NOT_ELIGIBLE_FOR_REFUND';
    END IF;

    SELECT * INTO v_existing
    FROM public.refunds
    WHERE payment_id = v_payment.id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        v_existing_status := upper(coalesce(v_existing.refund_status::text, v_existing.status::text, ''));
        IF v_existing_status IN ('SUCCESS', 'PROCESSED', 'REFUNDED', 'COMPLETED') THEN
            RAISE EXCEPTION 'REFUND_ALREADY_PROCESSED';
        END IF;

        IF v_existing_status IN ('PENDING', 'PROCESSING') THEN
            RETURN jsonb_build_object(
                'refund', row_to_json(v_existing),
                'payment', row_to_json(v_payment),
                'booking', row_to_json(v_booking),
                'already_exists', true,
                'already_processing', true
            );
        END IF;
    END IF;

    v_refund_amount := COALESCE(p_refund_amount, v_existing.refund_amount, v_payment.amount);
    IF v_refund_amount IS NULL OR v_refund_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
    END IF;
    IF v_payment.amount IS NOT NULL AND v_refund_amount > v_payment.amount THEN
        RAISE EXCEPTION 'REFUND_AMOUNT_EXCEEDS_PAYMENT';
    END IF;

    IF v_reason_code NOT IN ('duplicate_payment', 'partial_payment', 'payment_failed', 'booking_failed', 'auto_refund') THEN
        SELECT value::numeric INTO v_fixed_fee
        FROM public.config
        WHERE key = 'fixed_platform_fee';

        v_refund_amount := v_refund_amount - COALESCE(v_fixed_fee, 0);
    END IF;

    v_refund_amount := ROUND(v_refund_amount::numeric, 2);
    IF v_refund_amount <= 0 THEN
        RAISE EXCEPTION 'REFUND_AMOUNT_ZERO_OR_NEGATIVE';
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
            processed_at,
            approved_by,
            approved_at,
            failure_reason,
            refund_transaction_id
        )
        VALUES (
            v_payment.id,
            v_payment.booking_id,
            v_payment.customer_id,
            v_refund_amount,
            p_reason,
            p_refund_reason,
            'PENDING',
            'PENDING',
            v_refund_id,
            p_initiated_by,
            'cashfree',
            NULL,
            auth.uid(),
            NOW(),
            NULL,
            NULL
        )
        RETURNING * INTO v_existing;
    ELSE
        UPDATE public.refunds
        SET refund_amount = v_refund_amount,
            reason = COALESCE(p_reason, reason),
            refund_reason = COALESCE(p_refund_reason, refund_reason),
            status = 'PENDING',
            refund_status = 'PENDING',
            initiated_by = COALESCE(p_initiated_by, initiated_by),
            approved_by = COALESCE(auth.uid(), approved_by),
            approved_at = NOW(),
            failure_reason = NULL,
            processed_at = NULL
        WHERE id = v_existing.id
        RETURNING * INTO v_existing;
    END IF;

    INSERT INTO public.transaction_logs (
        entity_type,
        entity_id,
        refund_id,
        owner_id,
        event_type,
        status,
        message,
        payload,
        created_by
    ) VALUES (
        'refund',
        v_existing.id,
        v_existing.id,
        v_booking.owner_id,
        'refund_approval_requested',
        'PENDING',
        'Admin approved refund request',
        jsonb_build_object(
            'booking_id', v_booking.id,
            'payment_id', v_payment.id,
            'refund_id', v_existing.id,
            'refund_amount', v_refund_amount,
            'refund_reason', p_refund_reason
        ),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'refund', row_to_json(v_existing),
        'payment', row_to_json(v_payment),
        'booking', row_to_json(v_booking),
        'refund_amount', v_refund_amount
    );
END;
$$;
CREATE OR REPLACE FUNCTION public.reserve_refund_for_processing(
    p_refund_id UUID
) RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_refund public.refunds%ROWTYPE;
BEGIN
    UPDATE public.refunds
    SET status = 'PROCESSING',
        refund_status = 'PROCESSING',
        failure_reason = NULL
    WHERE id = p_refund_id
      AND upper(coalesce(refund_status::text, status::text, '')) IN ('PENDING', 'FAILED')
    RETURNING * INTO v_refund;

    RETURN v_refund;
END;
$$;
CREATE OR REPLACE FUNCTION public.apply_refund_success(
    p_refund_id UUID,
    p_provider_refund_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_refund public.refunds%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_booking public.bookings%ROWTYPE;
    v_settlement public.settlements%ROWTYPE;
    v_wallet public.wallets%ROWTYPE;
    v_rent_payment public.rent_payments%ROWTYPE;
    v_refund_amount NUMERIC;
    v_reason_code TEXT;
    v_other_paid BOOLEAN := FALSE;
    v_owner_deduction NUMERIC := 0;
    v_existing_debit BOOLEAN := FALSE;
    v_next_paid NUMERIC := 0;
    v_next_status TEXT := 'pending';
    v_commission_pct NUMERIC;
    v_base_amount NUMERIC := 0;
    v_commission_amount NUMERIC := 0;
    v_owner_amount NUMERIC := 0;
    v_has_settlement BOOLEAN := FALSE;
    v_has_booking_status_column BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_refund
    FROM public.refunds
    WHERE id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REFUND_NOT_FOUND';
    END IF;

    IF upper(coalesce(v_refund.refund_status::text, v_refund.status::text, '')) IN ('SUCCESS', 'PROCESSED', 'REFUNDED', 'COMPLETED') THEN
        RETURN jsonb_build_object(
            'refund_id', v_refund.id,
            'status', 'SUCCESS',
            'already_applied', true
        );
    END IF;

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = v_refund.payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND_FOR_REFUND';
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = COALESCE(v_refund.booking_id, v_payment.booking_id)
    FOR UPDATE;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name = 'booking_status'
    ) INTO v_has_booking_status_column;

    v_refund_amount := ROUND(COALESCE(v_refund.refund_amount, 0)::numeric, 2);
    IF v_refund_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
    END IF;

    UPDATE public.refunds
    SET status = 'SUCCESS',
        refund_status = 'SUCCESS',
        provider_refund_id = COALESCE(p_provider_refund_id, provider_refund_id),
        refund_transaction_id = COALESCE(p_provider_refund_id, refund_transaction_id, provider_refund_id, refund_id),
        processed_at = COALESCE(processed_at, NOW()),
        failure_reason = NULL
    WHERE id = v_refund.id
    RETURNING * INTO v_refund;

    UPDATE public.payments
    SET status = 'refunded',
        payment_status = 'refunded',
        failure_reason = NULL
    WHERE id = v_payment.id;

    IF v_booking.id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.payments p
            WHERE p.booking_id = v_booking.id
              AND p.id <> v_payment.id
              AND lower(coalesce(p.status::text, p.payment_status::text, '')) IN ('completed', 'success', 'authorized', 'paid')
        ) INTO v_other_paid;

        v_reason_code := lower(coalesce(v_refund.refund_reason, v_refund.reason, ''));

        IF NOT v_other_paid
            AND (
                lower(coalesce(v_booking.status::text, '')) IN ('rejected', 'cancelled', 'cancelled_by_customer', 'cancelled-by-customer', 'refunded')
                OR v_reason_code IN ('booking_failed', 'payment_failed')
            )
            AND v_reason_code NOT IN ('duplicate_payment', 'partial_payment', 'auto_refund') THEN
            IF v_has_booking_status_column THEN
                UPDATE public.bookings
                SET status = 'refunded',
                    payment_status = 'refunded',
                    booking_status = 'COMPLETED'
                WHERE id = v_booking.id;
            ELSE
                UPDATE public.bookings
                SET status = 'refunded',
                    payment_status = 'refunded'
                WHERE id = v_booking.id;
            END IF;
        ELSE
            UPDATE public.bookings
            SET payment_status = 'refunded'
            WHERE id = v_booking.id;
        END IF;
    END IF;

    SELECT * INTO v_rent_payment
    FROM public.rent_payments
    WHERE payment_id = v_payment.id
    FOR UPDATE;

    IF FOUND THEN
        v_next_paid := GREATEST(0, ROUND((COALESCE(v_rent_payment.paid_amount, 0) - v_refund_amount)::numeric, 2));
        v_next_status := CASE
            WHEN COALESCE(v_rent_payment.rent_amount, 0) > 0 AND v_next_paid >= COALESCE(v_rent_payment.rent_amount, 0) THEN 'paid'
            WHEN v_next_paid > 0 THEN 'partial'
            ELSE 'pending'
        END;

        UPDATE public.rent_payments
        SET paid_amount = v_next_paid,
            payment_status = v_next_status,
            paid_at = CASE WHEN v_next_paid > 0 THEN COALESCE(paid_at, NOW()) ELSE NULL END,
            updated_at = NOW()
        WHERE id = v_rent_payment.id
        RETURNING * INTO v_rent_payment;

        SELECT commission_percentage
        INTO v_commission_pct
        FROM public.commission_records
        WHERE rent_payment_id = v_rent_payment.id;

        IF v_commission_pct IS NULL THEN
            SELECT commission_percentage
            INTO v_commission_pct
            FROM public.admin_commission_settings
            ORDER BY active_from DESC
            LIMIT 1;
        END IF;

        v_commission_pct := COALESCE(v_commission_pct, 10);
        v_base_amount := CASE
            WHEN v_next_status = 'partial' THEN v_next_paid
            WHEN v_next_status = 'paid' THEN COALESCE(v_rent_payment.rent_amount, v_next_paid)
            ELSE v_next_paid
        END;

        v_commission_amount := ROUND((v_base_amount * v_commission_pct) / 100, 2);
        v_owner_amount := ROUND(v_base_amount - v_commission_amount, 2);

        INSERT INTO public.commission_records (
            rent_payment_id,
            rent_amount,
            commission_percentage,
            commission_amount,
            owner_amount
        ) VALUES (
            v_rent_payment.id,
            v_base_amount,
            v_commission_pct,
            v_commission_amount,
            v_owner_amount
        )
        ON CONFLICT (rent_payment_id)
        DO UPDATE SET
            rent_amount = EXCLUDED.rent_amount,
            commission_percentage = EXCLUDED.commission_percentage,
            commission_amount = EXCLUDED.commission_amount,
            owner_amount = EXCLUDED.owner_amount;
    END IF;

    SELECT * INTO v_settlement
    FROM public.settlements
    WHERE booking_id = COALESCE(v_refund.booking_id, v_payment.booking_id)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        v_has_settlement := TRUE;
        v_owner_deduction := LEAST(
            v_refund_amount,
            GREATEST(0, COALESCE(v_settlement.net_payable, 0) - COALESCE(v_settlement.refunded_amount, 0))
        );

        UPDATE public.settlements
        SET refunded_amount = ROUND((COALESCE(refunded_amount, 0) + v_owner_deduction)::numeric, 2),
            updated_at = NOW()
        WHERE id = v_settlement.id;

        IF upper(coalesce(v_settlement.payout_status, v_settlement.status::text, '')) IN ('SUCCESS', 'COMPLETED')
            AND v_owner_deduction > 0 THEN
            SELECT * INTO v_wallet
            FROM public.wallets
            WHERE owner_id = v_settlement.owner_id
            FOR UPDATE;

            IF NOT FOUND THEN
                INSERT INTO public.wallets (
                    owner_id,
                    available_balance,
                    pending_balance,
                    currency,
                    status
                ) VALUES (
                    v_settlement.owner_id,
                    0,
                    0,
                    'INR',
                    'active'
                ) RETURNING * INTO v_wallet;
            END IF;

            SELECT EXISTS (
                SELECT 1
                FROM public.wallet_transactions wt
                WHERE wt.payment_id = v_payment.id
                  AND wt.type = 'debit'
                  AND wt.reference = ('refund_' || v_refund.id::text)
            ) INTO v_existing_debit;

            IF NOT v_existing_debit THEN
                UPDATE public.wallets
                SET available_balance = COALESCE(available_balance, 0) - v_owner_deduction
                WHERE id = v_wallet.id;

                INSERT INTO public.wallet_transactions (
                    wallet_id,
                    settlement_id,
                    payment_id,
                    amount,
                    currency,
                    type,
                    status,
                    reference
                ) VALUES (
                    v_wallet.id,
                    v_settlement.id,
                    v_payment.id,
                    v_owner_deduction,
                    COALESCE(v_wallet.currency, 'INR'),
                    'debit',
                    'completed',
                    'refund_' || v_refund.id::text
                );
            END IF;
        END IF;
    END IF;

    IF v_refund.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            user_id,
            title,
            message,
            notification_type,
            status,
            data
        ) VALUES (
            v_refund.customer_id,
            'Refund Completed',
            'Your refund has been processed successfully.',
            'refund_completed',
            'queued',
            jsonb_build_object('booking_id', v_refund.booking_id, 'refund_id', v_refund.id)
        );
    END IF;

    IF v_has_settlement AND v_settlement.owner_id IS NOT NULL AND v_owner_deduction > 0 THEN
        INSERT INTO public.notifications (
            user_id,
            title,
            message,
            notification_type,
            status,
            data
        ) VALUES (
            v_settlement.owner_id,
            'Refund Adjustment',
            'Owner earnings were adjusted after customer refund.',
            'settlement_completed',
            'queued',
            jsonb_build_object(
                'booking_id', v_refund.booking_id,
                'refund_id', v_refund.id,
                'deducted_amount', v_owner_deduction
            )
        );
    END IF;

    INSERT INTO public.transaction_logs (
        entity_type,
        entity_id,
        settlement_id,
        refund_id,
        owner_id,
        event_type,
        status,
        transaction_id,
        message,
        payload,
        created_by
    ) VALUES (
        'refund',
        v_refund.id,
        v_settlement.id,
        v_refund.id,
        COALESCE(v_settlement.owner_id, v_booking.owner_id),
        'refund_completed',
        'SUCCESS',
        COALESCE(v_refund.refund_transaction_id, v_refund.provider_refund_id, v_refund.refund_id),
        'Refund completed and accounting adjusted',
        jsonb_build_object(
            'booking_id', v_refund.booking_id,
            'payment_id', v_payment.id,
            'refund_id', v_refund.id,
            'refund_amount', v_refund_amount,
            'owner_deduction', v_owner_deduction,
            'commission_amount', v_commission_amount
        ),
        COALESCE(v_refund.approved_by, auth.uid())
    );

    RETURN jsonb_build_object(
        'refund_id', v_refund.id,
        'status', 'SUCCESS',
        'owner_deduction', v_owner_deduction,
        'transaction_id', COALESCE(v_refund.refund_transaction_id, v_refund.provider_refund_id, v_refund.refund_id)
    );
END;
$$;
CREATE OR REPLACE FUNCTION public.apply_refund_failure(
    p_refund_id UUID,
    p_failure_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_refund public.refunds%ROWTYPE;
BEGIN
    SELECT * INTO v_refund
    FROM public.refunds
    WHERE id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REFUND_NOT_FOUND';
    END IF;

    IF upper(coalesce(v_refund.refund_status::text, v_refund.status::text, '')) IN ('SUCCESS', 'PROCESSED', 'REFUNDED', 'COMPLETED') THEN
        RETURN jsonb_build_object(
            'refund_id', v_refund.id,
            'status', 'SUCCESS',
            'already_applied', true
        );
    END IF;

    UPDATE public.refunds
    SET status = 'FAILED',
        refund_status = 'FAILED',
        failure_reason = COALESCE(p_failure_reason, failure_reason, 'Refund failed'),
        processed_at = NOW()
    WHERE id = v_refund.id
    RETURNING * INTO v_refund;

    INSERT INTO public.transaction_logs (
        entity_type,
        entity_id,
        refund_id,
        event_type,
        status,
        transaction_id,
        message,
        payload,
        created_by
    ) VALUES (
        'refund',
        v_refund.id,
        v_refund.id,
        'refund_failed',
        'FAILED',
        COALESCE(v_refund.refund_transaction_id, v_refund.provider_refund_id, v_refund.refund_id),
        COALESCE(p_failure_reason, 'Refund failed'),
        jsonb_build_object(
            'booking_id', v_refund.booking_id,
            'payment_id', v_refund.payment_id,
            'refund_id', v_refund.id,
            'refund_amount', v_refund.refund_amount,
            'failure_reason', COALESCE(p_failure_reason, 'Refund failed')
        ),
        COALESCE(v_refund.approved_by, auth.uid())
    );

    RETURN jsonb_build_object(
        'refund_id', v_refund.id,
        'status', 'FAILED',
        'failure_reason', v_refund.failure_reason
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_prepare_refund(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_refund_for_processing(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_refund_success(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_refund_failure(UUID, TEXT) TO service_role;
COMMIT;
