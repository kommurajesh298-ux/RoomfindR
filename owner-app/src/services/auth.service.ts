import { publicSupabase, supabase } from "./supabase-config";
import type { Session, User } from "@supabase/supabase-js";

type AuthErrorMeta = {
  code?: string;
  status?: number;
};

const userExistsCheckSupport = {
  available: null as boolean | null,
  warnedMissing: false,
};

type OwnerSignupVerificationPayload = {
  email: string;
  otp: string;
  password: string;
  role: "owner";
  name: string;
  phone: string;
  transferId?: string | null;
};

type OwnerLicensePreSignupPayload = {
  email: string;
  phone: string;
  name: string;
  file: File;
};

type OwnerBankPreSignupPayload = {
  name?: string;
  email: string;
  phone?: string;
  accountHolderName?: string;
  accountNumber?: string;
  confirmAccountNumber?: string;
  ifsc?: string;
  transferId?: string | null;
  statusOnly?: boolean;
};

type ResetVerificationPayload = {
  email: string;
  otp: string;
  new_password: string;
};

type PasswordChangeVerificationPayload = {
  email: string;
  otp: string;
  new_password: string;
};

const buildAuthError = (message: string, meta?: AuthErrorMeta) => {
  const error = new Error(message) as Error & AuthErrorMeta;
  if (meta?.code) error.code = meta.code;
  if (meta?.status) error.status = meta.status;
  return error;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const looksLikeJwt = (value: string) => value.split(".").length === 3;

const normalizePhone = (phone: string) => {
  const digits = phone.replaceAll(/\D/g, "");
  const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;
  return tenDigits.length === 10 ? `+91${tenDigits}` : "";
};

const noteMissingCheckUserExistsRpc = () => {
  if (import.meta.env.DEV && !userExistsCheckSupport.warnedMissing) {
    userExistsCheckSupport.warnedMissing = true;
    console.warn(
      "[authService] check_user_exists RPC is unavailable on this backend. Skipping owner pre-signup uniqueness checks.",
    );
  }
};

const AUTH_STORAGE_KEY_PATTERNS = [
  /auth-token/i,
  /code-verifier/i,
  /^supabase\.auth\./i,
] as const;

const extractErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return [error.message, error.stack || ""].join(" ").trim();
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    try {
      const typed = error as { message?: string; error_description?: string };
      return String(typed.message || typed.error_description || JSON.stringify(error));
    } catch {
      return String(error);
    }
  }

  return String(error || "");
};

const isInvalidRefreshTokenError = (error: unknown) =>
  /invalid refresh token|refresh token not found/i.test(extractErrorMessage(error));

const isMissingSessionError = (error: unknown) =>
  /auth session missing|session missing/i.test(extractErrorMessage(error));

const clearAuthStorage = () => {
  const clearMatchingKeys = (storage?: Storage) => {
    if (!storage) return;

    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key));

    keys.forEach((key) => {
      if (AUTH_STORAGE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        storage.removeItem(key);
      }
    });
  };

  try {
    clearMatchingKeys(globalThis.localStorage);
  } catch {
    // Ignore storage access failures in restricted environments.
  }

  try {
    clearMatchingKeys(globalThis.sessionStorage);
  } catch {
    // Ignore storage access failures in restricted environments.
  }
};

const clearBrowserStorage = () => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    // Ignore storage clear failures in restricted environments.
  }

  try {
    globalThis.sessionStorage?.clear();
  } catch {
    // Ignore storage clear failures in restricted environments.
  }
};

const extractFunctionError = async (error: unknown, fallback: string) => {
  const err = error as {
    message?: string;
    name?: string;
    context?: Response;
  };

  let message = err?.message || fallback;
  let status: number | undefined;
  let code: string | undefined = err?.name;

  if (err?.context) {
    status = err.context.status;
    try {
      const payload = await err.context.clone().json();
      const apiMessage = payload?.error?.message || payload?.message;
      const apiCode = payload?.error?.code;
      if (typeof apiMessage === "string" && apiMessage.trim()) {
        message = apiMessage;
      }
      if (typeof apiCode === "string" && apiCode.trim()) {
        code = apiCode;
      }
    } catch {
      // Ignore invalid JSON responses.
    }
  }

  return buildAuthError(message, { status, code });
};

const invokeEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown> | FormData,
) => {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    throw await extractFunctionError(error, "Request failed");
  }

  const payload = data as {
    success?: boolean;
    error?: { message?: string; code?: string };
  };

  if (payload?.error?.message) {
    throw buildAuthError(payload.error.message, { code: payload.error.code });
  }

  return data as T;
};

const invokePublicEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown> | FormData,
) => {
  const { data, error } = await publicSupabase.functions.invoke(name, { body });

  if (error) {
    throw await extractFunctionError(error, "Request failed");
  }

  const payload = data as {
    success?: boolean;
    error?: { message?: string; code?: string };
  };

  if (payload?.error?.message) {
    throw buildAuthError(payload.error.message, { code: payload.error.code });
  }

  return data as T;
};

const repairCurrentProfile = async () => {
  try {
    const { error } = await supabase.rpc("repair_my_profile");
    if (error) {
      console.error("[authService] Owner profile repair failed:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[authService] Owner profile repair crashed:", error);
    return false;
  }
};

const recoverInvalidStoredSession = async (error: unknown) => {
  if (!isInvalidRefreshTokenError(error)) {
    return false;
  }

  clearAuthStorage();

  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Best-effort local cleanup only.
  }

  return true;
};

export const authService = {
  recoverInvalidStoredSession,

  requestEmailOtp: async (
    email: string,
    options?: {
      role?: "owner" | "customer";
      phone?: string;
      transferId?: string | null;
      shouldCreateUser?: boolean;
      metadata?: {
        name?: string;
        phone?: string;
        role?: string;
        account_holder_name?: string;
        bank_details?: Record<string, unknown>;
      };
    },
  ) => {
    const normalizedPhone = options?.phone ? normalizePhone(options.phone) : "";
    if (options?.role === "owner" && !normalizedPhone) {
      throw buildAuthError("Please enter a valid 10-digit phone number.");
    }

    return invokePublicEdgeFunction<{
      success: boolean;
      message: string;
    }>("send-signup-email-otp", {
      email: normalizeEmail(email),
      ...(options?.role ? { role: options.role } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(options?.transferId ? { transferId: options.transferId } : {}),
    });
  },

  verifyOwnerBankPreSignup: async (payload: OwnerBankPreSignupPayload) => {
    const normalizedPhone = payload.phone ? normalizePhone(payload.phone) : "";
    if (!payload.statusOnly && !normalizedPhone) {
      throw buildAuthError("Please enter a valid 10-digit phone number.");
    }

    return invokePublicEdgeFunction<{
      success: boolean;
      message?: string;
      verification?: {
        transfer_status?: "pending" | "success" | "failed";
        status_message?: string;
      };
      transfer_id?: string | null;
      already_verified?: boolean;
    }>("verify-owner-bank-pre-signup", {
      ...(payload.name ? { name: payload.name.trim() } : {}),
      email: normalizeEmail(payload.email),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(payload.accountHolderName
        ? { accountHolderName: payload.accountHolderName }
        : {}),
      ...(payload.accountNumber ? { accountNumber: payload.accountNumber } : {}),
      ...(payload.confirmAccountNumber
        ? { confirmAccountNumber: payload.confirmAccountNumber }
        : {}),
      ...(payload.ifsc ? { ifsc: payload.ifsc } : {}),
      ...(payload.transferId ? { transferId: payload.transferId } : {}),
      ...(payload.statusOnly ? { statusOnly: true } : {}),
    });
  },

  uploadOwnerLicensePreSignup: async (payload: OwnerLicensePreSignupPayload) => {
    const normalizedPhone = normalizePhone(payload.phone);
    if (!normalizedPhone) {
      throw buildAuthError("Please enter a valid 10-digit phone number.");
    }

    if (!payload.name.trim()) {
      throw buildAuthError("Please enter your full name.");
    }

    const formData = new FormData();
    formData.set("email", normalizeEmail(payload.email));
    formData.set("phone", normalizedPhone);
    formData.set("name", payload.name.trim());
    formData.set("file", payload.file);

    return invokePublicEdgeFunction<{
      success: boolean;
      message?: string;
      document?: {
        id: string;
        document_url: string;
        document_name?: string | null;
        mime_type?: string | null;
        file_size_bytes?: number | null;
      };
    }>("upload-owner-license-pre-signup", formData);
  },

  verifyEmailOtp: async (payload: OwnerSignupVerificationPayload) => {
    const normalizedPhone = normalizePhone(payload.phone);
    if (!normalizedPhone) {
      throw buildAuthError("Please enter a valid 10-digit phone number.");
    }

    return invokePublicEdgeFunction<{
      success: boolean;
      user_id: string;
      role: "owner";
      account_status: "active" | "blocked" | "pending_admin_approval";
    }>("verify-signup-email-otp", {
      ...payload,
      email: normalizeEmail(payload.email),
      phone: normalizedPhone,
      role: "owner",
      ...(payload.transferId ? { transferId: payload.transferId } : {}),
    });
  },

  sendPasswordResetOtp: async (email: string) => {
    return invokeEdgeFunction<{
      success: boolean;
      message: string;
    }>("send-password-reset-otp", {
      email: normalizeEmail(email),
    });
  },

  requestPasswordChangeOtp: async (email: string) => {
    return authService.sendPasswordResetOtp(email);
  },

  verifyPasswordResetOtp: async (payload: ResetVerificationPayload) => {
    return invokeEdgeFunction<{
      success: boolean;
      message: string;
    }>("verify-password-reset-otp", {
      email: normalizeEmail(payload.email),
      otp: payload.otp,
      new_password: payload.new_password,
    });
  },

  updatePasswordWithOtp: async (payload: PasswordChangeVerificationPayload) => {
    return authService.verifyPasswordResetOtp({
      email: payload.email,
      otp: payload.otp,
      new_password: payload.new_password,
    });
  },

  signInWithEmail: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error) throw error;
    return data;
  },

  signOut: async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } finally {
      clearBrowserStorage();
    }
  },

  resetPassword: async (email: string) => authService.sendPasswordResetOtp(email),

  updatePassword: async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  getCurrentSession: async (): Promise<Session | null> => {
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      const accessToken = session?.access_token;
      if (accessToken && !looksLikeJwt(accessToken)) {
        clearAuthStorage();

        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // Best-effort local cleanup only.
        }

        return null;
      }

      return session;
    } catch (error) {
      if (await recoverInvalidStoredSession(error)) {
        return null;
      }
      if (isMissingSessionError(error)) {
        return null;
      }
      throw error;
    }
  },

  getCurrentUser: async (): Promise<User | null> => {
    const session = await authService.getCurrentSession();
    return session?.user ?? null;
  },

  updateUserProfile: async (updates: {
    name?: string;
    avatar_url?: string;
  }) => {
    const { error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;
  },

  onAuthChange: (
    callback: (user: User | null, session: Session | null) => void,
  ) => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null, session);
    });
    return () => subscription.unsubscribe();
  },

  getUserRole: async (uid: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from("accounts")
      .select("role")
      .eq("id", uid)
      .maybeSingle();
    if (error) return null;
    return data?.role || null;
  },

  getAccountStatus: async (
    uid: string,
  ): Promise<"active" | "blocked" | "pending_admin_approval" | null> => {
    const { data, error } = await supabase
      .from("accounts")
      .select("account_status")
      .eq("id", uid)
      .maybeSingle();

    if (error) return null;
    return (data?.account_status as
      | "active"
      | "blocked"
      | "pending_admin_approval"
      | null) ?? null;
  },

  checkPhoneExists: async (phone: string): Promise<boolean> => {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return false;

    if (userExistsCheckSupport.available === false) {
      noteMissingCheckUserExistsRpc();
      return false;
    }

    const { data, error } = await supabase.rpc("check_user_exists", {
      phone_val: normalizedPhone,
      email_val: "",
    });

    if (error) {
      const message = String(error.message || "");
      if (
        error.code === "PGRST202" ||
        /check_user_exists/i.test(message) && /not found|does not exist|Could not find/i.test(message)
      ) {
        userExistsCheckSupport.available = false;
        noteMissingCheckUserExistsRpc();
        return false;
      }
      return false;
    }

    userExistsCheckSupport.available = true;
    const result = data as unknown as { phoneExists?: boolean };
    return result?.phoneExists ?? false;
  },

  checkEmailExists: async (email: string): Promise<boolean> => {
    if (userExistsCheckSupport.available === false) {
      noteMissingCheckUserExistsRpc();
      return false;
    }

    const { data, error } = await supabase.rpc("check_user_exists", {
      phone_val: "",
      email_val: normalizeEmail(email),
    });

    if (error) {
      const message = String(error.message || "");
      if (
        error.code === "PGRST202" ||
        /check_user_exists/i.test(message) && /not found|does not exist|Could not find/i.test(message)
      ) {
        userExistsCheckSupport.available = false;
        noteMissingCheckUserExistsRpc();
        return false;
      }
      return false;
    }

    userExistsCheckSupport.available = true;
    const result = data as unknown as { emailExists?: boolean };
    return result?.emailExists ?? false;
  },

  subscribeToAccountRole: (
    uid: string,
    callback: (role: string | null) => void,
  ) => {
    let isActive = true;

    const fetchRole = async (allowRepair = true): Promise<string | null> => {
      if (!isActive) return null;

      try {
        const { data, error } = await supabase
          .from("accounts")
          .select("role")
          .eq("id", uid)
          .maybeSingle();

        if (!isActive) return null;

        if (error) {
          console.error("[authService] Unable to fetch owner role:", error);
          if (allowRepair && (await repairCurrentProfile())) {
            return fetchRole(false);
          }
          return null;
        }

        const role = data?.role || null;
        if (!role && allowRepair && (await repairCurrentProfile())) {
          return fetchRole(false);
        }

        return role;
      } catch (error) {
        console.error("[authService] Owner role bootstrap failed:", error);
        if (allowRepair && (await repairCurrentProfile())) {
          return fetchRole(false);
        }
        return null;
      }
    };

    void fetchRole().then((role) => {
      if (!isActive) return;
      callback(role ?? null);
    });

    return () => {
      isActive = false;
    };
  },
};
