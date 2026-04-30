BEGIN;
-- Helper: determines whether a user should be allowed into a property's community chat.
CREATE OR REPLACE FUNCTION public.is_property_chat_member(
    p_property_id UUID,
    p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
    IF p_property_id IS NULL OR p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF public.is_admin(p_user_id) THEN
        RETURN TRUE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.properties p
        WHERE p.id = p_property_id
          AND p.owner_id = p_user_id
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.property_id = p_property_id
          AND b.vacate_date IS NULL
          AND (b.customer_id = p_user_id OR b.owner_id = p_user_id)
          AND (
              lower(replace(coalesce(b.status::text, ''), '_', '-')) IN (
                  'requested',
                  'pending',
                  'payment-pending',
                  'approved',
                  'accepted',
                  'confirmed',
                  'checked-in',
                  'active',
                  'ongoing',
                  'vacate-requested',
                  'paid'
              )
              OR lower(replace(coalesce(b.stay_status::text, ''), '_', '-')) IN (
                  'checked-in',
                  'active',
                  'ongoing',
                  'vacate-requested'
              )
          )
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_property_chat_member(UUID, UUID) TO authenticated, service_role;
-- Chats: allow active property members (residents/owner/admin) to access community chat rows.
DROP POLICY IF EXISTS chats_select ON public.chats;
CREATE POLICY chats_select ON public.chats FOR SELECT USING (
    auth.uid() = ANY(participants)
    OR (
        property_id IS NOT NULL
        AND public.is_property_chat_member(property_id, auth.uid())
    )
);
DROP POLICY IF EXISTS chats_insert ON public.chats;
CREATE POLICY chats_insert ON public.chats FOR INSERT WITH CHECK (
    auth.uid() = ANY(participants)
    AND (
        property_id IS NULL
        OR public.is_property_chat_member(property_id, auth.uid())
    )
);
DROP POLICY IF EXISTS chats_update ON public.chats;
CREATE POLICY chats_update ON public.chats FOR UPDATE USING (
    auth.uid() = ANY(participants)
    OR (
        property_id IS NOT NULL
        AND public.is_property_chat_member(property_id, auth.uid())
    )
) WITH CHECK (
    property_id IS NULL
    OR public.is_property_chat_member(property_id, auth.uid())
);
DROP POLICY IF EXISTS chats_delete ON public.chats;
CREATE POLICY chats_delete ON public.chats FOR DELETE USING (
    auth.uid() = ANY(participants)
    OR public.is_admin(auth.uid())
);
-- Messages: mirror chat access so all active property members see same community messages.
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM public.chats c
        WHERE c.id = messages.chat_id
          AND (
              auth.uid() = ANY(c.participants)
              OR (
                  c.property_id IS NOT NULL
                  AND public.is_property_chat_member(c.property_id, auth.uid())
              )
          )
    )
);
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.chats c
        WHERE c.id = messages.chat_id
          AND (
              auth.uid() = ANY(c.participants)
              OR (
                  c.property_id IS NOT NULL
                  AND public.is_property_chat_member(c.property_id, auth.uid())
              )
          )
    )
);
DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY messages_update ON public.messages FOR UPDATE USING (
    EXISTS (
        SELECT 1
        FROM public.chats c
        WHERE c.id = messages.chat_id
          AND (
              auth.uid() = ANY(c.participants)
              OR (
                  c.property_id IS NOT NULL
                  AND public.is_property_chat_member(c.property_id, auth.uid())
              )
          )
    )
) WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.chats c
        WHERE c.id = messages.chat_id
          AND (
              auth.uid() = ANY(c.participants)
              OR (
                  c.property_id IS NOT NULL
                  AND public.is_property_chat_member(c.property_id, auth.uid())
              )
          )
    )
);
DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_delete ON public.messages FOR DELETE USING (
    EXISTS (
        SELECT 1
        FROM public.chats c
        WHERE c.id = messages.chat_id
          AND (
              auth.uid() = ANY(c.participants)
              OR (
                  c.property_id IS NOT NULL
                  AND public.is_property_chat_member(c.property_id, auth.uid())
              )
          )
    )
);
-- Dedupe community chats by property (if legacy duplicates exist).
WITH duplicate_properties AS (
    SELECT property_id
    FROM public.chats
    WHERE property_id IS NOT NULL
    GROUP BY property_id
    HAVING COUNT(*) > 1
),
chat_message_counts AS (
    SELECT c.id,
           c.property_id,
           c.updated_at,
           COALESCE(m.message_count, 0) AS message_count
    FROM public.chats c
    LEFT JOIN (
        SELECT chat_id, COUNT(*) AS message_count
        FROM public.messages
        GROUP BY chat_id
    ) m ON m.chat_id = c.id
    WHERE c.property_id IN (SELECT property_id FROM duplicate_properties)
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY property_id
               ORDER BY message_count DESC, updated_at DESC, id DESC
           ) AS rn
    FROM chat_message_counts
),
canonical AS (
    SELECT property_id, id AS keep_id
    FROM ranked
    WHERE rn = 1
)
UPDATE public.messages msg
SET chat_id = canonical.keep_id
FROM ranked
JOIN canonical ON canonical.property_id = ranked.property_id
WHERE msg.chat_id = ranked.id
  AND ranked.rn > 1;
-- Merge duplicate chat participants into canonical rows.
WITH duplicate_properties AS (
    SELECT property_id
    FROM public.chats
    WHERE property_id IS NOT NULL
    GROUP BY property_id
    HAVING COUNT(*) > 1
),
participants_union AS (
    SELECT c.property_id,
           ARRAY(
               SELECT DISTINCT p
               FROM public.chats c2,
                    unnest(c2.participants) AS p
               WHERE c2.property_id = c.property_id
           ) AS participants
    FROM public.chats c
    WHERE c.property_id IN (SELECT property_id FROM duplicate_properties)
    GROUP BY c.property_id
),
canonical AS (
    SELECT property_id,
           id AS keep_id
    FROM (
        SELECT c.id,
               c.property_id,
               ROW_NUMBER() OVER (
                   PARTITION BY c.property_id
                   ORDER BY COALESCE(m.message_count, 0) DESC, c.updated_at DESC, c.id DESC
               ) AS rn
        FROM public.chats c
        LEFT JOIN (
            SELECT chat_id, COUNT(*) AS message_count
            FROM public.messages
            GROUP BY chat_id
        ) m ON m.chat_id = c.id
        WHERE c.property_id IN (SELECT property_id FROM duplicate_properties)
    ) ranked
    WHERE rn = 1
)
UPDATE public.chats c
SET participants = p.participants
FROM participants_union p
JOIN canonical ON canonical.property_id = p.property_id
WHERE c.id = canonical.keep_id;
-- Remove duplicate rows after migrating messages and participants.
WITH duplicate_properties AS (
    SELECT property_id
    FROM public.chats
    WHERE property_id IS NOT NULL
    GROUP BY property_id
    HAVING COUNT(*) > 1
),
chat_message_counts AS (
    SELECT c.id,
           c.property_id,
           c.updated_at,
           COALESCE(m.message_count, 0) AS message_count
    FROM public.chats c
    LEFT JOIN (
        SELECT chat_id, COUNT(*) AS message_count
        FROM public.messages
        GROUP BY chat_id
    ) m ON m.chat_id = c.id
    WHERE c.property_id IN (SELECT property_id FROM duplicate_properties)
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY property_id
               ORDER BY message_count DESC, updated_at DESC, id DESC
           ) AS rn
    FROM chat_message_counts
)
DELETE FROM public.chats c
USING ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;
-- Keep participants in sync for each community chat with active residents + owner.
UPDATE public.chats c
SET participants = COALESCE(
    (
        SELECT ARRAY_AGG(DISTINCT participant_id)
        FROM (
            SELECT unnest(COALESCE(c.participants, ARRAY[]::UUID[])) AS participant_id

            UNION

            SELECT b.customer_id AS participant_id
            FROM public.bookings b
            WHERE b.property_id = c.property_id
              AND b.vacate_date IS NULL
              AND lower(replace(coalesce(b.status::text, ''), '_', '-')) IN (
                  'requested',
                  'pending',
                  'payment-pending',
                  'approved',
                  'accepted',
                  'confirmed',
                  'checked-in',
                  'active',
                  'ongoing',
                  'vacate-requested',
                  'paid'
              )

            UNION

            SELECT p.owner_id AS participant_id
            FROM public.properties p
            WHERE p.id = c.property_id
        ) participants_all
        WHERE participant_id IS NOT NULL
    ),
    ARRAY[]::UUID[]
)
WHERE c.property_id IS NOT NULL;
-- Enforce exactly one community chat row per property.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_property_unique
    ON public.chats(property_id)
    WHERE property_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
