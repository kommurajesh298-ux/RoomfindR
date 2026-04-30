-- ==========================================
-- 🛡️ STORAGE & DOCUMENT SHIELD (v8.7)
-- Ensures owner documents can be uploaded
-- ==========================================
-- 1. Create Bucket (if missing)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true) ON CONFLICT (id) DO NOTHING;
-- 2. Clear Old Policies
DROP POLICY IF EXISTS "Owners can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Owners can view own documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all documents" ON storage.objects;
-- 3. Apply Storage Policies
-- Policy: Owners can upload to their own folder (owner_id/filename)
CREATE POLICY "Owners can upload documents" ON storage.objects FOR
INSERT TO authenticated WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name)) [1] = auth.uid()::text
    );
-- Policy: Owners can view their own folder
CREATE POLICY "Owners can view own documents" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'documents'
        AND (storage.foldername(name)) [1] = auth.uid()::text
    );
-- Policy: Admins can view everything
CREATE POLICY "Admins can view all documents" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'documents'
        AND (
            (auth.jwt()->'user_metadata'->>'role') = 'admin'
            OR (
                auth.jwt()->>'email' IN (
                    SELECT email
                    FROM public.admins
                )
            )
        )
    );