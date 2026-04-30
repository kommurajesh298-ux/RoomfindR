-- RoomFindR RLS Policies (run AFTER full_reset.sql)
-- This enables RLS and adds policies needed by the apps.

SET search_path = public;
-- Enable RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimed_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
-- Admin helper (bypass RLS safely)
CREATE OR REPLACE FUNCTION is_admin(uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = uid AND role = 'admin'
  );
$$;
-- Accounts
DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS accounts_insert ON accounts;
CREATE POLICY accounts_insert ON accounts FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS accounts_update ON accounts;
CREATE POLICY accounts_update ON accounts FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS accounts_delete ON accounts;
CREATE POLICY accounts_delete ON accounts FOR DELETE USING (id = auth.uid());
-- Admin full access (read/write) across admin panel tables
DROP POLICY IF EXISTS admin_accounts_all ON accounts;
CREATE POLICY admin_accounts_all ON accounts FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_customers_all ON customers;
CREATE POLICY admin_customers_all ON customers FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_owners_all ON owners;
CREATE POLICY admin_owners_all ON owners FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_admins_all ON admins;
CREATE POLICY admin_admins_all ON admins FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_properties_all ON properties;
CREATE POLICY admin_properties_all ON properties FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_rooms_all ON rooms;
CREATE POLICY admin_rooms_all ON rooms FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_food_menu_all ON food_menu;
CREATE POLICY admin_food_menu_all ON food_menu FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
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
DROP POLICY IF EXISTS admin_wallets_all ON wallets;
CREATE POLICY admin_wallets_all ON wallets FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_wallet_transactions_all ON wallet_transactions;
CREATE POLICY admin_wallet_transactions_all ON wallet_transactions FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_notifications_all ON notifications;
CREATE POLICY admin_notifications_all ON notifications FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_device_tokens_all ON device_tokens;
CREATE POLICY admin_device_tokens_all ON device_tokens FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_chats_all ON chats;
CREATE POLICY admin_chats_all ON chats FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_messages_all ON messages;
CREATE POLICY admin_messages_all ON messages FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_notices_all ON notices;
CREATE POLICY admin_notices_all ON notices FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_offers_all ON offers;
CREATE POLICY admin_offers_all ON offers FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_claimed_offers_all ON claimed_offers;
CREATE POLICY admin_claimed_offers_all ON claimed_offers FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_favorites_all ON favorites;
CREATE POLICY admin_favorites_all ON favorites FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_ratings_all ON ratings;
CREATE POLICY admin_ratings_all ON ratings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_tickets_all ON tickets;
CREATE POLICY admin_tickets_all ON tickets FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_ticket_replies_all ON ticket_replies;
CREATE POLICY admin_ticket_replies_all ON ticket_replies FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_analytics_all ON analytics;
CREATE POLICY admin_analytics_all ON analytics FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_audit_logs_all ON audit_logs;
CREATE POLICY admin_audit_logs_all ON audit_logs FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_settings_all ON settings;
CREATE POLICY admin_settings_all ON settings FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_config_all ON config;
CREATE POLICY admin_config_all ON config FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
-- Customers
DROP POLICY IF EXISTS customers_select ON customers;
CREATE POLICY customers_select ON customers FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS customers_insert ON customers;
CREATE POLICY customers_insert ON customers FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS customers_update ON customers;
CREATE POLICY customers_update ON customers FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS customers_delete ON customers;
CREATE POLICY customers_delete ON customers FOR DELETE USING (id = auth.uid());
-- Owners
DROP POLICY IF EXISTS owners_select ON owners;
CREATE POLICY owners_select ON owners FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS owners_insert ON owners;
CREATE POLICY owners_insert ON owners FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS owners_update ON owners;
CREATE POLICY owners_update ON owners FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS owners_delete ON owners;
CREATE POLICY owners_delete ON owners FOR DELETE USING (id = auth.uid());
-- Admins
DROP POLICY IF EXISTS admins_select ON admins;
CREATE POLICY admins_select ON admins FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS admins_insert ON admins;
CREATE POLICY admins_insert ON admins FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS admins_update ON admins;
CREATE POLICY admins_update ON admins FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS admins_delete ON admins;
CREATE POLICY admins_delete ON admins FOR DELETE USING (id = auth.uid());
-- Properties (public read, owners write)
DROP POLICY IF EXISTS properties_select ON properties;
CREATE POLICY properties_select ON properties FOR SELECT USING (true);
DROP POLICY IF EXISTS properties_insert ON properties;
CREATE POLICY properties_insert ON properties FOR INSERT WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS properties_update ON properties;
CREATE POLICY properties_update ON properties FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS properties_delete ON properties;
CREATE POLICY properties_delete ON properties FOR DELETE USING (owner_id = auth.uid());
-- Rooms (public read, owners write)
DROP POLICY IF EXISTS rooms_select ON rooms;
CREATE POLICY rooms_select ON rooms FOR SELECT USING (true);
DROP POLICY IF EXISTS rooms_insert ON rooms;
CREATE POLICY rooms_insert ON rooms FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = rooms.property_id AND p.owner_id = auth.uid())
);
DROP POLICY IF EXISTS rooms_update ON rooms;
CREATE POLICY rooms_update ON rooms FOR UPDATE USING (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = rooms.property_id AND p.owner_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = rooms.property_id AND p.owner_id = auth.uid())
);
DROP POLICY IF EXISTS rooms_delete ON rooms;
CREATE POLICY rooms_delete ON rooms FOR DELETE USING (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = rooms.property_id AND p.owner_id = auth.uid())
);
-- Food menu (public read, owners write)
DROP POLICY IF EXISTS food_menu_select ON food_menu;
CREATE POLICY food_menu_select ON food_menu FOR SELECT USING (true);
DROP POLICY IF EXISTS food_menu_insert ON food_menu;
CREATE POLICY food_menu_insert ON food_menu FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = food_menu.property_id AND p.owner_id = auth.uid())
);
DROP POLICY IF EXISTS food_menu_update ON food_menu;
CREATE POLICY food_menu_update ON food_menu FOR UPDATE USING (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = food_menu.property_id AND p.owner_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = food_menu.property_id AND p.owner_id = auth.uid())
);
DROP POLICY IF EXISTS food_menu_delete ON food_menu;
CREATE POLICY food_menu_delete ON food_menu FOR DELETE USING (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = food_menu.property_id AND p.owner_id = auth.uid())
);
-- Bookings (customer/owner access)
DROP POLICY IF EXISTS bookings_select ON bookings;
CREATE POLICY bookings_select ON bookings FOR SELECT USING (customer_id = auth.uid() OR owner_id = auth.uid());
DROP POLICY IF EXISTS bookings_insert ON bookings;
CREATE POLICY bookings_insert ON bookings FOR INSERT WITH CHECK (customer_id = auth.uid());
DROP POLICY IF EXISTS bookings_update ON bookings;
CREATE POLICY bookings_update ON bookings FOR UPDATE USING (customer_id = auth.uid() OR owner_id = auth.uid())
WITH CHECK (customer_id = auth.uid() OR owner_id = auth.uid());
DROP POLICY IF EXISTS bookings_delete ON bookings;
CREATE POLICY bookings_delete ON bookings FOR DELETE USING (customer_id = auth.uid());
-- Payments (customer/owner read, customer insert for monthly)
DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid()))
);
DROP POLICY IF EXISTS payments_insert ON payments;
CREATE POLICY payments_insert ON payments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id AND b.customer_id = auth.uid())
);
DROP POLICY IF EXISTS payments_update ON payments;
CREATE POLICY payments_update ON payments FOR UPDATE USING (
  EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id AND b.customer_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id AND b.customer_id = auth.uid())
);
-- Payment attempts (read-only for owners/customers via booking)
DROP POLICY IF EXISTS payment_attempts_select ON payment_attempts;
CREATE POLICY payment_attempts_select ON payment_attempts FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookings b WHERE b.id = payment_attempts.booking_id AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid()))
);
-- Refunds (read-only for owner/customer)
DROP POLICY IF EXISTS refunds_select ON refunds;
CREATE POLICY refunds_select ON refunds FOR SELECT USING (
  EXISTS (SELECT 1 FROM bookings b WHERE b.id = refunds.booking_id AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid()))
);
-- Settlements (owner read)
DROP POLICY IF EXISTS settlements_select ON settlements;
CREATE POLICY settlements_select ON settlements FOR SELECT USING (owner_id = auth.uid());
-- Wallets (owner read)
DROP POLICY IF EXISTS wallets_select ON wallets;
CREATE POLICY wallets_select ON wallets FOR SELECT USING (owner_id = auth.uid());
-- Wallet transactions (owner read)
DROP POLICY IF EXISTS wallet_transactions_select ON wallet_transactions;
CREATE POLICY wallet_transactions_select ON wallet_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_transactions.wallet_id AND w.owner_id = auth.uid())
);
-- Notifications (user read/update, customer/owner insert for booking notifications)
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = (notifications.data->>'booking_id')::uuid
      AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid())
  )
);
-- Device tokens
DROP POLICY IF EXISTS device_tokens_select ON device_tokens;
CREATE POLICY device_tokens_select ON device_tokens FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS device_tokens_insert ON device_tokens;
CREATE POLICY device_tokens_insert ON device_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS device_tokens_update ON device_tokens;
CREATE POLICY device_tokens_update ON device_tokens FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS device_tokens_delete ON device_tokens;
CREATE POLICY device_tokens_delete ON device_tokens FOR DELETE USING (user_id = auth.uid());
-- Chats (participants can read/write, community join allowed)
DROP POLICY IF EXISTS chats_select ON chats;
CREATE POLICY chats_select ON chats FOR SELECT USING (auth.uid() = ANY(participants));
DROP POLICY IF EXISTS chats_insert ON chats;
CREATE POLICY chats_insert ON chats FOR INSERT WITH CHECK (auth.uid() = ANY(participants));
DROP POLICY IF EXISTS chats_update ON chats;
CREATE POLICY chats_update ON chats FOR UPDATE USING (
  auth.uid() = ANY(participants)
  OR EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = chats.property_id AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid()))
) WITH CHECK (
  auth.uid() = ANY(participants)
  OR EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = chats.property_id AND (b.customer_id = auth.uid() OR b.owner_id = auth.uid()))
);
DROP POLICY IF EXISTS chats_delete ON chats;
CREATE POLICY chats_delete ON chats FOR DELETE USING (auth.uid() = ANY(participants));
-- Messages (participants only)
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND auth.uid() = ANY(c.participants))
);
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND auth.uid() = ANY(c.participants))
);
DROP POLICY IF EXISTS messages_update ON messages;
CREATE POLICY messages_update ON messages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND auth.uid() = ANY(c.participants))
) WITH CHECK (
  EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND auth.uid() = ANY(c.participants))
);
DROP POLICY IF EXISTS messages_delete ON messages;
CREATE POLICY messages_delete ON messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id AND auth.uid() = ANY(c.participants))
);
-- Notices (public read, owners write)
DROP POLICY IF EXISTS notices_select ON notices;
CREATE POLICY notices_select ON notices FOR SELECT USING (true);
DROP POLICY IF EXISTS notices_insert ON notices;
CREATE POLICY notices_insert ON notices FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = notices.property_id AND p.owner_id = auth.uid())
);
DROP POLICY IF EXISTS notices_update ON notices;
CREATE POLICY notices_update ON notices FOR UPDATE USING (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = notices.property_id AND p.owner_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = notices.property_id AND p.owner_id = auth.uid())
);
DROP POLICY IF EXISTS notices_delete ON notices;
CREATE POLICY notices_delete ON notices FOR DELETE USING (
  EXISTS (SELECT 1 FROM properties p WHERE p.id = notices.property_id AND p.owner_id = auth.uid())
);
-- Offers (public read)
DROP POLICY IF EXISTS offers_select ON offers;
CREATE POLICY offers_select ON offers FOR SELECT USING (true);
-- Claimed offers (user access)
DROP POLICY IF EXISTS claimed_offers_select ON claimed_offers;
CREATE POLICY claimed_offers_select ON claimed_offers FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS claimed_offers_insert ON claimed_offers;
CREATE POLICY claimed_offers_insert ON claimed_offers FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS claimed_offers_delete ON claimed_offers;
CREATE POLICY claimed_offers_delete ON claimed_offers FOR DELETE USING (user_id = auth.uid());
-- Favorites (user access)
DROP POLICY IF EXISTS favorites_select ON favorites;
CREATE POLICY favorites_select ON favorites FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS favorites_insert ON favorites;
CREATE POLICY favorites_insert ON favorites FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS favorites_delete ON favorites;
CREATE POLICY favorites_delete ON favorites FOR DELETE USING (user_id = auth.uid());
-- Ratings (public read, customer write)
DROP POLICY IF EXISTS ratings_select ON ratings;
CREATE POLICY ratings_select ON ratings FOR SELECT USING (true);
DROP POLICY IF EXISTS ratings_insert ON ratings;
CREATE POLICY ratings_insert ON ratings FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ratings.booking_id AND b.customer_id = auth.uid())
);
DROP POLICY IF EXISTS ratings_update ON ratings;
CREATE POLICY ratings_update ON ratings FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS ratings_delete ON ratings;
CREATE POLICY ratings_delete ON ratings FOR DELETE USING (user_id = auth.uid());
-- Tickets (creator access)
DROP POLICY IF EXISTS tickets_select ON tickets;
CREATE POLICY tickets_select ON tickets FOR SELECT USING (creator_id = auth.uid());
DROP POLICY IF EXISTS tickets_insert ON tickets;
CREATE POLICY tickets_insert ON tickets FOR INSERT WITH CHECK (creator_id = auth.uid());
DROP POLICY IF EXISTS tickets_update ON tickets;
CREATE POLICY tickets_update ON tickets FOR UPDATE USING (creator_id = auth.uid()) WITH CHECK (creator_id = auth.uid());
DROP POLICY IF EXISTS tickets_delete ON tickets;
CREATE POLICY tickets_delete ON tickets FOR DELETE USING (creator_id = auth.uid());
-- Ticket replies
DROP POLICY IF EXISTS ticket_replies_select ON ticket_replies;
CREATE POLICY ticket_replies_select ON ticket_replies FOR SELECT USING (
  sender_id = auth.uid()
  OR EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_replies.ticket_id AND t.creator_id = auth.uid())
);
DROP POLICY IF EXISTS ticket_replies_insert ON ticket_replies;
CREATE POLICY ticket_replies_insert ON ticket_replies FOR INSERT WITH CHECK (sender_id = auth.uid());
DROP POLICY IF EXISTS ticket_replies_update ON ticket_replies;
CREATE POLICY ticket_replies_update ON ticket_replies FOR UPDATE USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());
DROP POLICY IF EXISTS ticket_replies_delete ON ticket_replies;
CREATE POLICY ticket_replies_delete ON ticket_replies FOR DELETE USING (sender_id = auth.uid());
-- Settings (public read, auth update)
DROP POLICY IF EXISTS "Allow public read access to settings" ON settings;
CREATE POLICY "Allow public read access to settings" ON settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow authenticated users to update settings" ON settings;
CREATE POLICY "Allow authenticated users to update settings" ON settings FOR UPDATE USING (auth.role() = 'authenticated');
-- Analytics, audit_logs, config: no policies (blocked for clients);
