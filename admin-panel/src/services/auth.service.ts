import { supabase } from './supabase-config';
import type { User, Session } from '@supabase/supabase-js';

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const normalizePhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;
    return tenDigits.length === 10 ? `+91${tenDigits}` : '';
};

type RoleQueryResult = {
    role: string | null;
    error: unknown;
};

const AUTH_STORAGE_KEY_PATTERNS = [
    /auth-token/i,
    /code-verifier/i,
    /^supabase\.auth\./i,
] as const;

const extractErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
        return [error.message, error.stack || ''].join(' ').trim();
    }

    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object') {
        try {
            const typed = error as { message?: string; error_description?: string };
            return String(typed.message || typed.error_description || JSON.stringify(error));
        } catch {
            return String(error);
        }
    }

    return String(error || '');
};

const isInvalidRefreshTokenError = (error: unknown) =>
    /invalid refresh token|refresh token not found/i.test(extractErrorMessage(error));

const isMissingSessionError = (error: unknown) =>
    /auth session missing|session missing/i.test(extractErrorMessage(error));

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

const repairCurrentProfile = async () => {
    try {
        const { error } = await supabase.rpc('repair_my_profile');
        if (error) {
            console.error('[adminAuth] Profile repair failed:', error);
            return false;
        }
        return true;
    } catch (error) {
        console.error('[adminAuth] Profile repair crashed:', error);
        return false;
    }
};

const fetchAccountRole = async (uid: string, repairIfMissing = true): Promise<RoleQueryResult> => {
    let { data, error } = await supabase
        .from('accounts')
        .select('role')
        .eq('id', uid)
        .maybeSingle();

    if (!error && !data?.role && repairIfMissing) {
        const repaired = await repairCurrentProfile();
        if (repaired) {
            const retry = await supabase
                .from('accounts')
                .select('role')
                .eq('id', uid)
                .maybeSingle();
            data = retry.data;
            error = retry.error;
        }
    }

    return {
        role: data?.role ?? null,
        error
    };
};

const recoverInvalidStoredSession = async (error: unknown) => {
    if (!isInvalidRefreshTokenError(error)) {
        return false;
    }

    clearAuthStorage();

    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch {
        // Best-effort local cleanup only.
    }

    return true;
};

const readCurrentSession = async (): Promise<Session | null> => {
    try {
        const {
            data: { session },
            error
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
            error
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
    signInWithEmail: async (email: string, password: string) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizeEmail(email),
            password
        });
        if (error) throw error;

        const { role, error: roleError } = await fetchAccountRole(data.user.id);

        if (roleError) {
            await supabase.auth.signOut({ scope: 'local' });
            clearAuthStorage();
            throw roleError;
        }

        if (role !== 'admin') {
            await supabase.auth.signOut({ scope: 'local' });
            clearAuthStorage();
            throw new Error('Unauthorized: Admin access only');
        }
        return data;
    },
    signOut: async () => {
        try {
            await supabase.auth.signOut();
        } finally {
            clearBrowserStorage();
        }
    },
    getCurrentSession: async (): Promise<Session | null> =>
        queueSessionOperation(readCurrentSession),
    refreshCurrentSession: async (): Promise<Session | null> =>
        queueSessionOperation(refreshCurrentSession),
    getCurrentUser: async (): Promise<User | null> => {
        const session = await authService.getCurrentSession();
        return session?.user ?? null;
    },
    onAuthChange: (callback: (user: User | null, session: Session | null) => void) => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { callback(session?.user ?? null, session); });
        return () => subscription.unsubscribe();
    },
    subscribeToAdminRole: (uid: string, callback: (role: string | null) => void) => {
        let isActive = true;
        let attempts = 0;
        const maxAttempts = 5;
        const retryTimers = new Set<ReturnType<typeof setTimeout>>();

        const scheduleRetry = (fn: () => void, delayMs: number) => {
            const timer = setTimeout(() => {
                retryTimers.delete(timer);
                fn();
            }, delayMs);
            retryTimers.add(timer);
        };

        const fetchRole = async () => {
            if (!isActive) return;

            const { role, error } = await fetchAccountRole(uid);

            if (!isActive) return;

            if (error) {
                attempts++;
                if (attempts < maxAttempts) {
                    scheduleRetry(fetchRole, 1000);
                    return;
                }
                console.error("Error fetching admin role:", error);
                callback(null);
                return;
            }

            if (!role) {
                attempts++;
                if (attempts < maxAttempts) {
                    scheduleRetry(fetchRole, 1000);
                    return;
                }
                callback(null);
                return;
            }

            callback(role);
        };

        void fetchRole();

        return () => {
            isActive = false;
            retryTimers.forEach((timer) => clearTimeout(timer));
            retryTimers.clear();
        };
    },
    checkAdminRole: async (uid: string): Promise<boolean> => {
        const { role } = await fetchAccountRole(uid, false);
        return role === 'admin';
    },
    checkPhoneExists: async (phone: string): Promise<boolean> => {
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) return false;
        const { data, error } = await supabase.rpc('check_user_exists', {
            phone_val: normalizedPhone,
            email_val: ''
        });
        if (error) return false;
        const result = data as { phoneExists: boolean; emailExists: boolean } | null;
        return result?.phoneExists ?? false;
    },
    checkEmailExists: async (email: string): Promise<boolean> => {
        const { data, error } = await supabase.rpc('check_user_exists', {
            phone_val: '',
            email_val: normalizeEmail(email)
        });
        if (error) return false;
        const result = data as { phoneExists: boolean; emailExists: boolean } | null;
        return result?.emailExists ?? false;
    }
};

