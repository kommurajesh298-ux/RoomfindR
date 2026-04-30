export type TestRole = 'customer' | 'owner' | 'admin';

export type TestIdentity = {
    role: TestRole;
    email: string;
    password: string;
    fullName: string;
    phone: string;
    city?: string;
};

const DEFAULT_PASSWORD = 'password123';
const DEFAULT_CITY = 'Bengaluru';

export const TEST_USERS: Record<TestRole, TestIdentity> = {
    customer: {
        role: 'customer',
        email: 'test_customer_e2e@example.com',
        password: DEFAULT_PASSWORD,
        fullName: 'RoomFindR Customer',
        phone: '+919111111111',
        city: DEFAULT_CITY,
    },
    owner: {
        role: 'owner',
        email: 'test_owner_e2e@example.com',
        password: DEFAULT_PASSWORD,
        fullName: 'RoomFindR Owner',
        phone: '+919222222222',
        city: DEFAULT_CITY,
    },
    admin: {
        role: 'admin',
        email: 'test_admin_e2e@example.com',
        password: DEFAULT_PASSWORD,
        fullName: 'RoomFindR Admin',
        phone: '+919333333333',
        city: DEFAULT_CITY,
    },
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const buildSeedDisplayName = (seed: string, fallback = 'RoomFindR User') => {
    const value = seed.split('@')[0]?.trim().replace(/[-_]+/g, ' ') || fallback;
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
};

export const buildSeedPhone = (seed: string) => {
    let hash = 0;
    const source = seed.trim().toLowerCase();

    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 131 + source.charCodeAt(index)) % 1_000_000_000;
    }

    return `+919${String(hash).padStart(9, '0')}`;
};

export const createRunSeed = (prefix = 'e2e') =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createUniqueEmail = (prefix: string, role: TestRole = 'customer') =>
    normalizeEmail(`${prefix}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`);

export const createTestIdentity = (
    prefix: string,
    role: TestRole,
    overrides: Partial<TestIdentity> = {},
): TestIdentity => {
    const email = normalizeEmail(overrides.email || createUniqueEmail(prefix, role));
    return {
        role,
        email,
        password: overrides.password || DEFAULT_PASSWORD,
        fullName: overrides.fullName || buildSeedDisplayName(email, `${role} user`),
        phone: overrides.phone || buildSeedPhone(`${role}:${email}`),
        city: overrides.city || DEFAULT_CITY,
    };
};
