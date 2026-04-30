-- Keep offer usage counters aligned with claimed_offers redemption rows.
-- This makes current_uses resilient even when customers cannot update offers
-- directly under RLS after a successful booking payment.

CREATE OR REPLACE FUNCTION public.sync_offer_current_uses(p_offer_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_offer_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.offers
    SET current_uses = (
        SELECT COUNT(*)::INTEGER
        FROM public.claimed_offers
        WHERE offer_id = p_offer_id
          AND used_at IS NOT NULL
    )
    WHERE id = p_offer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_sync_offer_current_uses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.sync_offer_current_uses(COALESCE(NEW.offer_id, OLD.offer_id));
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS claimed_offers_sync_offer_current_uses ON public.claimed_offers;
CREATE TRIGGER claimed_offers_sync_offer_current_uses
AFTER INSERT OR UPDATE OF used_at, offer_id OR DELETE ON public.claimed_offers
FOR EACH ROW
EXECUTE FUNCTION public.trigger_sync_offer_current_uses();
