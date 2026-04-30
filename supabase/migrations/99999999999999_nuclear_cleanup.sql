-- ==========================================
-- ☢️ NUCLEAR CLEANUP SCRIPT
-- RUN THIS IN THE SUPABASE SQL EDITOR
-- This will wipe ALL users and ALL account data.
-- ==========================================
-- 1. Disable all triggers (Atomic Cleanup)
SET session_replication_role = 'replica';
-- 2. TRUNCATE ALL PUBLIC TABLES (Comprehensive)
TRUNCATE public.accounts CASCADE;
TRUNCATE public.customers CASCADE;
TRUNCATE public.owners CASCADE;
TRUNCATE public.admins CASCADE;
TRUNCATE public.properties CASCADE;
TRUNCATE public.rooms CASCADE;
TRUNCATE public.bookings CASCADE;
TRUNCATE public.payments CASCADE;
TRUNCATE public.payment_attempts CASCADE;
TRUNCATE public.refunds CASCADE;
TRUNCATE public.settlements CASCADE;
TRUNCATE public.wallets CASCADE;
TRUNCATE public.wallet_transactions CASCADE;
TRUNCATE public.notifications CASCADE;
TRUNCATE public.device_tokens CASCADE;
TRUNCATE public.food_menu CASCADE;
TRUNCATE public.config CASCADE;
-- 3. WIPE AUTH SCHEMA (The primary blocker)
DELETE FROM auth.users;
DELETE FROM auth.identities;
DELETE FROM auth.sessions;
DELETE FROM auth.refresh_tokens;
-- 4. Re-enable triggers
SET session_replication_role = 'origin';
-- 5. Final Report
SELECT 'Cleanup Complete. All user and application data has been wiped.' as status;
