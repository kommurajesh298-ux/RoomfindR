-- =============================================================================
-- DATABASE SECURITY & INTEGRITY UPGRADE (FIXED)
-- Focus: Unique Constraints, Data Integrity, and Realtime Performance
-- =============================================================================
-- 1. ENFORCE UNIQUE PHONE NUMBERS & EMAILS ACROSS ALL PROFILE TABLES
-- Note: These will fail if you have existing duplicates. 
-- Please delete duplicate rows manually before running if errors occur.
-- Customers Table
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_unique;
ALTER TABLE customers
ADD CONSTRAINT customers_email_unique UNIQUE (email);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_unique;
ALTER TABLE customers
ADD CONSTRAINT customers_phone_unique UNIQUE (phone);
-- Owners Table
ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_email_unique;
ALTER TABLE owners
ADD CONSTRAINT owners_email_unique UNIQUE (email);
ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_phone_unique;
ALTER TABLE owners
ADD CONSTRAINT owners_phone_unique UNIQUE (phone);
-- Admins Table
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_email_unique;
ALTER TABLE admins
ADD CONSTRAINT admins_email_unique UNIQUE (email);
-- 2. ENABLE REALTIME FOR ALL CRITICAL CONTACT TABLES
-- This ensures that when a profile is updated, all apps see it instantly (Realtime Verification)
-- Ensure the publication exists (Supabase default)
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
) THEN CREATE PUBLICATION supabase_realtime;
END IF;
END $$;
-- Safe Add Tables to Realtime Publication (Fixed Syntax)
DO $$ BEGIN -- Add customers
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND tablename = 'customers'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE customers;
END IF;
-- Add owners
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND tablename = 'owners'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE owners;
END IF;
-- Add admins
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND tablename = 'admins'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE admins;
END IF;
-- Add accounts
IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
        AND tablename = 'accounts'
) THEN ALTER PUBLICATION supabase_realtime
ADD TABLE accounts;
END IF;
END $$;
-- 3. SET REPLICA IDENTITY TO FULL FOR ACCURATE REALTIME SYNC
ALTER TABLE accounts REPLICA IDENTITY FULL;
ALTER TABLE customers REPLICA IDENTITY FULL;
ALTER TABLE owners REPLICA IDENTITY FULL;
ALTER TABLE admins REPLICA IDENTITY FULL;
-- 4. DATABASE CLEANUP HELPERS (Commented out)
-- Run these separately if the unique constraints above fail.
/*
 -- Find duplicate emails:
 SELECT email, count(*) FROM accounts GROUP BY email HAVING count(*) > 1;
 -- Find duplicate phones:
 SELECT phone, count(*) FROM accounts GROUP BY phone HAVING count(*) > 1;
 */