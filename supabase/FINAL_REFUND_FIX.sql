-- HARDENED REFUND SYSTEM FIX (v2 - Idempotent)
-- Run this in Supabase SQL Editor to resolve the "Empty" state.
BEGIN;
-- 1. SCHEMA ALIGNMENT (Handle mixed states)
DO $$ BEGIN -- 1a. Handle 'amount' -> 'refund_amount'
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'refunds'
        AND column_name = 'amount'
) THEN -- If target 'refund_amount' ALSO exists, we just drop 'amount' (assuming 'refund_amount' is the correct one to keep)
-- or migrating data if needed.
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'refunds'
        AND column_name = 'refund_amount'
) THEN
ALTER TABLE refunds DROP COLUMN amount;
ELSE
ALTER TABLE refunds
    RENAME COLUMN amount TO refund_amount;
END IF;
END IF;
-- 1b. Handle 'refund_status' -> 'status'
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'refunds'
        AND column_name = 'refund_status'
) THEN IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'refunds'
        AND column_name = 'status'
) THEN
ALTER TABLE refunds DROP COLUMN refund_status;
ELSE
ALTER TABLE refunds
    RENAME COLUMN refund_status TO status;
END IF;
END IF;
END $$;
-- 2. ADD MISSING COLUMNS (Safe to run multiple times)
ALTER TABLE refunds
ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- 3. RLS POLICIES (Re-apply safely)
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can do everything on refunds" ON refunds;
CREATE POLICY "Admins can do everything on refunds" ON refunds FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = auth.uid()
            AND role = 'admin'
    )
) WITH CHECK (
    EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = auth.uid()
            AND role = 'admin'
    )
);
DROP POLICY IF EXISTS "Users can see their own refunds" ON refunds;
CREATE POLICY "Users can see their own refunds" ON refunds FOR
SELECT TO authenticated USING (customer_id = auth.uid());
-- 4. EDGE FUNCTION CONFIGURATION
-- CRITICAL: Replace 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE' with your actual key from settings!
INSERT INTO config (key, value, description)
VALUES (
        'supabase_url',
        'https://rkabjhgdmluacqjdtjwi.supabase.co',
        'Project URL for triggers'
    ),
    (
        'supabase_service_role_key',
        'PASTE_YOUR_SERVICE_ROLE_KEY_HERE',
        'REQUIRED: Service role key'
    ) ON CONFLICT (key) DO
UPDATE
SET value = EXCLUDED.value;
COMMIT;