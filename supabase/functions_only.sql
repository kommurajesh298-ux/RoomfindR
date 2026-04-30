-- =============================================================================
-- STANDALONE FUNCTIONS SCRIPT FOR ROOMFINDR
-- =============================================================================
-- Run this script separately if functions are missing from the dashboard
-- This includes all helper functions and triggers needed for RLS and automation
-- =============================================================================
-- =============================================================================
-- HELPER FUNCTIONS FOR RLS POLICIES
-- =============================================================================
-- Check if user is admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$ BEGIN RETURN EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = auth.uid()
            AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Check if user is owner
CREATE OR REPLACE FUNCTION is_owner() RETURNS BOOLEAN AS $$ BEGIN RETURN EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = auth.uid()
            AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Check if user is customer
CREATE OR REPLACE FUNCTION is_customer() RETURNS BOOLEAN AS $$ BEGIN RETURN EXISTS (
        SELECT 1
        FROM accounts
        WHERE id = auth.uid()
            AND role = 'customer'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================================================
-- TIMESTAMP UPDATE TRIGGER FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- =============================================================================
-- USER REGISTRATION TRIGGER FUNCTION
-- =============================================================================
-- Trigger function to automatically create a profile row in accounts and owners/customers
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN -- Insert into accounts
INSERT INTO public.accounts (id, email, phone, role)
VALUES (
        new.id,
        new.email,
        new.phone,
        COALESCE(new.raw_user_meta_data->>'role', 'owner') -- Default to owner for Owner App, customer for Customer App
    ) ON CONFLICT (id) DO NOTHING;
-- Insert into owners or customers based on role
IF (
    COALESCE(new.raw_user_meta_data->>'role', 'owner') = 'owner'
) THEN
INSERT INTO public.owners (id, name, email, phone)
VALUES (
        new.id,
        new.raw_user_meta_data->>'name',
        new.email,
        COALESCE(new.phone, new.raw_user_meta_data->>'phone')
    ) ON CONFLICT (id) DO NOTHING;
ELSE
INSERT INTO public.customers (id, name, email, phone)
VALUES (
        new.id,
        new.raw_user_meta_data->>'name',
        new.email,
        COALESCE(new.phone, new.raw_user_meta_data->>'phone')
    ) ON CONFLICT (id) DO NOTHING;
END IF;
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================================================
-- ATTACH TRIGGERS TO TABLES
-- =============================================================================
-- User registration trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- Updated_at triggers
DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts;
CREATE TRIGGER update_accounts_updated_at BEFORE
UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE
UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_owners_updated_at ON owners;
CREATE TRIGGER update_owners_updated_at BEFORE
UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_properties_updated_at ON properties;
CREATE TRIGGER update_properties_updated_at BEFORE
UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at BEFORE
UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_chats_updated_at ON chats;
CREATE TRIGGER update_chats_updated_at BEFORE
UPDATE ON chats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_notices_updated_at ON notices;
CREATE TRIGGER update_notices_updated_at BEFORE
UPDATE ON notices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- After running this script, verify:
-- 1. Navigate to Database → Functions in Supabase Dashboard
-- 2. Should see 5 functions:
--    - is_admin()
--    - is_owner()
--    - is_customer()
--    - update_updated_at_column()
--    - handle_new_user()
-- 3. Check Database → Triggers to see all triggers attached
-- =============================================================================