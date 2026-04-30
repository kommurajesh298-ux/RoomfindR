import { normalizeEmail } from "./security.ts";

export type PreSignupLicenseDocument = {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  document_path: string;
  document_url: string;
  document_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  consumed_at: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

const PRE_SIGNUP_LICENSE_SELECT = [
  "id",
  "email",
  "phone",
  "full_name",
  "document_path",
  "document_url",
  "document_name",
  "mime_type",
  "file_size_bytes",
  "consumed_at",
  "owner_id",
  "created_at",
  "updated_at",
].join(", ");

export const fetchPreSignupLicenseDocument = async (
  supabase: any,
  email: string,
): Promise<PreSignupLicenseDocument | null> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const { data, error } = await supabase
    .from("owner_signup_license_documents")
    .select(PRE_SIGNUP_LICENSE_SELECT)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return (data as PreSignupLicenseDocument | null) || null;
};

export const syncPreSignupLicenseDocumentContact = async (
  supabase: any,
  document: PreSignupLicenseDocument | null,
  input: {
    phone?: string | null;
    fullName?: string | null;
  },
): Promise<PreSignupLicenseDocument | null> => {
  if (!document?.id) return document;

  const nextPhone = input.phone?.trim() || null;
  const nextFullName = input.fullName?.trim() || null;
  const updates: Record<string, string | null> = {};

  if ((document.phone || null) !== nextPhone && nextPhone) {
    updates.phone = nextPhone;
  }

  if ((document.full_name || null) !== nextFullName && nextFullName) {
    updates.full_name = nextFullName;
  }

  if (!Object.keys(updates).length) {
    return document;
  }

  const { data, error } = await supabase
    .from("owner_signup_license_documents")
    .update(updates)
    .eq("id", document.id)
    .select(PRE_SIGNUP_LICENSE_SELECT)
    .single();

  if (error) throw error;
  return data as PreSignupLicenseDocument;
};

export const markPreSignupLicenseDocumentConsumed = async (
  supabase: any,
  documentId: string,
  ownerId: string,
) => {
  const { error } = await supabase
    .from("owner_signup_license_documents")
    .update({
      consumed_at: new Date().toISOString(),
      owner_id: ownerId,
    })
    .eq("id", documentId);

  if (error) throw error;
};
