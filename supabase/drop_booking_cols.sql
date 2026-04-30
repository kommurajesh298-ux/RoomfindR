-- Drop redundant columns from bookings table
-- As requested, we are removing these because the ratings table handles this data
ALTER TABLE bookings DROP COLUMN IF EXISTS checked_in_at,
    DROP COLUMN IF EXISTS rating_popup_pending,
    DROP COLUMN IF EXISTS rating_submitted;