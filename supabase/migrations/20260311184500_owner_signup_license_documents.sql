CREATE TABLE IF NOT EXISTS public.owner_signup_license_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  phone TEXT,
  full_name TEXT,
  document_path TEXT NOT NULL,
  document_url TEXT NOT NULL,
  document_name TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  consumed_at TIMESTAMPTZ,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT owner_signup_license_documents_file_size_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_signup_license_documents_email_uidx
  ON public.owner_signup_license_documents (email);

CREATE INDEX IF NOT EXISTS owner_signup_license_documents_owner_idx
  ON public.owner_signup_license_documents (owner_id);

CREATE INDEX IF NOT EXISTS owner_signup_license_documents_consumed_idx
  ON public.owner_signup_license_documents (consumed_at, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_owner_signup_license_documents_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_signup_license_documents_updated_at
  ON public.owner_signup_license_documents;

CREATE TRIGGER trg_owner_signup_license_documents_updated_at
BEFORE UPDATE ON public.owner_signup_license_documents
FOR EACH ROW
EXECUTE FUNCTION public.set_owner_signup_license_documents_updated_at();

ALTER TABLE public.owner_signup_license_documents ENABLE ROW LEVEL SECURITY;
