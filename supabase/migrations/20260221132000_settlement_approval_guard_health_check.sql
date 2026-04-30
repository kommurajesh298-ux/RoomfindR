BEGIN;
-- Monitoring view:
-- Any row here is a guard violation because payout moved forward without admin approval.
CREATE OR REPLACE VIEW public.v_settlement_approval_guard_violations AS
SELECT
    s.id,
    s.booking_id,
    s.owner_id,
    s.status,
    s.payout_status,
    s.provider_transfer_id,
    s.provider_reference,
    s.approved_at,
    s.approved_by,
    s.created_at,
    s.updated_at
FROM public.settlements AS s
WHERE s.approved_at IS NULL
  AND (
    upper(coalesce(s.payout_status::text, '')) IN ('PROCESSING', 'SUCCESS', 'COMPLETED')
    OR upper(coalesce(s.status::text, '')) IN ('PROCESSING', 'COMPLETED')
    OR nullif(trim(coalesce(s.provider_transfer_id, '')), '') IS NOT NULL
    OR nullif(trim(coalesce(s.provider_reference, '')), '') IS NOT NULL
  );
-- Fast count for dashboard/cron checks.
CREATE OR REPLACE FUNCTION public.get_settlement_approval_guard_violation_count()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*)::integer
    FROM public.v_settlement_approval_guard_violations;
$$;
GRANT SELECT ON public.v_settlement_approval_guard_violations TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_settlement_approval_guard_violation_count() TO authenticated, service_role;
COMMIT;
