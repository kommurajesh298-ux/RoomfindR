import { INBUCKET_URL } from './e2e-config';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

const OTP_REGEX = /\b(\d{6})\b/;

const mailboxForEmail = (email: string) => email.split('@')[0] || email;

export const clearMailbox = async (email: string) => {
    const mailbox = mailboxForEmail(email);
    try {
        await fetch(`${INBUCKET_URL}/api/v1/mailbox/${encodeURIComponent(mailbox)}`, { method: 'DELETE' });
    } catch {
        // Ignore failures (non-local runs)
    }
};

export const fetchLatestOtp = async (email: string, timeoutMs = 30000): Promise<string> => {
    const source = (process.env.E2E_OTP_SOURCE || '').toLowerCase();
    const fetchAdminOtp = async (): Promise<string | null> => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) return null;
        try {
            const admin = createClient(supabaseUrl, serviceKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const { data, error } = await admin.auth.admin.generateLink({
                type: 'magiclink',
                email,
            });
            if (error) return null;
            return data?.properties?.email_otp ?? null;
        } catch {
            return null;
        }
    };

    if (source === 'admin') {
        const adminOtp = await fetchAdminOtp();
        if (adminOtp) return adminOtp;
        throw new Error('OTP not available from admin API');
    }

    const mailbox = mailboxForEmail(email);
    const started = Date.now();
    let triedAdmin = false;
    const adminAfterMs = Number(process.env.E2E_OTP_ADMIN_AFTER_MS || 8000);

    while (Date.now() - started < timeoutMs) {
        try {
            const listRes = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${encodeURIComponent(mailbox)}`);
            if (listRes.ok) {
                const messages = await listRes.json() as Array<{ id: string; date?: string }>;
                if (messages.length > 0) {
                    const sorted = [...messages].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                    const messageId = sorted[0]?.id;
                    if (messageId) {
                        const msgRes = await fetch(`${INBUCKET_URL}/api/v1/message/${messageId}`);
                        if (msgRes.ok) {
                            const msg = await msgRes.json() as Record<string, unknown>;
                            const textCandidates = [
                                (msg as { subject?: string }).subject,
                                (msg as { text?: string }).text,
                                (msg as { html?: string }).html,
                                (msg as { body?: { text?: string; html?: string } }).body?.text,
                                (msg as { body?: { text?: string; html?: string } }).body?.html
                            ]
                                .filter(Boolean)
                                .join(' ');

                            const match = OTP_REGEX.exec(textCandidates);
                            if (match?.[1]) {
                                return match[1];
                            }
                        }
                    }
                }
            }
        } catch {
            // Ignore and retry
        }

        if (!triedAdmin && adminAfterMs > 0 && Date.now() - started > adminAfterMs) {
            triedAdmin = true;
            const adminOtp = await fetchAdminOtp();
            if (adminOtp) {
                return adminOtp;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    const adminOtp = await fetchAdminOtp();
    if (adminOtp) {
        return adminOtp;
    }

    throw new Error(`OTP not received for ${email} within ${timeoutMs / 1000}s`);
};

export const enterOtp = async (page: Page, otp: string) => {
    const digits = otp.replace(/\D/g, '');
    const otpInputs = page.locator('input[autocomplete="one-time-code"]');
    await otpInputs.first().waitFor({ state: 'visible', timeout: 15000 });
    const count = await otpInputs.count();

    if (count > 1) {
        await otpInputs.first().click();
        await page.keyboard.type(digits, { delay: 35 });
        return;
    }

    await otpInputs.first().fill(digits);
};
