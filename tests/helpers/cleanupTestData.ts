import type { TestRole } from '../data/test-users';
import { SupabaseAdminHelper } from './supabase-admin';

type CleanupUser = {
    email: string;
    role: TestRole;
    deleteAuthUser?: boolean;
    cleanupBookings?: boolean;
    cleanupProperties?: boolean;
    cleanupSettlements?: boolean;
};

export type CleanupRequest = {
    users?: CleanupUser[];
};

const deleteRoleRows = async (admin: SupabaseAdminHelper, role: TestRole, userId: string) => {
    if (role === 'customer') {
        await admin.supabase.from('customers').delete().eq('id', userId);
        return;
    }

    if (role === 'owner') {
        await admin.cleanupOwnerVerificationArtifacts(userId);
        await admin.supabase.from('owners').delete().eq('id', userId);
        return;
    }

    await admin.supabase.from('admins').delete().eq('id', userId);
};

export const cleanupTestData = async (admin: SupabaseAdminHelper, request: CleanupRequest) => {
    for (const user of request.users || []) {
        if (user.cleanupBookings !== false) {
            if (user.role === 'owner') {
                await admin.cleanupOwnerBookings(user.email);
            } else {
                await admin.cleanupUserBookings(user.email);
            }
        }

        if (user.cleanupProperties && user.role === 'owner') {
            await admin.cleanupOwnerProperties(user.email);
        }

        if (user.cleanupSettlements && user.role === 'owner') {
            await admin.cleanupSettlements(user.email);
        }

        if (!user.deleteAuthUser) {
            continue;
        }

        const authUser = await admin.findUserByEmail(user.email);
        if (!authUser?.id) {
            continue;
        }

        await deleteRoleRows(admin, user.role, authUser.id);
        await admin.supabase.from('accounts').delete().eq('id', authUser.id);
        await admin.deleteTestUser(user.email);
    }
};
