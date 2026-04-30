-- Admin RLS policies for RoomFindR
-- Allows admin users (accounts.role = 'admin') to access management tables.

SET search_path = public;
-- Accounts
DROP POLICY IF EXISTS admin_accounts_all ON accounts;
CREATE POLICY admin_accounts_all ON accounts FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Core user tables
DROP POLICY IF EXISTS admin_customers_all ON customers;
CREATE POLICY admin_customers_all ON customers FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_owners_all ON owners;
CREATE POLICY admin_owners_all ON owners FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_admins_all ON admins;
CREATE POLICY admin_admins_all ON admins FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Inventory
DROP POLICY IF EXISTS admin_properties_all ON properties;
CREATE POLICY admin_properties_all ON properties FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_rooms_all ON rooms;
CREATE POLICY admin_rooms_all ON rooms FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_food_menu_all ON food_menu;
CREATE POLICY admin_food_menu_all ON food_menu FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Bookings & payments
DROP POLICY IF EXISTS admin_bookings_all ON bookings;
CREATE POLICY admin_bookings_all ON bookings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_payments_all ON payments;
CREATE POLICY admin_payments_all ON payments FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_payment_attempts_all ON payment_attempts;
CREATE POLICY admin_payment_attempts_all ON payment_attempts FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_refunds_all ON refunds;
CREATE POLICY admin_refunds_all ON refunds FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_settlements_all ON settlements;
CREATE POLICY admin_settlements_all ON settlements FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Wallets
DROP POLICY IF EXISTS admin_wallets_all ON wallets;
CREATE POLICY admin_wallets_all ON wallets FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_wallet_transactions_all ON wallet_transactions;
CREATE POLICY admin_wallet_transactions_all ON wallet_transactions FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Notifications
DROP POLICY IF EXISTS admin_notifications_all ON notifications;
CREATE POLICY admin_notifications_all ON notifications FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_device_tokens_all ON device_tokens;
CREATE POLICY admin_device_tokens_all ON device_tokens FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Communication
DROP POLICY IF EXISTS admin_chats_all ON chats;
CREATE POLICY admin_chats_all ON chats FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_messages_all ON messages;
CREATE POLICY admin_messages_all ON messages FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Notices & offers
DROP POLICY IF EXISTS admin_notices_all ON notices;
CREATE POLICY admin_notices_all ON notices FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_offers_all ON offers;
CREATE POLICY admin_offers_all ON offers FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_claimed_offers_all ON claimed_offers;
CREATE POLICY admin_claimed_offers_all ON claimed_offers FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Favorites & ratings
DROP POLICY IF EXISTS admin_favorites_all ON favorites;
CREATE POLICY admin_favorites_all ON favorites FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_ratings_all ON ratings;
CREATE POLICY admin_ratings_all ON ratings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Support & audit
DROP POLICY IF EXISTS admin_tickets_all ON tickets;
CREATE POLICY admin_tickets_all ON tickets FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_ticket_replies_all ON ticket_replies;
CREATE POLICY admin_ticket_replies_all ON ticket_replies FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_analytics_all ON analytics;
CREATE POLICY admin_analytics_all ON analytics FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_audit_logs_all ON audit_logs;
CREATE POLICY admin_audit_logs_all ON audit_logs FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Settings & config
DROP POLICY IF EXISTS admin_settings_all ON settings;
CREATE POLICY admin_settings_all ON settings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_config_all ON config;
CREATE POLICY admin_config_all ON config FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
