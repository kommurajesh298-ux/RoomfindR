-- ==========================================
-- 🛡️ ATOMIC STORAGE SHIELD (v8.8)
-- Fixes Document Visibility & Permissions
-- ==========================================
-- 1. Ensure Bucket is Private
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false) ON CONFLICT (id) DO
UPDATE
SET public = false;
-- 2. RESET POLICIES (Simpler, more robust)
DROP POLICY IF EXISTS "Owners can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Owners can view own documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all documents" ON storage.objects;
DROP POLICY IF EXISTS "Give users access to own folder" ON storage.objects;
-- Allow only owners to upload to their own folder, admins can read everything
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