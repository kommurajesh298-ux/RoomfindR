BEGIN;
CREATE OR REPLACE FUNCTION public.normalize_member_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(trim(COALESCE(p_email, ''))), '');
$$;
CREATE OR REPLACE FUNCTION public.normalize_member_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '');
$$;
CREATE OR REPLACE FUNCTION public.resolve_booking_member_identity(
  p_customer_id UUID,
  p_email TEXT,
  p_phone TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE WHEN public.normalize_member_email(p_email) IS NOT NULL THEN 'e:' || public.normalize_member_email(p_email) END,
    CASE WHEN public.normalize_member_phone(p_phone) IS NOT NULL THEN 'p:' || public.normalize_member_phone(p_phone) END,
    CASE WHEN p_customer_id IS NOT NULL THEN 'c:' || p_customer_id::TEXT END
  );
$$;
CREATE OR REPLACE FUNCTION public.enforce_single_active_booking_per_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflicting_booking_id UUID;
  v_customer_email TEXT;
  v_customer_phone TEXT;
  v_new_email TEXT;
  v_new_phone TEXT;
  v_new_member_key TEXT;
BEGIN
  IF NOT public.is_booking_active_status(
    NEW.status::TEXT,
    NEW.stay_status,
    NEW.booking_status,
    NEW.continue_status,
    NEW.vacate_date
  ) THEN
    RETURN NEW;
  END IF;

  v_new_email := public.normalize_member_email(NEW.customer_email);
  v_new_phone := public.normalize_member_phone(NEW.customer_phone);

  IF (v_new_email IS NULL OR v_new_phone IS NULL) AND NEW.customer_id IS NOT NULL THEN
    SELECT
      public.normalize_member_email(c.email),
      public.normalize_member_phone(c.phone)
    INTO v_customer_email, v_customer_phone
    FROM public.customers c
    WHERE c.id = NEW.customer_id;

    v_new_email := COALESCE(v_new_email, v_customer_email);
    v_new_phone := COALESCE(v_new_phone, v_customer_phone);
  END IF;

  v_new_member_key := public.resolve_booking_member_identity(
    NEW.customer_id,
    v_new_email,
    v_new_phone
  );

  IF v_new_member_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize booking writes per member identity to avoid race-condition duplicates.
  PERFORM pg_advisory_xact_lock(9201, hashtext(v_new_member_key));

  SELECT b.id
  INTO v_conflicting_booking_id
  FROM public.bookings b
  LEFT JOIN public.customers bc ON bc.id = b.customer_id
  WHERE b.id IS DISTINCT FROM NEW.id
    AND public.is_booking_active_status(
      b.status::TEXT,
      b.stay_status,
      b.booking_status,
      b.continue_status,
      b.vacate_date
    )
    AND public.resolve_booking_member_identity(
      b.customer_id,
      COALESCE(public.normalize_member_email(b.customer_email), public.normalize_member_email(bc.email)),
      COALESCE(public.normalize_member_phone(b.customer_phone), public.normalize_member_phone(bc.phone))
    ) = v_new_member_key
  ORDER BY
    CASE
      WHEN public.normalize_booking_state_token(b.status::TEXT) IN ('checked-in', 'active', 'ongoing', 'vacate-requested')
        OR public.normalize_booking_state_token(b.stay_status) IN ('checked-in', 'active', 'ongoing', 'vacate-requested')
      THEN 0
      WHEN public.normalize_booking_state_token(b.status::TEXT) IN ('approved', 'accepted', 'confirmed', 'paid')
        OR public.normalize_booking_state_token(b.booking_status) IN ('approved', 'accepted', 'confirmed')
      THEN 1
      ELSE 2
    END,
    COALESCE(b.check_in_date, b.start_date, (b.created_at AT TIME ZONE 'utc')::DATE) DESC,
    b.created_at DESC,
    b.id DESC
  LIMIT 1;

  IF v_conflicting_booking_id IS NOT NULL THEN
    RAISE EXCEPTION
      'ACTIVE_PG_BOOKING_EXISTS: You already have an active booking. Please vacate your current PG before booking another one.'
      USING ERRCODE = 'P0001',
        DETAIL = format('conflicting_booking_id=%s member_key=%s', v_conflicting_booking_id, v_new_member_key),
        HINT = 'One live booking is allowed per member (email/phone/customer) until vacate.';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_single_active_booking_per_customer ON public.bookings;
CREATE TRIGGER trg_enforce_single_active_booking_per_customer
BEFORE INSERT OR UPDATE OF
  customer_id,
  customer_email,
  customer_phone,
  status,
  stay_status,
  booking_status,
  continue_status,
  vacate_date,
  rent_cycle_closed_at
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_active_booking_per_customer();
WITH active_by_member AS (
  SELECT
    b.id,
    public.resolve_booking_member_identity(
      b.customer_id,
      COALESCE(public.normalize_member_email(b.customer_email), public.normalize_member_email(c.email)),
      COALESCE(public.normalize_member_phone(b.customer_phone), public.normalize_member_phone(c.phone))
    ) AS member_key,
    public.normalize_booking_state_token(b.status::TEXT) AS status_token,
    public.normalize_booking_state_token(b.stay_status) AS stay_status_token,
    public.normalize_booking_state_token(b.booking_status) AS booking_status_token,
    b.check_in_date,
    b.start_date,
    b.created_at
  FROM public.bookings b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE public.is_booking_active_status(
    b.status::TEXT,
    b.stay_status,
    b.booking_status,
    b.continue_status,
    b.vacate_date
  )
),
ranked AS (
  SELECT
    id,
    member_key,
    status_token,
    stay_status_token,
    booking_status_token,
    ROW_NUMBER() OVER (
      PARTITION BY member_key
      ORDER BY
        CASE
          WHEN status_token IN ('checked-in', 'active', 'ongoing', 'vacate-requested')
            OR stay_status_token IN ('checked-in', 'active', 'ongoing', 'vacate-requested')
          THEN 0
          WHEN status_token IN ('approved', 'accepted', 'confirmed', 'paid')
            OR booking_status_token IN ('approved', 'accepted', 'confirmed')
          THEN 1
          ELSE 2
        END,
        COALESCE(check_in_date, start_date, (created_at AT TIME ZONE 'utc')::DATE) DESC,
        created_at DESC,
        id DESC
    ) AS active_rank
  FROM active_by_member
  WHERE member_key IS NOT NULL
)
UPDATE public.bookings b
SET
  status = 'rejected',
  stay_status = 'vacated',
  booking_status = 'REJECTED',
  continue_status = 'inactive',
  vacate_date = COALESCE(b.vacate_date, CURRENT_DATE),
  rent_cycle_closed_at = COALESCE(b.rent_cycle_closed_at, timezone('utc', now())),
  next_due_date = NULL,
  portal_access = false,
  updated_at = timezone('utc', now())
FROM ranked r
WHERE b.id = r.id
  AND r.active_rank > 1;
COMMIT;
