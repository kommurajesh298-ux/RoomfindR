-- Migration script to create Tickets table and remove legacy Chat tables
-- 1. Create Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    property_id UUID REFERENCES properties(id) ON DELETE
    SET NULL,
        sender_name TEXT,
        sender_email TEXT,
        sender_phone TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Create Ticket Replies Table
CREATE TABLE IF NOT EXISTS ticket_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 3. Enable RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;
-- 4. Policies for Tickets
DROP POLICY IF EXISTS "Users can view own tickets" ON tickets;
CREATE POLICY "Users can view own tickets" ON tickets FOR
SELECT USING (
        auth.uid() = creator_id
        OR is_admin()
    );
DROP POLICY IF EXISTS "Users can create own tickets" ON tickets;
CREATE POLICY "Users can create own tickets" ON tickets FOR
INSERT WITH CHECK (auth.uid() = creator_id);
DROP POLICY IF EXISTS "Users can update own tickets" ON tickets;
CREATE POLICY "Users can update own tickets" ON tickets FOR
UPDATE USING (auth.uid() = creator_id);
DROP POLICY IF EXISTS "Admins can manage all tickets" ON tickets;
CREATE POLICY "Admins can manage all tickets" ON tickets FOR ALL USING (is_admin());
-- 5. Policies for Ticket Replies
DROP POLICY IF EXISTS "Users can view replies to own tickets" ON ticket_replies;
CREATE POLICY "Users can view replies to own tickets" ON ticket_replies FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM tickets
            WHERE tickets.id = ticket_replies.ticket_id
                AND (
                    tickets.creator_id = auth.uid()
                    OR is_admin()
                )
        )
    );
DROP POLICY IF EXISTS "Users can reply to own tickets" ON ticket_replies;
CREATE POLICY "Users can reply to own tickets" ON ticket_replies FOR
INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM tickets
            WHERE tickets.id = ticket_replies.ticket_id
                AND (
                    tickets.creator_id = auth.uid()
                    OR is_admin()
                )
        )
    );
-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_creator_id ON tickets(creator_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id);
-- 7. Trigger for updated_at
CREATE TRIGGER update_tickets_updated_at BEFORE
UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- Optional: Comment out legacy tables (DANGEROUS: Backup first!)
-- DROP TABLE IF EXISTS messages;
-- DROP TABLE IF EXISTS chats;