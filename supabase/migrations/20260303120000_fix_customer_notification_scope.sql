-- Clean up legacy payout/settlement notifications that were incorrectly inserted for customers.
-- Permanent prevention is handled in cashfree-api + app-level audience filtering.

WITH customer_ids AS (
  SELECT id
  FROM public.customers
),
target_rows AS (
  SELECT n.id
  FROM public.notifications n
  WHERE n.user_id IN (SELECT id FROM customer_ids)
    AND (
      coalesce(n.data, '{}'::jsonb) ? 'payout_id'
      OR coalesce(n.data, '{}'::jsonb) ? 'payout_status'
      OR coalesce(n.data, '{}'::jsonb) ? 'payout_type'
      OR coalesce(n.data, '{}'::jsonb) ? 'cashfree_payout_id'
      OR lower(coalesce(n.title, '')) LIKE ANY (
        ARRAY[
          '%owner payout%',
          '%advance payout%',
          '%rent payout%',
          '%rent settlement%',
          '%payout update%'
        ]
      )
      OR lower(coalesce(n.message, '')) LIKE ANY (
        ARRAY[
          '%owner payout%',
          '%advance payout%',
          '%rent payout%',
          '%rent settlement%',
          '%admin-approved payout%'
        ]
      )
    )
)
UPDATE public.notifications n
SET
  is_read = true,
  data = coalesce(n.data, '{}'::jsonb)
    || jsonb_build_object(
      'notification_audience', 'owner',
      'suppressed_in_customer_app', true,
      'suppressed_reason', 'legacy_owner_admin_payout_notification'
    ),
  updated_at = now()
WHERE n.id IN (SELECT id FROM target_rows);
