import { supabase } from "./supabase-config";
import type { Session, User } from "@supabase/supabase-js";

type AuthErrorMeta = {
  code?: string;
  status?: number;
};

type RpcErrorLike = {
  code?: string;
  message?: string;
  status?: number;
};

type SignupVerificationPayload = {
  email: string;
  otp: string;
  password: string;
  role: "customer" | "owner";
  name: string;
  phone: string;
  city?: string;
  account_holder_name?: string;
  bank_details?: {
    bankName?: string;
    ifscCode?: string;
    accountNumber?: string;
  };
};

type PasswordResetVerificationPayload = {
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

const normalizePhone = (phone: string) => {
  const digits = phone.replaceAll(/\D/g, "");
  const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;
  return tenDigits.length === 10 ? `+91${tenDigits}` : "";
};

const profileRepairSupport = {
  available: null as boolean | null,
  warnedMissing: false,
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

const isMissingProfileRepairError = (
  error: RpcErrorLike | (AuthErrorMeta & { message?: string }) | null | undefined,
) => {
  const message = String(error?.message || "");
  return error?.code === "PGRST202" ||
    error?.status === 404 ||
    /repair_my_profile/i.test(message) && (
      /Could not find the function/i.test(message) ||
      /not found/i.test(message) ||
      /does not exist/i.test(message)
    );
};

const invokeEdgeFunction = async <T>(name: string, body: Record<string, unknown>) => {
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

const getRoleSpecificTable = (role: string | null) => {
  if (role === "customer") return "customers";
  if (role === "owner") return "owners";
  if (role === "admin") return "admins";
  return null;
};

const detectCustomerRoleFallback = async (id: string) => {
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data ? "customer" : null;
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

const extractStoredSession = (value: unknown): Session | null => {
  const candidates = Array.isArray(value)
    ? value
    : [
        value,
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).currentSession
          : null,
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).session
          : null,
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).data
          : null,
      ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    const session = candidate as Session & {
      user?: { id?: string };
      access_token?: string;
    };

    if (
      typeof session.access_token === "string" ||
      typeof session.user?.id === "string"
    ) {
      return session as Session;
    }
  }

  return null;
};

const parseStoredSession = (raw: string | null): Session | null => {
  if (!raw) return null;

  try {
    return extractStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
};

const getCachedSessionSnapshot = (): Session | null => {
  const storages = [globalThis.localStorage, globalThis.sessionStorage].filter(
    Boolean,
  ) as Storage[];

  for (const storage of storages) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) =>
        storage.key(index),
      ).filter((key): key is string => Boolean(key));

      for (const key of keys) {
        if (!/auth-token/i.test(key)) continue;

        const session = parseStoredSession(storage.getItem(key));
        if (session) {
          return session;
        }
      }
    } catch {
      // Ignore restricted storage access.
    }
  }

  return null;
};

let sessionOperationChain: Promise<void> = Promise.resolve();

const queueSessionOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = sessionOperationChain
    .catch(() => undefined)
    .then(operation);

  sessionOperationChain = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
};

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

  if (import.meta.env.DEV) {
    console.warn("[authService] Cleared stale Supabase session after invalid refresh token.");
  }

  return true;
};

const repairCurrentProfile = async () => {
  if (profileRepairSupport.available === false) {
    return false;
  }

  try {
    const { error } = await supabase.rpc("repair_my_profile");
    if (error) {
      if (isMissingProfileRepairError(error)) {
        profileRepairSupport.available = false;
        if (import.meta.env.DEV && !profileRepairSupport.warnedMissing) {
          profileRepairSupport.warnedMissing = true;
          console.warn("[authService] repair_my_profile RPC is unavailable on this backend. Skipping profile repair.");
        }
        return false;
      }
      profileRepairSupport.available = true;
      console.error("[authService] Profile repair failed:", error);
      return false;
    }
    profileRepairSupport.available = true;
    return true;
  } catch (error) {
    if (isMissingProfileRepairError(error as AuthErrorMeta & { message?: string })) {
      profileRepairSupport.available = false;
      if (import.meta.env.DEV && !profileRepairSupport.warnedMissing) {
        profileRepairSupport.warnedMissing = true;
        console.warn("[authService] repair_my_profile RPC is unavailable on this backend. Skipping profile repair.");
      }
      return false;
    }
    console.error("[authService] Profile repair crashed:", error);
    return false;
  }
};

const readCurrentSession = async (): Promise<Session | null> => {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
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
};

const refreshCurrentSession = async (): Promise<Session | null> => {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.refreshSession();

    if (error) {
      throw error;
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
};

export const authService = {
  recoverInvalidStoredSession,
  tryRepairCurrentProfile: repairCurrentProfile,

  requestEmailOtp: async (
    email: string,
    options?: {
      role?: "owner" | "customer";
      phone?: string;
      shouldCreateUser?: boolean;
      metadata?: {
        name?: string;
        phone?: string;
        role?: string;
        city?: string;
      };
    },
  ) => {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = options?.phone ? normalizePhone(options.phone) : "";

    return invokeEdgeFunction<{
      success: boolean;
      message: string;
    }>("send-signup-email-otp", {
      email: normalizedEmail,
      ...(options?.role ? { role: options.role } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    });
  },

  verifyEmailOTP: async (payload: SignupVerificationPayload) => {
    const normalizedEmail = normalizeEmail(payload.email);
    const normalizedPhone = normalizePhone(payload.phone);

    if (!normalizedPhone) {
      throw buildAuthError("Please enter a valid 10-digit phone number.");
    }

    return invokeEdgeFunction<{
      success: boolean;
      user_id: string;
      role: "customer" | "owner";
      account_status: "active" | "blocked" | "pending_admin_approval";
    }>("verify-signup-email-otp", {
      ...payload,
      email: normalizedEmail,
      phone: normalizedPhone,
    });
  },

  sendPasswordResetOtp: async (email: string) => {
    const normalizedEmail = normalizeEmail(email);

    return invokeEdgeFunction<{
      success: boolean;
      message: string;
    }>("send-password-reset-otp", {
      email: normalizedEmail,
    });
  },

  verifyPasswordResetOtp: async (payload: PasswordResetVerificationPayload) => {
    const normalizedEmail = normalizeEmail(payload.email);

    return invokeEdgeFunction<{
      success: boolean;
      message: string;
    }>("verify-password-reset-otp", {
      email: normalizedEmail,
      otp: payload.otp,
      new_password: payload.new_password,
    });
  },

  signInWithEmail: async (email: string, password: string) => {
    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
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

  resetPassword: async (email: string) => {
    return authService.sendPasswordResetOtp(email);
  },

  updatePassword: async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  getCurrentUser: async (): Promise<User | null> => {
    const session = await authService.getCurrentSession();
    return session?.user ?? null;
  },

  getCachedCurrentUser: (): User | null =>
    getCachedSessionSnapshot()?.user ?? null,

  getCurrentSession: async (): Promise<Session | null> =>
    queueSessionOperation(readCurrentSession),

  refreshCurrentSession: async (): Promise<Session | null> =>
    queueSessionOperation(refreshCurrentSession),

  updateUserProfile: async (updates: {
    name?: string;
    avatar_url?: string;
  }) => {
    const { error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;
  },

  checkEmailExists: async (email: string) => {
    const { data, error } = await supabase.rpc("check_user_exists", {
      email_val: normalizeEmail(email),
      phone_val: null,
    });

    if (error) {
      return {
        emailExists: false,
        emailInPublic: false,
        isGhost: false,
        isFullyRegistered: false,
      };
    }

    const emailExists = Boolean((data as { emailExists?: boolean })?.emailExists);
    return {
      emailExists,
      emailInPublic: emailExists,
      isGhost: false,
      isFullyRegistered: emailExists,
    };
  },

  checkPhoneExists: async (phone: string) => {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return {
        phoneExists: false,
        phoneInPublic: false,
        isGhost: false,
        isFullyRegistered: false,
      };
    }

    const { data, error } = await supabase.rpc("check_user_exists", {
      email_val: null,
      phone_val: normalizedPhone,
    });

    if (error) {
      return {
        phoneExists: false,
        phoneInPublic: false,
        isGhost: false,
        isFullyRegistered: false,
      };
    }

    const phoneExists = Boolean((data as { phoneExists?: boolean })?.phoneExists);
    return {
      phoneExists,
      phoneInPublic: phoneExists,
      isGhost: false,
      isFullyRegistered: phoneExists,
    };
  },

  onAuthChange: (
    callback: (user: User | null, session: Session | null) => void,
  ) => {
    const pendingTimers = new Set<number>();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer app-side auth work so Supabase can release its internal auth lock
      // before React state updates, profile fetches, or sign-out flows begin.
      const timer = window.setTimeout(() => {
        pendingTimers.delete(timer);
        callback(session?.user ?? null, session);
      }, 0);
      pendingTimers.add(timer);
    });
    return () => {
      pendingTimers.forEach((timer) => window.clearTimeout(timer));
      pendingTimers.clear();
      subscription.unsubscribe();
    };
  },

  subscribeToAccountRole: (
    id: string,
    callback: (role: string | null) => void,
  ) => {
    let isActive = true;

    const fetchRole = async (allowRepair = true): Promise<string | null> => {
      if (!isActive) return null;

      try {
        const { data, error } = await supabase
          .from("accounts")
          .select("role")
          .eq("id", id)
          .maybeSingle();

        if (!isActive) return null;

        if (error) {
          console.error("[authService] Unable to fetch account role:", error);
          if (allowRepair && (await repairCurrentProfile())) {
            return fetchRole(false);
          }
          return null;
        }

        const role = data?.role ?? null;
        const table = getRoleSpecificTable(role);
        if (!role || !table) {
          if (!role) {
            const fallbackRole = await detectCustomerRoleFallback(id);
            if (fallbackRole) {
              return fallbackRole;
            }
          }
          if (!role && allowRepair && (await repairCurrentProfile())) {
            return fetchRole(false);
          }
          return role;
        }

        const { data: roleRow, error: roleRowError } = await supabase
          .from(table)
          .select("id")
          .eq("id", id)
          .maybeSingle();

        if (!isActive) return null;

        if (roleRowError) {
          console.error("[authService] Unable to verify role document:", roleRowError);
          if (allowRepair && (await repairCurrentProfile())) {
            return fetchRole(false);
          }
          return null;
        }

        if (!roleRow && allowRepair && (await repairCurrentProfile())) {
          return fetchRole(false);
        }

        return roleRow ? role : null;
      } catch (error) {
        console.error("[authService] Role subscription bootstrap failed:", error);
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

  getUserRole: async (id: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from("accounts")
      .select("role")
      .eq("id", id)
      .maybeSingle();

    if (error) return null;
    return data?.role ?? null;
  },

  getAccountStatus: async (
    id: string,
  ): Promise<"active" | "blocked" | "pending_admin_approval" | null> => {
    const { data, error } = await supabase
      .from("accounts")
      .select("account_status")
      .eq("id", id)
      .maybeSingle();

    if (error) return null;
    return (data?.account_status as
      | "active"
      | "blocked"
      | "pending_admin_approval"
      | null) ?? null;
  },
};
