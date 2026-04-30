import { supabase } from './supabase-config';

export interface UserData {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: 'customer' | 'owner' | 'admin';
    created_at?: string;
}

type AccountRow = {
    id: string;
    email: string | null;
    role: string | null;
    created_at?: string | null;
    name?: string | null;
    full_name?: string | null;
    fullName?: string | null;
    phone?: string | null;
    phone_number?: string | null;
};

type ProfileRow = {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
};

const normalizeUserRole = (role: string | null | undefined): UserData['role'] =>
    role === 'owner' || role === 'admin' ? role : 'customer';

const fallbackNameFromEmail = (email: string | null | undefined) => {
    const localPart = String(email || '').split('@')[0]?.trim();
    return localPart || 'User';
};

const mapAccountToUser = (account: AccountRow): UserData => ({
    id: account.id,
    name: account.name || account.full_name || account.fullName || fallbackNameFromEmail(account.email),
    email: account.email || 'N/A',
    phone: account.phone || account.phone_number || 'N/A',
    role: normalizeUserRole(account.role),
    created_at: account.created_at ?? undefined
});

const mergeProfileIntoUser = (
    existing: UserData,
    profile: ProfileRow,
    role: Extract<UserData['role'], 'owner' | 'customer'>
): UserData => ({
    ...existing,
    name: profile.name || existing.name,
    email: profile.email || existing.email,
    phone: profile.phone || existing.phone,
    role
});

export const userService = {
    getAllUsers: async (): Promise<UserData[]> => {
        // 1. Fetch from accounts
        const { data: accounts, error: accountsError } = await supabase
            .from('accounts')
            .select('id, email, role, created_at, phone')
            .order('created_at', { ascending: false });

        if (accountsError) throw accountsError;

        // 2. Fetch from owners
        const { data: owners } = await supabase
            .from('owners')
            .select('id, name, email, phone');

        // 3. Fetch from customers
        const { data: customers } = await supabase
            .from('customers')
            .select('id, name, email, phone');

        const map = new Map<string, UserData>();

        accounts?.forEach((account) => {
            map.set(account.id, mapAccountToUser(account));
        });

        owners?.forEach((owner) => {
            const existing = map.get(owner.id);
            if (existing) {
                map.set(owner.id, mergeProfileIntoUser(existing, owner, 'owner'));
            }
        });

        customers?.forEach((customer) => {
            const existing = map.get(customer.id);
            if (existing) {
                if (existing.role !== 'owner') {
                    map.set(customer.id, mergeProfileIntoUser(existing, customer, 'customer'));
                }
            }
        });

        return Array.from(map.values());
    },

    getUserById: async (id: string): Promise<UserData | null> => {
        const { data: account, error } = await supabase
            .from('accounts')
            .select('id, email, role, created_at, phone')
            .eq('id', id)
            .single();

        if (error || !account) return null;

        let details: ProfileRow | null = null;
        if (account.role === 'owner') {
            const { data } = await supabase.from('owners').select('id, name, email, phone').eq('id', id).single();
            details = data;
        } else if (account.role === 'customer') {
            const { data } = await supabase.from('customers').select('id, name, email, phone').eq('id', id).single();
            details = data;
        }

        const user = mapAccountToUser(account);
        if (!details) {
            return user;
        }

        const detailRole: Extract<UserData['role'], 'owner' | 'customer'> =
            account.role === 'owner' ? 'owner' : 'customer';

        return mergeProfileIntoUser(user, details, detailRole);
    }
};
