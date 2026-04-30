-- ==========================================
-- 🧪 FRONTEND TEST: DOCUMENT INJECTION
-- Links high-quality sample docs to your owners
-- ==========================================
-- 1. Update RAVI KUMAR with a sample license
UPDATE public.owners
SET verification_documents = ARRAY ['https://images.unsplash.com/photo-1589330694653-ded6df03f754?q=80&w=1000&auto=format&fit=crop'],
    verification_status = 'pending'
WHERE name ILIKE '%RAVI%';
-- 2. Update KommuRajesh with a sample license
UPDATE public.owners
SET verification_documents = ARRAY ['https://images.unsplash.com/photo-1633158829585-23ba8f7c9caf?q=80&w=1000&auto=format&fit=crop'],
    verification_status = 'pending'
WHERE name ILIKE '%Kommu%';
-- 3. FINAL VERIFICATION (Check the table below)
SELECT name,
    verification_status,
    verification_documents
FROM public.owners;