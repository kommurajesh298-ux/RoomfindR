-- =============================================================================
-- PRICE INSTABILITY DIAGNOSTIC TOOL
-- =============================================================================
-- This script creates a temporary audit log to track WHO and WHAT is changing
-- the property prices (monthly_rent) and auto_offers.
-- 1. Create Audit Table
CREATE TABLE IF NOT EXISTS price_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID,
    old_price NUMERIC,
    new_price NUMERIC,
    old_offer JSONB,
    new_offer JSONB,
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    auth_uid UUID DEFAULT auth.uid(),
    -- The user logged in (if any)
    role TEXT DEFAULT auth.role(),
    -- The role (authenticated, service_role, etc.)
    operation TEXT,
    -- UPDATE, INSERT
    query_context TEXT -- Optional: Capture detailed session info if available
);
-- Enable RLS but allow insert for tracking
ALTER TABLE price_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow tracking" ON price_audit_logs FOR
INSERT TO public,
    authenticated,
    service_role,
    anon WITH CHECK (true);
CREATE POLICY "Allow viewing" ON price_audit_logs FOR
SELECT TO public,
    authenticated,
    service_role,
    anon USING (true);
-- 2. Create Logging Function
CREATE OR REPLACE FUNCTION log_price_change() RETURNS TRIGGER AS $$ BEGIN -- Only log if the price or offer actually changed
    IF (
        OLD.monthly_rent IS DISTINCT
        FROM NEW.monthly_rent
    )
    OR (
        OLD.auto_offer IS DISTINCT
        FROM NEW.auto_offer
    ) THEN
INSERT INTO price_audit_logs (
        property_id,
        old_price,
        new_price,
        old_offer,
        new_offer,
        operation,
        auth_uid,
        role
    )
VALUES (
        NEW.id,
        OLD.monthly_rent,
        NEW.monthly_rent,
        OLD.auto_offer,
        NEW.auto_offer,
        TG_OP,
        auth.uid(),
        auth.role()
    );
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. Attach Trigger to Properties Table
DROP TRIGGER IF EXISTS trigger_log_price_change ON properties;
CREATE TRIGGER trigger_log_price_change BEFORE
UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION log_price_change();
-- 4. Notify setup complete
COMMENT ON TABLE price_audit_logs IS 'Diagnostics for 1000->994 bug';