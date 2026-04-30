import { supabase } from './supabase-config';
import {
    createSafeRealtimeChannelCleanup,
    deferRealtimeSubscription,
} from './realtime-subscription';
import { favoritesService } from './favorites.service';
import { authService } from './auth.service';

export interface UserData {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: 'customer' | 'owner' | 'admin';
    location: { city: string; };
    profilePhotoUrl?: string;
    createdAt: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    notificationPreferences?: {
        bookingUpdates: boolean;
        ownerMessages: boolean;
        offersDiscounts: boolean;
        menuUpdates?: boolean;
    };
    language?: string;
    status?: 'active' | 'blocked';
}

export interface UserPreferences {
    location?: { city: string };
    notificationPreferences?: {
        bookingUpdates: boolean;
        ownerMessages: boolean;
        offersDiscounts: boolean;
        menuUpdates?: boolean;
    };
    language?: string;
    status?: 'active' | 'blocked';
}

const DEFAULT_NOTIFICATION_PREFERENCES = {
    bookingUpdates: true,
    ownerMessages: true,
    offersDiscounts: true,
};

const normalizeNotificationPreferences = (
    preferences?: UserData['notificationPreferences'] | UserPreferences['notificationPreferences'],
) => ({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(preferences || {}),
    bookingUpdates: true,
    ownerMessages: true,
    offersDiscounts: true,
});

const customerSchemaSupport = {
    preferences: null as boolean | null,
    avatarUrl: null as boolean | null,
    accountStatus: null as boolean | null,
};

const hasOwn = (value: unknown, key: string) =>
    Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

const syncCustomerSchemaSupportFromRow = (row: unknown) => {
    if (!row || typeof row !== 'object') return;
    customerSchemaSupport.preferences = hasOwn(row, 'preferences');
    customerSchemaSupport.avatarUrl = hasOwn(row, 'avatar_url');
};

const hasMissingColumnError = (message: string, column: 'preferences' | 'avatar_url' | 'account_status') =>
    new RegExp(`column.*${column}`, 'i').test(message) ||
    new RegExp(`Could not find the '${column}' column`, 'i').test(message);

const isDuplicateCustomerError = (code?: string, message?: string) =>
    code === '23505' || /duplicate key value/i.test(message || '');

const normalizePhone = (p: string) => {
    if (!p) return '';
    const digits = p.replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const buildLegacyCustomerPayload = (
    id: string,
    userData: Omit<UserData, 'id' | 'createdAt' | 'role'>,
) => ({
    id,
    name: userData.name,
    email: userData.email.toLowerCase().trim(),
    phone: normalizePhone(userData.phone),
    city: userData.location?.city || null,
});

const upsertLegacyCustomerRecord = async (
    id: string,
    userData: Omit<UserData, 'id' | 'createdAt' | 'role'>,
) => {
    const legacyPayload = buildLegacyCustomerPayload(id, userData);
    const { error: legacyError } = await supabase
        .from('customers')
        .upsert(legacyPayload, { onConflict: 'id' });

    if (!legacyError) return;

    if (isDuplicateCustomerError(legacyError.code, legacyError.message)) {
        const { error: updateError } = await supabase
            .from('customers')
            .update({
                name: legacyPayload.name,
                email: legacyPayload.email,
                phone: legacyPayload.phone,
                city: legacyPayload.city,
            })
            .eq('id', id);

        if (!updateError) return;
        throw updateError;
    }

    throw legacyError;
};

const upsertCustomerAccountRecord = async (
    id: string,
    email: string,
    phone: string,
) => {
    const accountPayload: Record<string, unknown> = {
        id,
        email,
        phone,
        role: 'customer',
        updated_at: new Date().toISOString(),
    };

    if (customerSchemaSupport.accountStatus !== false) {
        accountPayload.account_status = 'active';
    }

    const { error } = await supabase
        .from('accounts')
        .upsert(accountPayload, { onConflict: 'id' });

    if (!error) return;

    const message = error.message || '';
    if (hasMissingColumnError(message, 'account_status')) {
        customerSchemaSupport.accountStatus = false;
        const { error: fallbackError } = await supabase
            .from('accounts')
            .upsert({
                id,
                email,
                phone,
                role: 'customer',
                updated_at: accountPayload.updated_at,
            }, { onConflict: 'id' });

        if (!fallbackError) return;
        throw fallbackError;
    }

    throw error;
};

export const userService = {
    createUserDocument: async (id: string, userData: Omit<UserData, 'id' | 'createdAt' | 'role'>) => {
        const normalizedPhone = normalizePhone(userData.phone);
        const normalizedEmail = userData.email.toLowerCase().trim();
        const basePayload: Record<string, unknown> = {
            id,
            name: userData.name,
            email: normalizedEmail,
            phone: normalizedPhone,
        };

        if (customerSchemaSupport.avatarUrl === true) {
            basePayload.avatar_url = userData.profilePhotoUrl || null;
        }
        if (customerSchemaSupport.preferences === true) {
            basePayload.preferences = {
                location: userData.location,
                notificationPreferences: normalizeNotificationPreferences(userData.notificationPreferences),
                language: userData.language || 'en',
                status: 'active'
            };
        }

        const { error: customerError } = await supabase
            .from('customers')
            .upsert(basePayload, { onConflict: 'id' });
        if (customerError) {
            const message = customerError.message || '';
            if (hasMissingColumnError(message, 'preferences')) {
                customerSchemaSupport.preferences = false;
            }
            if (hasMissingColumnError(message, 'avatar_url')) {
                customerSchemaSupport.avatarUrl = false;
            }
            if (customerError.code === 'PGRST204' || /column.*(preferences|avatar_url|preferences)/i.test(message)) {
                await upsertLegacyCustomerRecord(id, userData);
            } else if (isDuplicateCustomerError(customerError.code, message)) {
                await userService.updateUserProfile(id, {
                    name: userData.name,
                    email: normalizedEmail,
                    phone: normalizedPhone,
                    location: userData.location,
                    profilePhotoUrl: userData.profilePhotoUrl,
                    language: userData.language,
                    notificationPreferences: userData.notificationPreferences,
                    status: userData.status,
                });
            } else {
                throw customerError;
            }
        }
        await upsertCustomerAccountRecord(id, normalizedEmail, normalizedPhone);
    },

    getUserDocument: async (id: string): Promise<UserData | null> => {
        const { data, error } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
        if (error) {
            // Handle common error codes gracefully
            if (error.code === 'PGRST116' || error.code === 'PGRST301') return null;
            console.error('Error fetching user document:', error);
            return null; // Return null instead of throwing to prevent app crashes
        }
        if (!data) {
            try {
                const repaired = await authService.tryRepairCurrentProfile();
                if (repaired) {
                    const retry = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
                    if (retry.data) {
                        syncCustomerSchemaSupportFromRow(retry.data);
                        return {
                            id: retry.data.id,
                            name: retry.data.name,
                            email: retry.data.email,
                            phone: retry.data.phone,
                            role: 'customer',
                            location: { city: (retry.data as { city?: string }).city || '' },
                            profilePhotoUrl: (retry.data as { avatar_url?: string }).avatar_url,
                            createdAt: retry.data.created_at,
                            emailVerified: false,
                            phoneVerified: false,
                            notificationPreferences: normalizeNotificationPreferences((retry.data as { preferences?: UserPreferences }).preferences?.notificationPreferences),
                            language: (retry.data as { preferences?: UserPreferences }).preferences?.language,
                            status: (retry.data as { preferences?: UserPreferences }).preferences?.status || 'active'
                        } as UserData;
                    }
                }
            } catch (repairCrash) {
                console.error('Customer profile repair failed:', repairCrash);
            }
            return null;
        }
        syncCustomerSchemaSupportFromRow(data);
        const preferences = (data as { preferences?: UserPreferences }).preferences || {};
        return {
            id: data.id,
            name: data.name,
            email: data.email,
            phone: data.phone,
            role: 'customer',
            location: preferences.location || { city: (data as { city?: string }).city || '' },
            profilePhotoUrl: (data as { avatar_url?: string }).avatar_url,
            createdAt: data.created_at,
            emailVerified: false,
            phoneVerified: false,
            notificationPreferences: normalizeNotificationPreferences(preferences.notificationPreferences),
            language: preferences.language,
            status: preferences.status || 'active'
        } as UserData;
    },

    updateUserProfile: async (id: string, updates: Partial<UserData>) => {
        const supabaseUpdates: Record<string, unknown> = {};
        if (updates.name !== undefined) supabaseUpdates.name = updates.name;
        if (updates.email !== undefined) supabaseUpdates.email = updates.email.toLowerCase().trim();
        if (updates.phone !== undefined) supabaseUpdates.phone = normalizePhone(updates.phone);
        if (updates.profilePhotoUrl !== undefined && customerSchemaSupport.avatarUrl === true) {
            supabaseUpdates.avatar_url = updates.profilePhotoUrl;
        }

        const needsPreferenceUpdate = Boolean(updates.location || updates.notificationPreferences || updates.language || updates.status);
        if (needsPreferenceUpdate && customerSchemaSupport.preferences === true) {
            const current = await userService.getUserDocument(id);
            supabaseUpdates.preferences = {
                ...(current ? { location: current.location, notificationPreferences: normalizeNotificationPreferences(current.notificationPreferences), language: current.language, status: current.status } : {}),
                ...(updates.location && { location: updates.location }),
                notificationPreferences: normalizeNotificationPreferences(updates.notificationPreferences),
                ...(updates.language && { language: updates.language }),
                ...(updates.status && { status: updates.status })
            };
        }

        if (needsPreferenceUpdate && updates.location?.city) {
            supabaseUpdates.city = updates.location.city;
        }

        if (Object.keys(supabaseUpdates).length === 0) {
            return;
        }

        const { error } = await supabase.from('customers').update(supabaseUpdates).eq('id', id);
        if (!error) return;

        const message = error.message || '';
        if (hasMissingColumnError(message, 'preferences')) {
            customerSchemaSupport.preferences = false;
        }
        if (hasMissingColumnError(message, 'avatar_url')) {
            customerSchemaSupport.avatarUrl = false;
        }
        if (error.code === 'PGRST204' || /column.*(preferences|avatar_url|preferences)/i.test(message)) {
            // Fallback for legacy schema without preferences/avatar_url
            const legacyUpdates: Record<string, unknown> = {};
            if (updates.name !== undefined) legacyUpdates.name = updates.name;
            if (updates.email !== undefined) legacyUpdates.email = updates.email.toLowerCase().trim();
            if (updates.phone !== undefined) legacyUpdates.phone = normalizePhone(updates.phone);
            if (updates.location?.city) legacyUpdates.city = updates.location.city;

            const { error: legacyError } = await supabase
                .from('customers')
                .upsert({ id, ...legacyUpdates }, { onConflict: 'id' });
            if (legacyError) throw legacyError;
            return;
        }

        throw error;
    },

    uploadProfilePhoto: async (id: string, file: File): Promise<string> => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${id}-${Date.now()}.${fileExt}`;
        const filePath = `${id}/${fileName}`;
        const { error: uploadError } = await supabase.storage.from('profile-photos').upload(filePath, file, { cacheControl: '3600', upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
        const publicUrl = urlData.publicUrl;
        await userService.updateUserProfile(id, { profilePhotoUrl: publicUrl } as Partial<UserData>);
        await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
        return publicUrl;
    },

    updatePassword: async (_currentPassword: string, newPassword: string) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
    },

    getFavorites: async (userId: string): Promise<string[]> => {
        return favoritesService.getFavorites(userId);
    },

    toggleFavorite: async (userId: string, propertyId: string): Promise<boolean> => {
        return favoritesService.toggleFavorite(userId, propertyId);
    },

    updateAuthEmail: async (email: string) => {
        const { error } = await supabase.auth.updateUser({ email });
        if (error) throw error;
    },

    updateNotificationPreferences: async (id: string, prefs: UserData['notificationPreferences']) => {
        await userService.updateUserProfile(id, { notificationPreferences: normalizeNotificationPreferences(prefs) } as Partial<UserData>);
    },

    updateLanguage: async (id: string, lang: string) => {
        await userService.updateUserProfile(id, { language: lang } as Partial<UserData>);
    },

    subscribeToUserDocument: (id: string, callback: (userData: UserData | null) => void) => {
        userService.getUserDocument(id).then(callback).catch((error) => {
            console.error('Customer subscription bootstrap failed:', error);
            callback(null);
        });
        const unsubscribeRealtime = deferRealtimeSubscription(() => {
            const channel = supabase.channel(`user-changes-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `id=eq.${id}` }, async () => {
                try {
                    callback(await userService.getUserDocument(id));
                } catch (error) {
                    console.error('Customer subscription refresh failed:', error);
                    callback(null);
                }
            });
            const safeCleanup = createSafeRealtimeChannelCleanup(channel);
            channel.subscribe((status) => {
                safeCleanup.handleStatus(status);
            });
            return safeCleanup.cleanup;
        });
        return () => { unsubscribeRealtime(); };
    },
};
