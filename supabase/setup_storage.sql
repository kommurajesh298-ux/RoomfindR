-- =============================================================================
-- STORAGE BUCKETS SETUP
-- =============================================================================
-- 1. Create property-images bucket (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true) ON CONFLICT (id) DO NOTHING;
-- 2. Create profile-photos bucket (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true) ON CONFLICT (id) DO NOTHING;
-- 3. Create documents bucket (Private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;
-- =============================================================================
-- STORAGE POLICIES
-- =============================================================================
-- POLICIES FOR property-images
DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;
CREATE POLICY "Public Read Access" ON storage.objects FOR
SELECT USING (bucket_id = 'property-images');
DROP POLICY IF EXISTS "Authenticated Upload Access" ON storage.objects;
CREATE POLICY "Authenticated Upload Access" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'property-images'
        AND auth.role() = 'authenticated'
    );
-- POLICIES FOR profile-photos
DROP POLICY IF EXISTS "Profile Photo Public Read" ON storage.objects;
CREATE POLICY "Profile Photo Public Read" ON storage.objects FOR
SELECT USING (bucket_id = 'profile-photos');
DROP POLICY IF EXISTS "Profile Photo Auth Upload" ON storage.objects;
CREATE POLICY "Profile Photo Auth Upload" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'profile-photos'
        AND auth.role() = 'authenticated'
    );
-- POLICIES FOR documents (Owner Licenses/Proof)
-- Owners can upload to their own folder, Admins can read everything
DROP POLICY IF EXISTS "Owners can upload documents" ON storage.objects;
CREATE POLICY "Owners can upload documents" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'documents'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name)) [1] = auth.uid()::text
    );
DROP POLICY IF EXISTS "Owners can view own documents" ON storage.objects;
CREATE POLICY "Owners can view own documents" ON storage.objects FOR
SELECT USING (
        bucket_id = 'documents'
        AND (
            auth.uid()::text = (storage.foldername(name)) [1]
            OR (
                EXISTS (
                    SELECT 1
                    FROM accounts
                    WHERE id = auth.uid()
                        AND role = 'admin'
                )
            )
        )
    );