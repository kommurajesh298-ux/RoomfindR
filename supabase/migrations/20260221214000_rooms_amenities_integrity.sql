BEGIN;
CREATE OR REPLACE FUNCTION public.normalize_amenity_label(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    cleaned text := btrim(coalesce(raw, ''));
    normalized_key text;
BEGIN
    IF cleaned = '' THEN
        RETURN '';
    END IF;

    normalized_key := regexp_replace(lower(cleaned), '[^a-z0-9]', '', 'g');

    CASE normalized_key
        WHEN 'wifi' THEN RETURN 'WiFi';
        WHEN 'ac' THEN RETURN 'AC';
        WHEN 'cctv' THEN RETURN 'CCTV';
        WHEN 'tv' THEN RETURN 'TV';
        WHEN 'meals' THEN RETURN 'Meals';
        WHEN 'laundry' THEN RETURN 'Laundry';
        WHEN 'security' THEN RETURN 'Security';
        WHEN 'parking' THEN RETURN 'Parking';
        WHEN 'powerbackup' THEN RETURN 'Power Backup';
        WHEN 'watersupply' THEN RETURN 'Water Supply';
        WHEN 'housekeeping' THEN RETURN 'Housekeeping';
        ELSE
            RETURN initcap(regexp_replace(cleaned, '[_-]+', ' ', 'g'));
    END CASE;
END;
$$;
CREATE OR REPLACE FUNCTION public.text_array_has_no_blank(values_arr text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(values_arr, ARRAY[]::text[])) AS v(value)
        WHERE btrim(coalesce(v.value, '')) = ''
    );
$$;
CREATE OR REPLACE FUNCTION public.property_amenities_as_text_array(property_uuid uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    property_amenities jsonb;
    result_values text[];
BEGIN
    SELECT p.amenities
    INTO property_amenities
    FROM public.properties p
    WHERE p.id = property_uuid;

    IF property_amenities IS NULL THEN
        RETURN ARRAY[]::text[];
    END IF;

    IF jsonb_typeof(property_amenities) = 'object' THEN
        SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[])
        INTO result_values
        FROM (
            SELECT DISTINCT public.normalize_amenity_label(e.key) AS label
            FROM jsonb_each_text(property_amenities) AS e(key, value)
            WHERE lower(e.value) IN ('true', '1', 'yes', 'on')
        ) AS normalized
        WHERE label <> '';
        RETURN coalesce(result_values, ARRAY[]::text[]);
    END IF;

    IF jsonb_typeof(property_amenities) = 'array' THEN
        SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[])
        INTO result_values
        FROM (
            SELECT DISTINCT public.normalize_amenity_label(item.value) AS label
            FROM jsonb_array_elements_text(property_amenities) AS item(value)
        ) AS normalized
        WHERE label <> '';
        RETURN coalesce(result_values, ARRAY[]::text[]);
    END IF;

    RETURN ARRAY[]::text[];
END;
$$;
CREATE OR REPLACE FUNCTION public.ensure_room_amenities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sanitized text[];
    inferred text[];
BEGIN
    SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[])
    INTO sanitized
    FROM (
        SELECT DISTINCT public.normalize_amenity_label(item.value) AS label
        FROM unnest(coalesce(NEW.amenities, ARRAY[]::text[])) AS item(value)
    ) AS normalized
    WHERE label <> '';

    IF coalesce(array_length(sanitized, 1), 0) = 0 THEN
        inferred := public.property_amenities_as_text_array(NEW.property_id);
        NEW.amenities := coalesce(inferred, ARRAY[]::text[]);
    ELSE
        NEW.amenities := sanitized;
    END IF;

    IF NEW.amenities IS NULL THEN
        NEW.amenities := ARRAY[]::text[];
    END IF;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rooms_ensure_amenities ON public.rooms;
CREATE TRIGGER trg_rooms_ensure_amenities
BEFORE INSERT OR UPDATE OF amenities, property_id
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.ensure_room_amenities();
UPDATE public.rooms AS r
SET amenities = public.property_amenities_as_text_array(r.property_id)
WHERE r.amenities IS NULL
   OR coalesce(array_length(r.amenities, 1), 0) = 0;
UPDATE public.rooms AS r
SET amenities = normalized.cleaned
FROM (
    SELECT
        source.id,
        coalesce(array_agg(source.label ORDER BY source.label), ARRAY[]::text[]) AS cleaned
    FROM (
        SELECT
            r2.id,
            public.normalize_amenity_label(item.value) AS label
        FROM public.rooms AS r2
        CROSS JOIN LATERAL unnest(coalesce(r2.amenities, ARRAY[]::text[])) AS item(value)
    ) AS source
    WHERE source.label <> ''
    GROUP BY source.id
) AS normalized
WHERE r.id = normalized.id;
UPDATE public.rooms
SET amenities = ARRAY[]::text[]
WHERE amenities IS NULL;
ALTER TABLE public.rooms
    ALTER COLUMN amenities SET DEFAULT ARRAY[]::text[],
    ALTER COLUMN amenities SET NOT NULL;
ALTER TABLE public.rooms
    DROP CONSTRAINT IF EXISTS rooms_amenities_non_blank_chk;
ALTER TABLE public.rooms
    ADD CONSTRAINT rooms_amenities_non_blank_chk
    CHECK (public.text_array_has_no_blank(amenities));
COMMIT;
