-- Ensure properties.rules is always a JSON array and never NULL.

BEGIN;
UPDATE public.properties
SET rules = '[]'::jsonb
WHERE rules IS NULL
   OR jsonb_typeof(rules) IS DISTINCT FROM 'array';
ALTER TABLE public.properties
    ALTER COLUMN rules SET DEFAULT '[]'::jsonb,
    ALTER COLUMN rules SET NOT NULL;
ALTER TABLE public.properties
    DROP CONSTRAINT IF EXISTS properties_rules_is_array_chk;
ALTER TABLE public.properties
    ADD CONSTRAINT properties_rules_is_array_chk
    CHECK (jsonb_typeof(rules) = 'array');
CREATE OR REPLACE FUNCTION public.normalize_property_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF NEW.rules IS NULL OR jsonb_typeof(NEW.rules) <> 'array' THEN
        NEW.rules := '[]'::jsonb;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS properties_rules_normalize_trg ON public.properties;
CREATE TRIGGER properties_rules_normalize_trg
BEFORE INSERT OR UPDATE ON public.properties
FOR EACH ROW
EXECUTE FUNCTION public.normalize_property_rules();
COMMIT;
