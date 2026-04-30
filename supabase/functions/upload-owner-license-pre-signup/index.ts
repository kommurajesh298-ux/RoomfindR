import {
  assertAllowedOrigin,
  errorResponse,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/http.ts";
import { fetchPreSignupLicenseDocument } from "../_shared/owner-license-document.ts";
import {
  normalizeEmail,
  normalizePhone,
  sha256Hex,
  validateEmail,
} from "../_shared/security.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const LICENSE_BUCKET = "documents";
const MAX_LICENSE_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_LICENSE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const sanitizeFilename = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const resolveFileExtension = (fileName: string, mimeType: string): string | null => {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (EXTENSION_BY_MIME_TYPE[normalizedMimeType]) {
    return EXTENSION_BY_MIME_TYPE[normalizedMimeType];
  }

  const sanitizedName = sanitizeFilename(fileName);
  const parts = sanitizedName.split(".");
  if (parts.length < 2) return null;

  const extension = parts.at(-1)?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "webp", "pdf"].includes(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }

  return null;
};

const resolveDocumentName = (fileName: string, extension: string): string => {
  const sanitizedName = sanitizeFilename(fileName);
  if (!sanitizedName) {
    return `license-document.${extension}`;
  }
  return sanitizedName.includes(".") ? sanitizedName : `${sanitizedName}.${extension}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  if (!assertAllowedOrigin(req)) {
    return errorResponse(req, 403, "Origin is not allowed", "origin_not_allowed");
  }

  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed", "method_not_allowed");
  }

  try {
    const formData = await req.formData();
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    const phone = normalizePhone(String(formData.get("phone") ?? ""));
    const name = String(formData.get("name") ?? "").trim();
    const file = formData.get("file");

    if (!validateEmail(email)) {
      return errorResponse(req, 400, "Invalid email format", "invalid_email");
    }

    if (!phone) {
      return errorResponse(req, 400, "Valid phone number is required", "invalid_phone");
    }

    if (!name) {
      return errorResponse(req, 400, "Name is required", "name_required");
    }

    if (!(file instanceof File)) {
      return errorResponse(req, 400, "License document is required", "license_file_required");
    }

    if (!file.size) {
      return errorResponse(req, 400, "Uploaded file is empty", "license_file_empty");
    }

    if (file.size > MAX_LICENSE_FILE_BYTES) {
      return errorResponse(
        req,
        400,
        "License document must be 5 MB or smaller.",
        "license_file_too_large",
      );
    }

    const mimeType = String(file.type || "").trim().toLowerCase();
    const extension = resolveFileExtension(file.name, mimeType);
    if ((!mimeType || !ALLOWED_LICENSE_MIME_TYPES.has(mimeType)) && !extension) {
      return errorResponse(
        req,
        400,
        "Upload a JPG, PNG, WEBP, or PDF license document.",
        "license_file_type_invalid",
      );
    }

    const normalizedExtension = extension || "pdf";
    const documentName = resolveDocumentName(file.name, normalizedExtension);
    const supabase = createServiceClient();

    const { data: existingUserId, error: existingUserError } = await supabase.rpc(
      "get_auth_user_id_by_email",
      { p_email: email },
    );
    if (existingUserError) throw existingUserError;

    if (existingUserId) {
      return errorResponse(req, 409, "Account already exists", "account_exists");
    }

    const existingDocument = await fetchPreSignupLicenseDocument(supabase, email);
    const emailHash = await sha256Hex(email);
    const objectPath =
      `owner-signup-licenses/${emailHash}/license-${Date.now()}.${normalizedExtension}`;

    const { error: uploadError } = await supabase.storage
      .from(LICENSE_BUCKET)
      .upload(objectPath, file, {
        contentType: mimeType || undefined,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from(LICENSE_BUCKET)
      .getPublicUrl(objectPath);

    const documentUrl = publicUrlData.publicUrl;
    const { data: documentRecord, error: upsertError } = await supabase
      .from("owner_signup_license_documents")
      .upsert(
        {
          email,
          phone,
          full_name: name,
          document_path: objectPath,
          document_url: documentUrl,
          document_name: documentName,
          mime_type: mimeType || null,
          file_size_bytes: file.size,
          consumed_at: null,
          owner_id: null,
        },
        { onConflict: "email" },
      )
      .select(
        "id, email, phone, full_name, document_path, document_url, document_name, mime_type, file_size_bytes, consumed_at, owner_id, created_at, updated_at",
      )
      .single();

    if (upsertError) {
      await supabase.storage.from(LICENSE_BUCKET).remove([objectPath]).catch(() => undefined);
      throw upsertError;
    }

    if (
      existingDocument?.document_path &&
      existingDocument.document_path !== objectPath
    ) {
      await supabase.storage
        .from(LICENSE_BUCKET)
        .remove([existingDocument.document_path])
        .catch(() => undefined);
    }

    return jsonResponse(req, {
      success: true,
      message: "License document uploaded successfully.",
      document: {
        id: documentRecord.id,
        document_url: documentRecord.document_url,
        document_name: documentRecord.document_name,
        mime_type: documentRecord.mime_type,
        file_size_bytes: documentRecord.file_size_bytes,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to upload license document";
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code: string }).code)
        : "license_upload_failed";

    return errorResponse(req, 500, message, code);
  }
});
