-- Fix checkout failures caused by trigger insert permission on payment_attempt_history sequence

GRANT USAGE, SELECT ON SEQUENCE public.payment_attempt_history_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payment_attempt_history_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_attempt_history_id_seq TO anon;
