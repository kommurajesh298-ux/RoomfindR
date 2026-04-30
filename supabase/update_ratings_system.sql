-- Migration script for Real-time Rating Popup System
-- 1. Update properties table
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0;
-- 2. Update bookings table
-- Note: We need to drop and recreate the status constraint to include 'checked_in' and other active statuses
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings
ADD CONSTRAINT bookings_status_check CHECK (
        status IN (
            'pending',
            'requested',
            'approved',
            'accepted',
            'rejected',
            'cancelled',
            'completed',
            'checked_in',
            'checked-in',
            'checked_out',
            'checked-out'
        )
    );
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rating_popup_pending BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rating_submitted BOOLEAN DEFAULT FALSE;
-- 3. Create ratings table
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (
        rating >= 1
        AND rating <= 5
    ),
    review TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(booking_id) -- Only one rating per booking
);
-- 4. Create trigger to update property ratings automatically
CREATE OR REPLACE FUNCTION update_property_rating() RETURNS TRIGGER AS $$ BEGIN
UPDATE properties
SET avg_rating = (
        SELECT COALESCE(AVG(rating), 0)::NUMERIC(3, 2)
        FROM ratings
        WHERE property_id = NEW.property_id
    ),
    total_ratings = (
        SELECT COUNT(*)
        FROM ratings
        WHERE property_id = NEW.property_id
    )
WHERE id = NEW.property_id;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS after_rating_insert ON ratings;
CREATE TRIGGER after_rating_insert
AFTER
INSERT ON ratings FOR EACH ROW EXECUTE FUNCTION update_property_rating();
-- Handle rating deletions too
CREATE OR REPLACE FUNCTION update_property_rating_on_delete() RETURNS TRIGGER AS $$ BEGIN
UPDATE properties
SET avg_rating = (
        SELECT COALESCE(AVG(rating), 0)::NUMERIC(3, 2)
        FROM ratings
        WHERE property_id = OLD.property_id
    ),
    total_ratings = (
        SELECT COUNT(*)
        FROM ratings
        WHERE property_id = OLD.property_id
    )
WHERE id = OLD.property_id;
RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS after_rating_delete ON ratings;
CREATE TRIGGER after_rating_delete
AFTER DELETE ON ratings FOR EACH ROW EXECUTE FUNCTION update_property_rating_on_delete();
-- 5. RLS Policies for ratings
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read ratings" ON ratings;
CREATE POLICY "Anyone can read ratings" ON ratings FOR
SELECT USING (true);
DROP POLICY IF EXISTS "Customers can create ratings for their own bookings" ON ratings;
CREATE POLICY "Customers can create ratings for their own bookings" ON ratings FOR
INSERT WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1
            FROM bookings
            WHERE id = booking_id
                AND customer_id = auth.uid()
                AND status = 'checked_in'
        )
    );