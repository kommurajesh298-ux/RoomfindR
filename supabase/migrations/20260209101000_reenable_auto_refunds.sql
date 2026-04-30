BEGIN;
-- Deprecated: refunds are admin-only. Ensure auto-refund triggers stay disabled.
DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings;
DROP TRIGGER IF EXISTS payments_refund_trigger ON payments;
COMMIT;
