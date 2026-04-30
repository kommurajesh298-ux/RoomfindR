ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS daily_rent NUMERIC(10, 2);
UPDATE public.properties
SET daily_rent = ROUND((monthly_rent / 30.0)::numeric, 2)
WHERE daily_rent IS NULL
  AND monthly_rent IS NOT NULL;
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oidvectortypes(proargtypes) AS args
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'extend_booking_stay'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.extend_booking_stay(%s)', r.args);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.extend_booking_stay(
    p_booking_id UUID,
    p_add_months INTEGER DEFAULT NULL,
    p_payment_type TEXT DEFAULT NULL,
    p_add_days INTEGER DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_valid DATE;
    v_start DATE;
    v_selected_months INTEGER;
    v_selected_days INTEGER;
    v_stay_type TEXT;
    v_total_rent NUMERIC;
    v_monthly_rent NUMERIC;
    v_effective_day_rent NUMERIC;
    v_add_days INTEGER;
    v_add_months INTEGER;
BEGIN
    SELECT valid_till, start_date, selected_months, selected_days, stay_type, total_rent, monthly_rent
    INTO v_current_valid, v_start, v_selected_months, v_selected_days, v_stay_type, v_total_rent, v_monthly_rent
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF v_start IS NULL THEN
        RETURN;
    END IF;

    v_current_valid := COALESCE(v_current_valid, v_start);

    IF lower(COALESCE(v_stay_type, 'monthly')) = 'days' OR COALESCE(p_add_days, 0) > 0 THEN
        v_add_days := GREATEST(1, COALESCE(p_add_days, p_add_months, 1));
        v_effective_day_rent := COALESCE(
            CASE
                WHEN COALESCE(v_selected_days, 0) > 0 AND COALESCE(v_total_rent, 0) > 0
                    THEN ROUND((v_total_rent / v_selected_days)::numeric, 2)
                ELSE NULL
            END,
            CASE
                WHEN COALESCE(v_monthly_rent, 0) > 0
                    THEN ROUND((v_monthly_rent / 30.0)::numeric, 2)
                ELSE NULL
            END,
            0
        );

        UPDATE public.bookings
        SET stay_type = 'days',
            selected_days = COALESCE(v_selected_days, 0) + v_add_days,
            selected_months = GREATEST(1, CEIL((COALESCE(v_selected_days, 0) + v_add_days)::numeric / 30.0)::INTEGER),
            valid_till = (v_current_valid + (v_add_days || ' days')::interval)::date,
            total_rent = COALESCE(v_total_rent, 0) + ROUND((v_effective_day_rent * v_add_days)::numeric, 2),
            payment_type = COALESCE(p_payment_type, payment_type, 'full'),
            portal_access = true,
            booking_status = 'ACTIVE',
            continue_status = 'continued',
            extension_count = COALESCE(extension_count, 0) + 1,
            updated_at = NOW()
        WHERE id = p_booking_id;
    ELSE
        v_add_months := GREATEST(1, COALESCE(p_add_months, 1));

        UPDATE public.bookings
        SET selected_months = COALESCE(v_selected_months, 0) + v_add_months,
            valid_till = (v_current_valid + (v_add_months || ' months')::interval)::date,
            total_rent = COALESCE(monthly_rent, 0) * (COALESCE(v_selected_months, 0) + v_add_months),
            payment_type = COALESCE(p_payment_type, payment_type),
            portal_access = true,
            booking_status = 'ACTIVE',
            continue_status = 'continued',
            extension_count = COALESCE(extension_count, 0) + 1,
            updated_at = NOW()
        WHERE id = p_booking_id;
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.exit_booking_stay(
    p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay_type TEXT;
BEGIN
  SELECT lower(COALESCE(stay_type, ''))
  INTO v_stay_type
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_stay_type = 'days' THEN
    UPDATE public.bookings
    SET status = 'checked-out',
        stay_status = 'vacated',
        vacate_date = CURRENT_DATE,
        booking_status = 'COMPLETED',
        continue_status = 'exit_completed',
        portal_access = false,
        updated_at = NOW()
    WHERE id = p_booking_id;
  ELSE
    UPDATE public.bookings
    SET booking_status = 'ENDING',
        continue_status = 'exit_requested',
        stay_status = 'vacate_requested',
        portal_access = true,
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.extend_booking_stay(UUID, INTEGER, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exit_booking_stay(UUID) TO authenticated, service_role;
