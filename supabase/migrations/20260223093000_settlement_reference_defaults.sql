BEGIN;
-- Ensure every settlement has a stable internal reference even before provider payout starts.
CREATE OR REPLACE FUNCTION public.build_settlement_reference(
    p_settlement_id UUID,
    p_attempt INTEGER DEFAULT 1
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT left(
        format(
            'stl_%s_a%s',
            coalesce(
                nullif(
                    left(
                        regexp_replace(coalesce(p_settlement_id::text, ''), '[^a-zA-Z0-9]', '', 'g'),
                        14
                    ),
                    ''
                ),
                'settlement'
            ),
            greatest(1, coalesce(p_attempt, 1))
        ),
        40
    );
$$;
CREATE OR REPLACE FUNCTION public.ensure_settlement_reference_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_existing TEXT;
    v_attempt INTEGER;
BEGIN
    v_existing := coalesce(
        nullif(trim(coalesce(NEW.transaction_id, '')), ''),
        nullif(trim(coalesce(NEW.provider_reference, '')), ''),
        nullif(trim(coalesce(NEW.provider_transfer_id, '')), '')
    );

    IF v_existing IS NULL THEN
        v_attempt := greatest(1, coalesce(NEW.payout_attempts, 0) + 1);
        NEW.transaction_id := public.build_settlement_reference(NEW.id, v_attempt);
    ELSIF nullif(trim(coalesce(NEW.transaction_id, '')), '') IS NULL THEN
        NEW.transaction_id := v_existing;
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_settlement_reference_default ON public.settlements;
CREATE TRIGGER trg_settlement_reference_default
BEFORE INSERT OR UPDATE OF transaction_id, provider_reference, provider_transfer_id, payout_attempts
ON public.settlements
FOR EACH ROW
EXECUTE FUNCTION public.ensure_settlement_reference_trigger();
UPDATE public.settlements s
SET transaction_id = coalesce(
    nullif(trim(coalesce(s.provider_reference, '')), ''),
    nullif(trim(coalesce(s.provider_transfer_id, '')), ''),
    public.build_settlement_reference(s.id, greatest(1, coalesce(s.payout_attempts, 0) + 1))
)
WHERE nullif(trim(coalesce(s.transaction_id, '')), '') IS NULL;
COMMIT;
