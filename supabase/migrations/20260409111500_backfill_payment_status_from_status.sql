BEGIN;

UPDATE public.payments
SET payment_status = lower(COALESCE(status::text, payment_status, 'pending'))
WHERE payment_status IS NULL
   OR lower(COALESCE(payment_status, '')) IS DISTINCT FROM lower(COALESCE(status::text, payment_status, 'pending'));

COMMIT;
