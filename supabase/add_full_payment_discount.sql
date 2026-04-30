-- Migration to add Full Payment Discount support to properties
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS full_payment_discount JSONB DEFAULT NULL;
-- Description: 
-- This column stores configuration for automatic discounts applied when a user 
-- pays the full amount upfront for a minimum stay (e.g., 3 months).
-- Example JSON structure:
-- {
--   "active": true,
--   "amount": 10,
--   "type": "percentage",
--   "minMonths": 3
-- }