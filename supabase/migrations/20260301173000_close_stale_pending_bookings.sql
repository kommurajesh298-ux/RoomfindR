BEGIN;
DO $$
DECLARE
  has_check_in_date BOOLEAN;
  has_payment_status BOOLEAN;
  has_booking_status BOOLEAN;
  has_continue_status BOOLEAN;
  has_rejection_reason BOOLEAN;
  has_cancelled_at BOOLEAN;
  has_orders_table BOOLEAN;
  has_orders_status BOOLEAN;
  has_orders_metadata BOOLEAN;
  has_orders_created_at BOOLEAN;
  sql_stmt TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'check_in_date'
  ) INTO has_check_in_date;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'payment_status'
  ) INTO has_payment_status;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'booking_status'
  ) INTO has_booking_status;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'continue_status'
  ) INTO has_continue_status;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'rejection_reason'
  ) INTO has_rejection_reason;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'cancelled_at'
  ) INTO has_cancelled_at;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'orders'
  ) INTO has_orders_table;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'status'
  ) INTO has_orders_status;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'metadata'
  ) INTO has_orders_metadata;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'created_at'
  ) INTO has_orders_created_at;

  sql_stmt := 'WITH candidate_bookings AS ('
    || ' SELECT b.id'
    || ' FROM public.bookings b';

  IF has_orders_table AND has_orders_status AND has_orders_metadata AND has_orders_created_at THEN
    sql_stmt := sql_stmt
      || ' LEFT JOIN LATERAL ('
      || '   SELECT lower(coalesce(o.status, '''')) AS order_status'
      || '   FROM public.orders o'
      || '   WHERE (o.metadata ->> ''booking_id'') = b.id::text'
      || '      OR (o.metadata ->> ''bookingId'') = b.id::text'
      || '   ORDER BY o.created_at DESC'
      || '   LIMIT 1'
      || ' ) AS latest_order ON TRUE';
  END IF;

  sql_stmt := sql_stmt
    || ' WHERE b.vacate_date IS NULL'
    || '   AND lower(coalesce(b.status::text, '''')) IN (''requested'', ''pending'', ''payment_pending'', ''charge_pending'')';

  IF has_check_in_date THEN
    sql_stmt := sql_stmt || ' AND b.check_in_date IS NULL';
  END IF;

  IF has_payment_status THEN
    sql_stmt := sql_stmt || ' AND lower(coalesce(b.payment_status::text, '''')) <> ''paid''';
  END IF;

  IF has_orders_table AND has_orders_status AND has_orders_metadata AND has_orders_created_at THEN
    sql_stmt := sql_stmt
      || ' AND (latest_order.order_status = ''cancelled'''
      || '      OR b.created_at < timezone(''utc'', now()) - interval ''45 minutes'')';
  ELSE
    sql_stmt := sql_stmt
      || ' AND b.created_at < timezone(''utc'', now()) - interval ''45 minutes''';
  END IF;

  sql_stmt := sql_stmt
    || '), updated AS ('
    || ' UPDATE public.bookings b'
    || ' SET status = ''cancelled''';

  IF has_payment_status THEN
    sql_stmt := sql_stmt || ', payment_status = ''failed''';
  END IF;

  IF has_booking_status THEN
    sql_stmt := sql_stmt || ', booking_status = ''CANCELLED''';
  END IF;

  IF has_continue_status THEN
    sql_stmt := sql_stmt || ', continue_status = ''cancelled''';
  END IF;

  IF has_rejection_reason THEN
    sql_stmt := sql_stmt
      || ', rejection_reason = COALESCE(NULLIF(b.rejection_reason, ''''), ''Auto-cancelled: stale or cancelled checkout.'')';
  END IF;

  IF has_cancelled_at THEN
    sql_stmt := sql_stmt
      || ', cancelled_at = COALESCE(b.cancelled_at, timezone(''utc'', now()))';
  END IF;

  sql_stmt := sql_stmt
    || ', updated_at = timezone(''utc'', now())'
    || ' FROM candidate_bookings c'
    || ' WHERE b.id = c.id'
    || ' RETURNING b.id'
    || ')'
    || ' SELECT count(*) AS cancelled_rows FROM updated';

  EXECUTE sql_stmt;
END
$$;
COMMIT;
