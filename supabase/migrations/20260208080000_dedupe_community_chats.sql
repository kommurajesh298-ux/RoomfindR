-- Dedupe community chats (property_id not null) and enforce uniqueness

-- 1) Move messages from duplicate chats into the canonical chat (most messages, then newest)
WITH duplicate_properties AS (
    SELECT property_id
    FROM chats
    WHERE property_id IS NOT NULL
    GROUP BY property_id
    HAVING COUNT(*) > 1
),
chat_message_counts AS (
    SELECT c.id,
           c.property_id,
           c.updated_at,
           COALESCE(m.message_count, 0) AS message_count
    FROM chats c
    LEFT JOIN (
        SELECT chat_id, COUNT(*) AS message_count
        FROM messages
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
UPDATE messages AS msg
SET chat_id = canonical.keep_id
FROM ranked
JOIN canonical ON canonical.property_id = ranked.property_id
WHERE msg.chat_id = ranked.id
  AND ranked.rn > 1;
-- 2) Merge participants into the canonical chat
WITH duplicate_properties AS (
    SELECT property_id
    FROM chats
    WHERE property_id IS NOT NULL
    GROUP BY property_id
    HAVING COUNT(*) > 1
),
participants_union AS (
    SELECT c.property_id,
           ARRAY(
               SELECT DISTINCT p
               FROM chats c2, unnest(c2.participants) AS p
               WHERE c2.property_id = c.property_id
           ) AS participants
    FROM chats c
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
        FROM chats c
        LEFT JOIN (
            SELECT chat_id, COUNT(*) AS message_count
            FROM messages
            GROUP BY chat_id
        ) m ON m.chat_id = c.id
        WHERE c.property_id IN (SELECT property_id FROM duplicate_properties)
    ) ranked
    WHERE rn = 1
)
UPDATE chats AS c
SET participants = p.participants
FROM participants_union p
JOIN canonical ON canonical.property_id = p.property_id
WHERE c.id = canonical.keep_id;
-- 3) Delete duplicate chats (keep canonical)
WITH duplicate_properties AS (
    SELECT property_id
    FROM chats
    WHERE property_id IS NOT NULL
    GROUP BY property_id
    HAVING COUNT(*) > 1
),
chat_message_counts AS (
    SELECT c.id,
           c.property_id,
           c.updated_at,
           COALESCE(m.message_count, 0) AS message_count
    FROM chats c
    LEFT JOIN (
        SELECT chat_id, COUNT(*) AS message_count
        FROM messages
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
DELETE FROM chats AS c
USING ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;
-- 4) Enforce one community chat per property going forward
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_property_unique
    ON chats (property_id)
    WHERE property_id IS NOT NULL;
