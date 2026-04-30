BEGIN;
-- Disable automatic refund triggers. Refunds must be approved by admin in the dashboard.
DROP TRIGGER IF EXISTS bookings_refund_trigger ON bookings;
DROP TRIGGER IF EXISTS payments_refund_trigger ON payments;
COMMIT;
