-- Settlement periods + duplicate guard + refund tracking
DO $$ BEGIN CREATE TYPE settlement_period_enum AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE settlements
ADD COLUMN IF NOT EXISTS period_type settlement_period_enum;
UPDATE settlements
SET period_type = COALESCE(period_type, 'WEEKLY');
ALTER TABLE settlements
ALTER COLUMN period_type
SET DEFAULT 'WEEKLY',
    ALTER COLUMN period_type
SET NOT NULL;
ALTER TABLE settlements
ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;
-- One owner â†’ one settlement per period window
DROP INDEX IF EXISTS idx_settlements_owner_period_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_owner_period_unique ON settlements(
    owner_id,
    period_type,
    week_start_date,
    week_end_date
)
WHERE booking_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_period_type ON settlements(period_type);
-- Safety: ensure start <= end
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'settlements_period_range'
) THEN
ALTER TABLE settlements
ADD CONSTRAINT settlements_period_range CHECK (week_start_date <= week_end_date);
END IF;
END $$;
