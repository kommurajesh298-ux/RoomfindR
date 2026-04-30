BEGIN;
-- Keep a single RPC signature for apply_settlement_failure to avoid
-- PostgREST overload ambiguity during edge-function calls.
DROP FUNCTION IF EXISTS public.apply_settlement_failure(UUID, NUMERIC);
GRANT EXECUTE ON FUNCTION public.apply_settlement_failure(UUID, NUMERIC, TEXT) TO service_role;
COMMIT;
