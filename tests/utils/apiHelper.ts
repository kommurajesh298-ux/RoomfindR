import { createHmac } from 'node:crypto';
import { SupabaseAdminHelper } from '../helpers/supabase-admin';
import { TEST_USERS, type TestIdentity, type TestRole } from '../data/test-users';

let adminHelper: SupabaseAdminHelper | null = null;

export const getAdminHelper = () => {
    adminHelper ??= new SupabaseAdminHelper();
    return adminHelper;
};

export const runCleanupSafely = async (task: () => Promise<unknown>, timeoutMs = 30000) => {
    await Promise.race([
        Promise.resolve().then(task).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
};

export const ensureTestIdentity = async (identity: TestIdentity) => {
    const admin = getAdminHelper();
    const user = await admin.createTestUser(identity.email, identity.password, identity.role);

    if (!user?.id) {
        return null;
    }

    if (identity.role === 'customer') {
        await admin.ensureCustomerProfile(user.id, identity.email);
    }

    if (identity.role === 'owner') {
        await admin.ensureOwnerVerified(user.id, identity.email);
    }

    if (identity.role === 'admin') {
        await admin.supabase.from('admins').upsert({
            id: user.id,
            name: identity.fullName,
            email: identity.email,
            updated_at: new Date().toISOString(),
        });
    }

    return user;
};

export const seedCoreAutomationUsers = async () => {
    await ensureTestIdentity(TEST_USERS.customer);
    await ensureTestIdentity(TEST_USERS.owner);
    await ensureTestIdentity(TEST_USERS.admin);
};

export const cleanupIdentity = async (identity: Pick<TestIdentity, 'email' | 'role'>) => {
    const admin = getAdminHelper();
    if (identity.role === 'customer') {
        await runCleanupSafely(() => admin.cleanupUserBookings(identity.email));
        await runCleanupSafely(() => admin.supabase.from('customers').delete().eq('email', identity.email));
    }

    if (identity.role === 'owner') {
        await runCleanupSafely(() => admin.cleanupOwnerBookings(identity.email));
        await runCleanupSafely(() => admin.cleanupOwnerProperties(identity.email));
        await runCleanupSafely(() => admin.cleanupSettlements(identity.email));

        const user = await admin.findUserByEmail(identity.email);
        if (user?.id) {
            await runCleanupSafely(() => admin.cleanupOwnerVerificationArtifacts(user.id));
            await runCleanupSafely(() => admin.supabase.from('owner_bank_accounts').delete().eq('owner_id', user.id).then(() => undefined));
            await runCleanupSafely(() => admin.supabase.from('owners').delete().eq('id', user.id).then(() => undefined));
        }
    }

    if (identity.role === 'admin') {
        await runCleanupSafely(() => admin.supabase.from('admins').delete().eq('email', identity.email));
    }

    await runCleanupSafely(() => admin.supabase.from('accounts').delete().eq('email', identity.email));
    await runCleanupSafely(() => admin.deleteTestUser(identity.email));
};

export const signPaymentStatusToken = (input: {
    bookingId?: string;
    orderId?: string;
    app: 'customer' | 'owner' | 'admin';
    paymentType?: 'booking' | 'monthly';
    month?: string;
    expiresInSeconds?: number;
}) => {
    const secret = String(
        process.env.PAYMENT_STATUS_TOKEN_SECRET
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
        || '',
    ).trim();

    if (!secret) {
        throw new Error('Missing payment status token secret for automation tests.');
    }

    const payload = {
        bookingId: input.bookingId,
        orderId: input.orderId,
        app: input.app,
        paymentType: input.paymentType || 'booking',
        month: input.month,
        exp: Math.floor(Date.now() / 1000) + Math.max(input.expiresInSeconds || 900, 60),
    };

    const payloadSegment = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureSegment = createHmac('sha256', secret)
        .update(payloadSegment)
        .digest('base64url');

    return `${payloadSegment}.${signatureSegment}`;
};

export const roleBaseUrl = (role: TestRole) => {
    if (role === 'owner') return 'http://127.0.0.1:5174';
    if (role === 'admin') return 'http://127.0.0.1:5175';
    return 'http://127.0.0.1:5173';
};
