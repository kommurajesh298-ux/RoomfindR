import { test as setup } from '@playwright/test';
import { checkUrlReachable, INBUCKET_URL, isLocalUrl, loadE2eEnv, requireEnv } from '../helpers/e2e-config';

setup('global setup', async () => {
    console.log('Global setup: verifying environment...');

    loadE2eEnv();
    const missing = requireEnv([
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY'
    ]);
    if (missing.length > 0) {
        const msg = `Missing required env vars: ${missing.join(', ')}`;
        if (process.env.CI || process.env.E2E_STRICT_ENV === '1') {
            throw new Error(msg);
        }
        console.warn(`WARNING: ${msg}`);
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl && isLocalUrl(supabaseUrl)) {
        const healthUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`;
        const { ok, error } = await checkUrlReachable(healthUrl);
        if (!ok) {
            const extra = error ? ` (${error})` : '';
            throw new Error(
                `Supabase is not reachable at ${supabaseUrl}.${extra}\n` +
                'Start the local Supabase stack with `supabase start` (requires Docker) and retry.'
            );
        }
    }

    const otpSource = (process.env.E2E_OTP_SOURCE || '').toLowerCase();
    if (otpSource !== 'admin' && isLocalUrl(INBUCKET_URL)) {
        const mailboxUrl = `${INBUCKET_URL}/api/v1/mailbox`;
        const { ok } = await checkUrlReachable(mailboxUrl);
        if (!ok) {
            console.warn(
                `WARNING: Inbucket is not reachable at ${INBUCKET_URL}. ` +
                'OTP email polling may fail; start Supabase locally or set E2E_OTP_SOURCE=admin.'
            );
        }
    }

    // Future: Seed test database here if needed
    console.log('Global setup complete.');
});
