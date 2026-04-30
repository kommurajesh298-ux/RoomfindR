import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'node:path';
import { TEST_USERS } from './test-data';
import { resolveSupabaseEnv } from './supabase-auth';
import { isRetryableSupabaseNetworkError, withSupabaseAdminRetry } from './supabase-auth-retry';

const buildSeedDisplayName = (email?: string, fallback = 'User') => {
    const base = (email || '').split('@')[0]?.trim();
    return base || fallback;
};

const buildCashfreeSafeDisplayName = (email?: string, fallback = 'Owner') => {
    const base = buildSeedDisplayName(email, fallback)
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!base) {
        return fallback;
    }

    return base.replace(/\b\w/g, (char) => char.toUpperCase());
};

const buildSeedPhone = (seed: string) => {
    let hash = 0;
    const source = seed.trim().toLowerCase();
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash * 131 + source.charCodeAt(i)) % 1_000_000_000;
    }

    return `+919${String(hash).padStart(9, '0')}`;
};

const buildStableDigits = (seed: string, length: number) => {
    let hash = 0;
    const source = seed.trim().toLowerCase();
    const modulus = 10 ** Math.min(length, 12);
    for (let i = 0; i < source.length; i += 1) {
        hash = (hash * 131 + source.charCodeAt(i)) % modulus;
    }

    const digits = String(hash).padStart(length, '0');
    return digits.replace(/^0/, '1');
};

const buildSeedBankAccountNumber = (seed: string) =>
    buildStableDigits(`bank:${seed}`, 12);

const buildSeedBankAccountHash = (seed: string) =>
    `e2e-bank-hash-${buildStableDigits(`hash:${seed}`, 12)}`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const useRemote = process.env.E2E_USE_REMOTE_SUPABASE === '1';
if (useRemote) {
    dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    dotenv.config({ path: path.resolve(__dirname, '../../supabase/.env') });
} else {
    dotenv.config({ path: path.resolve(__dirname, '../../supabase/.env'), override: true });
    dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

export class SupabaseAdminHelper {
    public readonly supabase: SupabaseClient;
    private readonly tableAvailability = new Map<string, boolean>();

    constructor(options?: { supabaseUrl?: string; serviceKey?: string }) {
        const resolved = resolveSupabaseEnv(options?.supabaseUrl);
        const supabaseUrl = options?.supabaseUrl || resolved.supabaseUrl;
        const serviceKey = options?.serviceKey || resolved.serviceKey;

        if (!supabaseUrl || !serviceKey) {
            throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
        }

        this.supabase = createClient(supabaseUrl, serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
    }

    private isMissingTableError(error: unknown) {
        const code = String((error as { code?: string } | null)?.code || '').trim();
        const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
        return code === 'PGRST205'
            || code === '42P01'
            || message.includes('schema cache')
            || message.includes('could not find the table')
            || message.includes('does not exist');
    }

    private isSchemaMismatchError(error: unknown) {
        const code = String((error as { code?: string } | null)?.code || '').trim();
        const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
        return this.isMissingTableError(error)
            || code === 'PGRST204'
            || message.includes('column')
            || message.includes('schema cache')
            || message.includes('not-null')
            || message.includes('check constraint')
            || message.includes('invalid input value');
    }

    private async hasTable(tableName: string) {
        if (this.tableAvailability.has(tableName)) {
            return this.tableAvailability.get(tableName) === true;
        }

        const { error } = await this.supabase
            .from(tableName)
            .select('*', { head: true, count: 'exact' })
            .limit(1);

        const exists = !error || !this.isMissingTableError(error);
        this.tableAvailability.set(tableName, exists);
        return exists;
    }

    private async getOwnerVerificationTableName() {
        if (await this.hasTable('owner_signup_bank_verifications')) {
            return 'owner_signup_bank_verifications';
        }

        if (await this.hasTable('owner_bank_verification')) {
            return 'owner_bank_verification';
        }

        return null;
    }

    private async getOwnerVerificationHistoryTableName() {
        if (await this.hasTable('owner_bank_verification_history')) {
            return 'owner_bank_verification_history';
        }

        return null;
    }

    private async ensureOwnerProfileForForeignKeys(ownerId: string, email?: string) {
        try {
            if (email?.trim()) {
                await this.ensureOwnerProfile(ownerId, email);
                return;
            }

            const { data: account } = await this.supabase
                .from('accounts')
                .select('email')
                .eq('id', ownerId)
                .maybeSingle();

            await this.ensureOwnerProfile(ownerId, String(account?.email || '').trim().toLowerCase() || undefined);
        } catch {
            // Best-effort profile hydration for older hosted schemas.
        }
    }

    async upsertOwnerBankAccountRecord(input: {
        ownerId: string;
        accountHolderName: string;
        accountNumber: string;
        accountNumberLast4?: string | null;
        accountNumberHash?: string | null;
        ifsc: string;
        bankName?: string | null;
        branchName?: string | null;
        city?: string | null;
        cashfreeBeneficiaryId?: string | null;
        verified?: boolean;
        bankVerificationStatus?: string | null;
        verificationMethod?: string | null;
        updatedAt?: string;
    }) {
        await this.ensureOwnerProfileForForeignKeys(input.ownerId);

        if (!await this.hasTable('owner_bank_accounts')) {
            return null;
        }

        const payload = {
            owner_id: input.ownerId,
            account_holder_name: input.accountHolderName,
            account_number: input.accountNumber,
            account_number_last4: input.accountNumberLast4 || null,
            account_number_hash: input.accountNumberHash || null,
            ifsc: input.ifsc,
            bank_name: input.bankName || null,
            branch_name: input.branchName || null,
            city: input.city || null,
            cashfree_beneficiary_id: input.cashfreeBeneficiaryId || null,
            verified: input.verified ?? false,
            bank_verification_status: input.bankVerificationStatus || null,
            verification_method: input.verificationMethod || null,
            updated_at: input.updatedAt || new Date().toISOString(),
        };

        const { error } = await this.supabase
            .from('owner_bank_accounts')
            .upsert(payload, { onConflict: 'owner_id' });
        if (error && !this.isMissingTableError(error)) {
            throw error;
        }

        return payload;
    }

    async upsertOwnerVerificationRecord(input: {
        ownerId: string;
        email?: string;
        phone?: string;
        accountHolderName: string;
        bankAccountNumber: string;
        bankAccountLast4?: string;
        bankAccountHash?: string;
        ifscCode: string;
        bankName?: string;
        branchName?: string;
        city?: string;
        beneficiaryId?: string | null;
        transferAmount?: number;
        transferReferenceId: string;
        providerReferenceId?: string;
        transferStatus: 'pending' | 'success' | 'failed';
        statusMessage?: string;
        lastAttemptAt?: string | null;
        verifiedAt?: string | null;
        createdAt?: string;
        updatedAt?: string;
    }) {
        await this.ensureOwnerProfileForForeignKeys(input.ownerId, input.email);

        const tableName = await this.getOwnerVerificationTableName();
        if (!tableName) {
            return null;
        }

        const now = input.updatedAt || new Date().toISOString();
        if (tableName === 'owner_bank_verification') {
            const payload = {
                owner_id: input.ownerId,
                bank_account_number: input.bankAccountNumber,
                ifsc_code: input.ifscCode,
                account_holder_name: input.accountHolderName,
                transfer_amount: input.transferAmount ?? 1,
                transfer_reference_id: input.transferReferenceId,
                provider_reference_id: input.providerReferenceId || null,
                transfer_status: input.transferStatus,
                status_message: input.statusMessage || null,
                last_attempt_at: input.lastAttemptAt || now,
                verified_at: input.verifiedAt || null,
                updated_at: now,
            };

            const { data: existing, error: existingError } = await this.supabase
                .from(tableName)
                .select('id')
                .eq('owner_id', input.ownerId)
                .maybeSingle();
            if (existingError) throw existingError;

            if (existing?.id) {
                const { error: updateError } = await this.supabase
                    .from(tableName)
                    .update(payload)
                    .eq('id', existing.id);
                if (updateError) throw updateError;
                return { tableName, id: String(existing.id) };
            }

            const { data: inserted, error: insertError } = await this.supabase
                .from(tableName)
                .insert({
                    ...payload,
                    created_at: input.createdAt || now,
                })
                .select('id')
                .single();
            if (insertError) throw insertError;
            return { tableName, id: String(inserted.id) };
        }

        const payload = {
            email: String(input.email || '').trim().toLowerCase(),
            phone: input.phone || null,
            full_name: input.accountHolderName,
            account_holder_name: input.accountHolderName,
            account_number_encrypted: input.bankAccountNumber,
            account_number_last4: input.bankAccountLast4 || input.bankAccountNumber.slice(-4) || null,
            account_number_hash: input.bankAccountHash || `e2e-bank-hash-${input.ownerId}`,
            ifsc: input.ifscCode,
            bank_name: input.bankName || null,
            branch_name: input.branchName || null,
            city: input.city || null,
            cashfree_beneficiary_id: input.beneficiaryId || null,
            transfer_reference_id: input.transferReferenceId,
            provider_reference_id: input.providerReferenceId || null,
            transfer_status: input.transferStatus,
            status_message: input.statusMessage || null,
            attempt_count: input.transferStatus === 'pending' ? 1 : 0,
            last_attempt_at: input.lastAttemptAt || now,
            verified_at: input.verifiedAt || null,
            consumed_at: null,
            owner_id: input.ownerId,
            updated_at: now,
        };

        const onConflict = payload.email ? 'email' : 'owner_id';
        const { data: inserted, error: upsertError } = await this.supabase
            .from(tableName)
            .upsert({
                ...payload,
                created_at: input.createdAt || now,
            }, { onConflict })
            .select('id')
            .single();
        if (upsertError) throw upsertError;
        return { tableName, id: String(inserted.id) };
    }

    async insertOwnerVerificationHistoryRecord(input: {
        ownerId: string;
        verificationId?: string | null;
        bankAccountNumber: string;
        ifscCode: string;
        accountHolderName: string;
        transferAmount?: number;
        transferReference: string;
        providerReferenceId?: string | null;
        transferStatus: 'pending' | 'success' | 'failed';
        errorMessage?: string | null;
        createdAt?: string;
    }) {
        const tableName = await this.getOwnerVerificationHistoryTableName();
        if (!tableName) {
            return null;
        }

        const { error } = await this.supabase
            .from(tableName)
            .insert({
                owner_id: input.ownerId,
                verification_id: input.verificationId || null,
                bank_account_number: input.bankAccountNumber,
                ifsc_code: input.ifscCode,
                account_holder_name: input.accountHolderName,
                transfer_amount: input.transferAmount ?? 1,
                transfer_reference: input.transferReference,
                provider_reference_id: input.providerReferenceId || null,
                transfer_status: input.transferStatus,
                error_message: input.errorMessage || null,
                created_at: input.createdAt || new Date().toISOString(),
            });
        if (error && !this.isMissingTableError(error)) {
            throw error;
        }
        return tableName;
    }

    async cleanupOwnerVerificationArtifacts(ownerId: string) {
        if (await this.hasTable('owner_bank_accounts')) {
            const { error } = await this.supabase
                .from('owner_bank_accounts')
                .delete()
                .eq('owner_id', ownerId);
            if (error && !this.isMissingTableError(error)) {
                throw error;
            }
        }

        const verificationHistoryTableName = await this.getOwnerVerificationHistoryTableName();
        if (verificationHistoryTableName) {
            const { error } = await this.supabase
                .from(verificationHistoryTableName)
                .delete()
                .eq('owner_id', ownerId);
            if (error && !this.isMissingTableError(error)) {
                throw error;
            }
        }

        const verificationTableName = await this.getOwnerVerificationTableName();
        if (verificationTableName) {
            const { error } = await this.supabase
                .from(verificationTableName)
                .delete()
                .eq('owner_id', ownerId);
            if (error && !this.isMissingTableError(error)) {
                throw error;
            }
        }
    }

    private async findAccountByEmail(email: string) {
        const normalizedEmail = email.trim().toLowerCase();
        try {
            const { data, error } = await withSupabaseAdminRetry(
                `findAccountByEmail(${email})`,
                () => this.supabase
                    .from('accounts')
                    .select('id, email')
                    .eq('email', normalizedEmail)
                    .limit(1)
                    .maybeSingle()
            );

            if (error) {
                console.warn(`Account lookup fallback failed for ${email}:`, error.message);
                return null;
            }

            return data;
        } catch (error) {
            console.warn(`Account lookup fallback crashed for ${email}:`, error);
            return null;
        }
    }

    async findUserByEmail(email: string): Promise<User | undefined> {
        let page = 1;
        const accountFallback = await this.findAccountByEmail(email);

        try {
            // Check first page (most likely)
            const { data: firstPage, error } = await withSupabaseAdminRetry(
                `listUsers(${email}) page 1`,
                () => this.supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
            );
            if (error) {
                console.error('Error listing users:', error);
                throw error;
            }

            const found = firstPage.users.find(u => u.email === email);
            if (found) return found;

            if (firstPage.users.length < 1000) {
                if (accountFallback?.id) {
                    return {
                        id: String(accountFallback.id),
                        email: String(accountFallback.email || email),
                    };
                }
                return undefined;
            }

            // If not in first 1000, paginate deeper
            page = 2;
            while (true) {
                const { data: pageData, error: pageError } = await withSupabaseAdminRetry(
                    `listUsers(${email}) page ${page}`,
                    () => this.supabase.auth.admin.listUsers({ page, perPage: 1000 })
                );
                if (pageError) throw pageError;

                const u = pageData.users.find(u => u.email === email);
                if (u) return u;

                if (pageData.users.length === 0) break;
                page++;

                if (page > 50) {
                    console.warn('Aborting user search after 50 pages.');
                    break;
                }
            }
        } catch (error) {
            if (accountFallback?.id && isRetryableSupabaseNetworkError(error)) {
                return {
                    id: String(accountFallback.id),
                    email: String(accountFallback.email || email),
                };
            }
            throw error;
        }

        if (accountFallback?.id) {
            return {
                id: String(accountFallback.id),
                email: String(accountFallback.email || email),
            };
        }

        return undefined;
    }

    async createTestUser(email: string, password: string, role: 'customer' | 'owner' | 'admin' = 'customer'): Promise<User | null> {
        // 1. Check if user exists
        const existingUser = await this.findUserByEmail(email);

        if (existingUser) {
            return existingUser;
        }

        const name = buildSeedDisplayName(email, role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : 'Customer');
        const phone = buildSeedPhone(`${role}:${email}`);

        // 2. Create user
        const { data: userData, error } = await withSupabaseAdminRetry(
            `createUser(${email})`,
            () => this.supabase.auth.admin.createUser({
                email,
                password,
                phone,
                phone_confirm: true,
                email_confirm: true,
                user_metadata: {
                    role,
                    name,
                    phone,
                    phone_number: phone
                },
                app_metadata: { role }
            })
        );

        if (error) {
            console.error(`Error creating user ${email}:`, error);
            throw error;
        }

        return userData.user;
    }

    async ensureCustomerProfile(userId: string, email?: string) {
        const { data: existing, error } = await this.supabase
            .from('customers')
            .select('id')
            .eq('id', userId)
            .maybeSingle();
        if (error) throw error;
        const name = buildSeedDisplayName(email, 'Customer');
        const phone = buildSeedPhone(`customer:${email || userId}`);

        if (existing) {
            const { error: updateError } = await this.supabase
                .from('customers')
                .update({
                    name,
                    email,
                    phone,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId);
            if (updateError) throw updateError;
            return;
        }

        const { error: insertError } = await this.supabase
            .from('customers')
            .insert({
                id: userId,
                name,
                email,
                phone
            });
        if (insertError) throw insertError;
    }

    async ensureOwnerProfile(ownerId: string, email?: string) {
        const { data: existing, error } = await this.supabase
            .from('owners')
            .select('id')
            .eq('id', ownerId)
            .maybeSingle();
        if (error) throw error;
        const name = buildSeedDisplayName(email, 'Owner');
        const phone = buildSeedPhone(`owner:${email || ownerId}`);

        if (existing) {
            const { error: updateError } = await this.supabase
                .from('owners')
                .update({
                    name,
                    email,
                    phone,
                    updated_at: new Date().toISOString()
                })
                .eq('id', ownerId);
            if (updateError) throw updateError;
            return;
        }

        const { error: insertError } = await this.supabase
            .from('owners')
            .insert({
                id: ownerId,
                name,
                email,
                phone,
                verified: false,
                verification_status: 'pending'
            });
        if (insertError) throw insertError;
    }

    async ensureOwnerVerified(ownerId: string, email?: string) {
        await this.ensureOwnerProfile(ownerId, email);

        const name = buildCashfreeSafeDisplayName(email, 'Owner');
        const phone = buildSeedPhone(`owner:${email || ownerId}`);
        const bankAccountNumber = buildSeedBankAccountNumber(email || ownerId);
        const bankAccountLast4 = bankAccountNumber.slice(-4);
        const bankAccountHash = buildSeedBankAccountHash(email || ownerId);
        const beneficiaryId = `OWNER_${String(ownerId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toUpperCase()}`;
        const now = new Date().toISOString();
        const verificationPayload = {
            email,
            phone,
            ownerId,
            bankAccountNumber,
            bankAccountLast4,
            bankAccountHash,
            ifscCode: 'SBIN0000001',
            accountHolderName: name,
            bankName: 'State Bank of India',
            branchName: 'MG Road',
            city: 'Bengaluru',
            beneficiaryId,
            transferAmount: 1,
            transferReferenceId: `e2e_verify_${ownerId}`,
            providerReferenceId: `e2e_provider_${ownerId}`,
            transferStatus: 'success' as const,
            statusMessage: 'Verified for automated E2E seeding.',
            lastAttemptAt: now,
            verifiedAt: now,
            updatedAt: now
        };
        await this.upsertOwnerVerificationRecord(verificationPayload);

        await this.upsertOwnerBankAccountRecord({
            ownerId,
            accountHolderName: name,
            accountNumber: bankAccountNumber,
            accountNumberLast4: bankAccountLast4,
            accountNumberHash: bankAccountHash,
            ifsc: 'SBIN0000001',
            bankName: 'State Bank of India',
            branchName: 'MG Road',
            city: 'Bengaluru',
            cashfreeBeneficiaryId: beneficiaryId,
            verified: true,
            bankVerificationStatus: 'verified',
            verificationMethod: 'penny_drop',
            updatedAt: now
        });

        const ownerUpdatePayloads = [
            {
                name,
                email,
                phone,
                verified: true,
                verification_status: 'approved',
                bank_verified: true,
                bank_verification_status: 'verified',
                cashfree_beneficiary_id: beneficiaryId,
                cashfree_status: 'success',
                cashfree_transfer_id: verificationPayload.transferReferenceId,
                bank_details: {
                    bankName: 'State Bank of India',
                    branchName: 'MG Road',
                    city: 'Bengaluru',
                    ifscCode: 'SBIN0000001',
                    accountNumber: `XXXX${bankAccountLast4}`,
                    accountHolderName: name
                },
                account_holder_name: name,
                bank_account_number: `XXXX${bankAccountLast4}`,
                bank_ifsc: 'SBIN0000001',
                updated_at: now
            },
            {
                name,
                email,
                phone,
                verified: true,
                verification_status: 'approved',
                bank_verified: true,
                bank_verification_status: 'verified',
                cashfree_beneficiary_id: beneficiaryId,
                cashfree_status: 'success',
                cashfree_transfer_id: verificationPayload.transferReferenceId,
                bank_details: {
                    bankName: 'State Bank of India',
                    branchName: 'MG Road',
                    city: 'Bengaluru',
                    ifscCode: 'SBIN0000001',
                    accountNumber: `XXXX${bankAccountLast4}`,
                    accountHolderName: name
                },
                updated_at: now
            },
            {
                name,
                email,
                phone,
                verified: true,
                verification_status: 'approved',
                bank_details: {
                    bankName: 'State Bank of India',
                    branchName: 'MG Road',
                    city: 'Bengaluru',
                    ifscCode: 'SBIN0000001',
                    accountNumber: `XXXX${bankAccountLast4}`,
                    accountHolderName: name
                },
                updated_at: now
            },
            {
                name,
                email,
                phone,
                verified: true,
                verification_status: 'approved',
                updated_at: now
            },
            {
                name,
                email,
                phone,
                updated_at: now
            }
        ];

        let ownerUpdateError: { message?: string } | null = null;
        for (const payload of ownerUpdatePayloads) {
            const result = await this.supabase
                .from('owners')
                .update(payload)
                .eq('id', ownerId);

            if (!result.error) {
                ownerUpdateError = null;
                break;
            }

            ownerUpdateError = result.error;
            if (!this.isSchemaMismatchError(result.error)) {
                throw result.error;
            }
        }

        if (ownerUpdateError) throw ownerUpdateError;
    }

    async deleteTestUser(email: string) {
        const user = await this.findUserByEmail(email);

        if (user) {
            const { error } = await withSupabaseAdminRetry(
                `deleteUser(${email})`,
                () => this.supabase.auth.admin.deleteUser(user.id)
            );
            if (error) {
                console.error(`Error deleting user ${email}:`, error);
            } else {
                console.log(`Deleted user ${email}`);
            }
        }
    }

    async cleanupPaymentArtifactsForBookings(bookingIds: string[]) {
        if (bookingIds.length === 0) return;

        const { error: refundDeleteError } = await this.supabase
            .from('refunds')
            .delete()
            .in('booking_id', bookingIds);
        if (refundDeleteError) {
            console.error('Error cleaning up refunds:', refundDeleteError.message);
        }

        const { error: paymentAttemptDeleteError } = await this.supabase
            .from('payment_attempts')
            .delete()
            .in('booking_id', bookingIds);
        if (paymentAttemptDeleteError) {
            console.error('Error cleaning up payment attempts:', paymentAttemptDeleteError.message);
        }

        const { error: paymentDeleteError } = await this.supabase
            .from('payments')
            .delete()
            .in('booking_id', bookingIds);
        if (paymentDeleteError) {
            console.error('Error cleaning up payments:', paymentDeleteError.message);
        }
    }

    async cleanupOrdersForUserIds(userIds: string[], column: 'customer_id' | 'owner_id') {
        if (userIds.length === 0) return;

        const { error } = await this.supabase
            .from('orders')
            .delete()
            .in(column, userIds);
        if (error) {
            if (this.isMissingTableError(error)) {
                this.tableAvailability.set('orders', false);
                return;
            }
            console.error(`Error cleaning up orders by ${column}:`, error.message);
        }
    }

    async ensurePaymentAttemptForPayment(paymentId: string) {
        const { data: existingAttempt, error: existingAttemptError } = await this.supabase
            .from('payment_attempts')
            .select('id')
            .eq('payment_id', paymentId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingAttemptError) throw existingAttemptError;
        if (existingAttempt?.id) {
            return String(existingAttempt.id);
        }

        const { data: payment, error: paymentLookupError } = await this.supabase
            .from('payments')
            .select('id, booking_id, customer_id, amount, payment_method, provider_order_id, provider_payment_id, status')
            .eq('id', paymentId)
            .maybeSingle();
        if (paymentLookupError) throw paymentLookupError;
        if (!payment?.booking_id || !payment?.customer_id) {
            throw new Error(`Payment ${paymentId} is missing booking_id or customer_id`);
        }

        const { data: booking, error: bookingLookupError } = await this.supabase
            .from('bookings')
            .select('id, owner_id')
            .eq('id', payment.booking_id)
            .maybeSingle();
        if (bookingLookupError) throw bookingLookupError;
        if (!booking?.owner_id) {
            throw new Error(`Booking ${payment.booking_id} is missing owner_id`);
        }

        const normalizedPaymentStatus = String(payment.status || '').toLowerCase();
        const orderStatus = normalizedPaymentStatus === 'refunded'
            ? 'refunded'
            : normalizedPaymentStatus === 'completed' || normalizedPaymentStatus === 'success'
                ? 'paid'
                : 'payment_pending';
        const modernAttemptStatus = normalizedPaymentStatus === 'refunded'
            ? 'failed'
            : normalizedPaymentStatus === 'completed' || normalizedPaymentStatus === 'success'
                ? 'success'
                : 'pending';
        const legacyAttemptStatus = orderStatus === 'payment_pending' ? 'payment_pending' : 'success';

        const attemptPayloads: Record<string, unknown>[] = [];
        attemptPayloads.push(
            {
                payment_id: payment.id,
                booking_id: payment.booking_id,
                status: modernAttemptStatus,
                provider: 'cashfree',
                provider_order_id: payment.provider_order_id || null,
                provider_payment_id: payment.provider_payment_id || null,
                provider_session_id: null,
                idempotency_key: `e2e-payment-attempt-${payment.id}`,
                upi_app: String(payment.payment_method || 'upi'),
                raw_payload: {
                    source: 'e2e-helper',
                    booking_id: payment.booking_id,
                    payment_id: payment.id
                }
            },
            {
                payment_id: payment.id,
                booking_id: payment.booking_id,
                status: normalizedPaymentStatus === 'completed' || normalizedPaymentStatus === 'success' ? 'success' : 'failed',
                provider: 'cashfree',
                provider_order_id: payment.provider_order_id || null,
                provider_payment_id: payment.provider_payment_id || null,
                idempotency_key: `e2e-payment-attempt-${payment.id}`,
                raw_payload: {
                    source: 'e2e-helper',
                    booking_id: payment.booking_id,
                    payment_id: payment.id
                }
            }
        );

        let attemptId: string | null = null;
        let lastAttemptError: { message?: string } | null = null;
        for (const payload of attemptPayloads) {
            const { data: attempt, error: attemptError } = await this.supabase
                .from('payment_attempts')
                .insert(payload)
                .select('id')
                .single();

            if (!attemptError) {
                attemptId = attempt?.id ? String(attempt.id) : null;
                break;
            }

            lastAttemptError = attemptError;
            if (!this.isMissingTableError(attemptError)) {
                const errorMessage = String(attemptError.message || '').toLowerCase();
                const isSchemaMismatch = errorMessage.includes('column')
                    || errorMessage.includes('null value')
                    || errorMessage.includes('invalid input value')
                    || errorMessage.includes('check constraint')
                    || errorMessage.includes('not-null');
                if (!isSchemaMismatch) {
                    throw new Error(`Failed to create payment attempt for payment ${paymentId}: ${attemptError.message}`);
                }
            }
        }

        let orderId: string | null = null;
        if (!attemptId && await this.hasTable('orders')) {
            const { data: order, error: orderError } = await this.supabase
                .from('orders')
                .insert({
                    customer_id: payment.customer_id,
                    owner_id: booking.owner_id,
                    amount_total: Number(payment.amount || 0),
                    amount_advance: Number(payment.amount || 0),
                    status: orderStatus,
                    metadata: {
                        source: 'e2e-helper',
                        booking_id: payment.booking_id,
                        payment_id: payment.id
                    }
                })
                .select('id')
                .single();
            if (orderError && !this.isMissingTableError(orderError)) {
                throw new Error(`Failed to create synthetic order for payment ${paymentId}: ${orderError.message}`);
            }
            orderId = order?.id ? String(order.id) : null;
        }

        if (!attemptId && orderId) {
            const { data: attempt, error: attemptError } = await this.supabase
                .from('payment_attempts')
                .insert({
                    order_id: orderId,
                    idempotency_key: `e2e-payment-attempt-${payment.id}`,
                    amount: Number(payment.amount || 0),
                    method: String(payment.payment_method || 'upi'),
                    status: legacyAttemptStatus,
                    payment_id: payment.id,
                    booking_id: payment.booking_id,
                    provider: 'cashfree',
                    provider_order_id: payment.provider_order_id || `e2e-order-${orderId}`,
                    provider_payment_id: payment.provider_payment_id || null,
                    provider_session_id: null,
                    upi_app: String(payment.payment_method || 'upi'),
                    raw_payload: {
                        source: 'e2e-helper',
                        booking_id: payment.booking_id,
                        payment_id: payment.id
                    }
                })
                .select('id')
                .single();

            if (!attemptError) {
                attemptId = attempt?.id ? String(attempt.id) : null;
            } else {
                lastAttemptError = attemptError;
                if (!this.isMissingTableError(attemptError)) {
                    throw new Error(`Failed to create payment attempt for payment ${paymentId}: ${attemptError.message}`);
                }
            }
        }

        if (!attemptId) {
            throw new Error(`Failed to create payment attempt for payment ${paymentId}: ${lastAttemptError?.message || 'unknown error'}`);
        }

        if (orderId) {
            const { error: orderUpdateError } = await this.supabase
                .from('orders')
                .update({ latest_payment_attempt_id: attemptId })
                .eq('id', orderId);
            if (orderUpdateError && !this.isMissingTableError(orderUpdateError)) throw orderUpdateError;
        }

        const { error: bookingUpdateError } = await this.supabase
            .from('bookings')
            .update({ payment_id: payment.id })
            .eq('id', payment.booking_id);
        if (bookingUpdateError) throw bookingUpdateError;

        return attemptId;
    }

    async cleanupUserBookings(userEmail: string) {
        const normalizedEmail = userEmail.trim().toLowerCase();
        const targetUsers: User[] = [];

        try {
            let page = 1;
            while (true) {
                const { data: pageData, error } = await withSupabaseAdminRetry(
                    `cleanup.listUsers(${normalizedEmail}) page ${page}`,
                    () => this.supabase.auth.admin.listUsers({ page, perPage: 1000 })
                );
                if (error) {
                    console.error('Error listing users for cleanup:', error);
                    break;
                }

                const matches = pageData.users.filter(u => String(u.email || '').toLowerCase() === normalizedEmail);
                targetUsers.push(...matches);

                if (pageData.users.length === 0) break;
                page++;
                if (page > 50) break;
            }
        } catch (error) {
            if (!isRetryableSupabaseNetworkError(error)) {
                throw error;
            }

            const { data: accountMatches, error: accountError } = await this.supabase
                .from('accounts')
                .select('id, email')
                .eq('email', normalizedEmail);
            if (accountError) {
                console.error('Error listing users for cleanup fallback:', accountError.message);
            } else {
                targetUsers.push(...(accountMatches || []).map((account) => ({
                    id: String(account.id),
                    email: String(account.email || normalizedEmail),
                } as User)));
            }
        }

        if (targetUsers.length === 0) {
            console.log(`User ${userEmail} not found, skipping cleanup.`);
            return;
        }

        console.log(`Found ${targetUsers.length} users for email ${userEmail}. Cleaning up bookings for all.`);

        // 2. Delete refunds/payments then bookings for ALL found users
        const userIds = targetUsers.map(u => u.id);
        const { data: bookingRows, error: bookingFetchError } = await this.supabase
            .from('bookings')
            .select('id')
            .in('customer_id', userIds);
        if (bookingFetchError) {
            console.error('Error fetching bookings for cleanup:', bookingFetchError.message);
        }

        const bookingIds = (bookingRows || []).map(b => b.id);
        await this.cleanupPaymentArtifactsForBookings(bookingIds);
        await this.cleanupOrdersForUserIds(userIds, 'customer_id');

        const { error: bookingError } = await this.supabase.from('bookings').delete().in('customer_id', userIds);

        if (bookingError) {
            console.error('Error cleaning up bookings:', bookingError.message);
        } else {
            console.log(`Successfully cleared existing bookings for ${targetUsers.length} test users.`);
        }
    }

    async cleanupOwnerBookings(ownerEmail: string) {
        const owner = await this.findUserByEmail(ownerEmail);
        if (!owner) {
            console.log(`Owner ${ownerEmail} not found, skipping owner booking cleanup.`);
            return;
        }
        const { data: bookingRows, error: bookingFetchError } = await this.supabase
            .from('bookings')
            .select('id')
            .eq('owner_id', owner.id);
        if (bookingFetchError) {
            console.error('Error fetching owner bookings for cleanup:', bookingFetchError.message);
        }

        const bookingIds = (bookingRows || []).map(b => b.id);
        await this.cleanupPaymentArtifactsForBookings(bookingIds);
        await this.cleanupOrdersForUserIds([owner.id], 'owner_id');

        const { error: bookingDeleteError } = await this.supabase
            .from('bookings')
            .delete()
            .eq('owner_id', owner.id);
        if (bookingDeleteError) {
            console.error('Error cleaning up owner bookings:', bookingDeleteError.message);
        } else {
            console.log(`Successfully cleared existing bookings for owner ${ownerEmail}.`);
        }
    }

    async cleanupOwnerProperties(ownerEmail: string, titlePrefix?: string) {
        const owner = await this.findUserByEmail(ownerEmail);
        if (!owner) {
            console.log(`Owner ${ownerEmail} not found, skipping property cleanup.`);
            return;
        }

        let query = this.supabase.from('properties').delete().eq('owner_id', owner.id);
        if (titlePrefix) {
            query = query.ilike('title', `${titlePrefix}%`);
        }
        const { error } = await query;
        if (error) {
            console.error('Error cleaning up owner properties:', error.message);
        } else {
            console.log(`Successfully cleared properties for owner ${ownerEmail}.`);
        }
    }

    async createPropertyForOwner(ownerEmail: string, options?: {
        title?: string;
        status?: 'draft' | 'published' | 'archived' | 'inactive';
        monthlyRent?: number;
        advanceDeposit?: number;
        tags?: string[];
        city?: string;
        state?: string;
    }) {
        const owner = await this.findUserByEmail(ownerEmail);
        if (!owner) throw new Error(`Owner ${ownerEmail} not found`);
        await this.ensureOwnerVerified(owner.id, ownerEmail);

        const now = Date.now();
        const title = options?.title || `E2E Property ${now}`;
        const monthlyRent = options?.monthlyRent ?? 5000;
        const advanceDeposit = options?.advanceDeposit ?? monthlyRent;
        const status = options?.status ?? 'published';
        const city = options?.city ?? 'Bengaluru';
        const state = options?.state ?? 'Karnataka';

        const basePayload: Record<string, unknown> = {
            owner_id: owner.id,
            title,
            description: 'Auto-generated property for E2E tests',
            property_type: 'pg',
            city,
            state,
            locality: city,
            address: { text: `${city}, ${state}`, lat: 12.9716, lng: 77.5946 },
            monthly_rent: monthlyRent,
            advance_deposit: advanceDeposit,
            total_rooms: 1,
            rooms_available: 1,
            status
        };

        let tagsSupported = true;
        let insertPayload: Record<string, unknown> = basePayload;
        if (options?.tags?.length) {
            insertPayload = { ...basePayload, tags: options.tags };
        }

        let { data: property, error } = await this.supabase
            .from('properties')
            .insert(insertPayload)
            .select()
            .single();

        const tagsMissing =
            !!error &&
            (
                error.code === 'PGRST204'
                || (/tags/i.test(error.message || '') && /column|schema cache/i.test(error.message || ''))
                || /tags.+column|column.+tags/i.test(error.message || '')
            );
        if (tagsMissing) {
            tagsSupported = false;
            const retry = await this.supabase
                .from('properties')
                .insert(basePayload)
                .select()
                .single();
            property = retry.data as typeof property;
            error = retry.error as typeof error;
        }

        if (error) {
            console.error('Error creating property:', error);
            throw new Error(`Failed to create property: ${error.message}`);
        }

        return { property, tagsSupported };
    }

    async createPropertyWithRoom(ownerEmail: string, options?: {
        title?: string;
        status?: 'draft' | 'published' | 'archived' | 'inactive';
        monthlyRent?: number;
        advanceDeposit?: number;
        city?: string;
        state?: string;
        roomNumber?: string;
        roomType?: string;
        roomCapacity?: number;
        roomPrice?: number;
    }) {
        const roomNumber = options?.roomNumber ?? `E2E-${Date.now()}`;
        const insertRoomForProperty = async (propertyRow: Record<string, unknown>) => {
            const propertyId = String(propertyRow.id || propertyRow.property_id || '');
            let resolvedProperty = propertyRow;

            for (let attempt = 0; attempt < 6; attempt += 1) {
                const { data: freshProperty, error: propertyLookupError } = await this.supabase
                    .from('properties')
                    .select('*')
                    .eq('id', propertyId)
                    .maybeSingle();

                if (!propertyLookupError && freshProperty) {
                    resolvedProperty = freshProperty;
                    break;
                }

                await delay(250 * (attempt + 1));
            }

            const roomPrice = options?.roomPrice ?? Number(resolvedProperty.monthly_rent || propertyRow.monthly_rent || 5000);
            let room: Record<string, unknown> | null = null;
            let lastRoomError: { message?: string } | null = null;

            for (let attempt = 0; attempt < 5; attempt += 1) {
                const { data: roomRow, error: roomError } = await this.supabase
                    .from('rooms')
                    .insert({
                        property_id: propertyId,
                        room_number: roomNumber,
                        room_type: options?.roomType ?? 'Single',
                        capacity: options?.roomCapacity ?? 1,
                        price: roomPrice,
                        amenities: [],
                        images: [],
                        is_available: true
                    })
                    .select()
                    .single();

                if (!roomError && roomRow) {
                    room = roomRow;
                    break;
                }

                lastRoomError = roomError;
                const isPropertyRace = String(roomError?.message || '').includes('rooms_property_id_fkey');
                if (!isPropertyRace) {
                    break;
                }

                await delay(350 * (attempt + 1));
            }

            return { propertyId, resolvedProperty, room, lastRoomError };
        };

        let lastRoomError: { message?: string } | null = null;

        for (let propertyAttempt = 0; propertyAttempt < 3; propertyAttempt += 1) {
            const { property } = await this.createPropertyForOwner(ownerEmail, {
                title: propertyAttempt === 0 ? options?.title : `${options?.title || 'E2E Property'} Retry ${Date.now()}`,
                status: options?.status ?? 'published',
                monthlyRent: options?.monthlyRent,
                advanceDeposit: options?.advanceDeposit,
                city: options?.city ?? 'Bengaluru',
                state: options?.state ?? 'Karnataka'
            });

            const { propertyId, resolvedProperty, room, lastRoomError: attemptError } = await insertRoomForProperty(property);
            if (room) {
                return { property: resolvedProperty, room };
            }

            lastRoomError = attemptError;
            await delay(400 * (propertyAttempt + 1));
            console.warn(`Retrying property room seed for ${propertyId} after room insert failure.`);
        }

        console.error('Error creating room:', lastRoomError);
        throw new Error(`Failed to create room for seeded property: ${lastRoomError?.message || 'unknown error'}`);
    }

    async createPaidBooking(customerEmail: string, ownerEmail: string) {
        const customer = await this.findUserByEmail(customerEmail);
        if (!customer) throw new Error(`Customer ${customerEmail} not found`);
        await this.ensureCustomerProfile(customer.id, customerEmail);

        const owner = await this.findUserByEmail(ownerEmail);
        if (!owner) throw new Error(`Owner ${ownerEmail} not found`);
        await this.ensureOwnerVerified(owner.id, ownerEmail);

        let { data: properties } = await this.supabase
            .from('properties')
            .select('id, owner_id, title, monthly_rent, advance_deposit')
            .eq('owner_id', owner.id)
            .limit(1);
        if (!properties || properties.length === 0) {
            const { property: createdProperty } = await this.createPropertyForOwner(ownerEmail, {
                title: `E2E Test Property ${Date.now()}`,
                status: 'published',
                city: 'Test City',
                state: 'Test State',
                monthlyRent: 5000,
                advanceDeposit: 5000
            });
            properties = [createdProperty];
        }

        let property = properties[0];

        const activeStatuses = [
            'pending',
            'approved',
            'checked-in',
            'checked_in',
            'BOOKED',
            'ACTIVE',
            'ONGOING',
            'requested'
        ];

        const { data: existingActive } = await this.supabase
            .from('bookings')
            .select('id')
            .eq('customer_id', customer.id)
            .eq('property_id', property.id)
            .is('vacate_date', null)
            .in('status', activeStatuses)
            .limit(1)
            .maybeSingle();

        if (existingActive?.id) {
            const { property: freshProperty } = await this.createPropertyForOwner(ownerEmail, {
                title: `E2E Test Property ${Date.now()}`,
                status: 'published'
            });
            property = freshProperty;
        }

        const checkInDate = new Date();
        checkInDate.setDate(checkInDate.getDate() + 10);
        const checkOutDate = new Date(checkInDate);
        checkOutDate.setDate(checkOutDate.getDate() + 2);

        const monthlyRent = Number(property.monthly_rent || 5000);
        const advancePaid = Number(property.advance_deposit || monthlyRent);

        const insertBooking = async () => this.supabase
            .from('bookings')
            .insert({
                customer_id: customer.id,
                property_id: property.id,
                owner_id: property.owner_id,
                start_date: checkInDate.toISOString().split('T')[0],
                end_date: checkOutDate.toISOString().split('T')[0],
                status: 'requested',
                payment_status: 'paid',
                monthly_rent: monthlyRent,
                advance_paid: advancePaid,
                customer_name: customerEmail.split('@')[0],
                customer_phone: '9999999999',
                customer_email: customerEmail,
                payment_type: 'advance'
            })
            .select()
            .single();

        let { data: booking, error: bookingError } = await insertBooking();

        if (bookingError) {
            const errorMessage = bookingError.message || '';
            const isDuplicate = bookingError.code === '23505'
                || /unique_active_pg_(stay|booking)/i.test(errorMessage);
            const isMissingProperty = /bookings_property_id_fkey/i.test(errorMessage);
            const isActiveBookingGuard = /active_pg_booking_exists/i.test(errorMessage);

            if (isActiveBookingGuard) {
                await this.cleanupUserBookings(customerEmail);
                const retry = await insertBooking();
                booking = retry.data as typeof booking;
                bookingError = retry.error as typeof bookingError;
            } else if (isDuplicate || isMissingProperty) {
                const { property: freshProperty } = await this.createPropertyForOwner(ownerEmail, {
                    title: `E2E Test Property ${Date.now()}`,
                    status: 'published',
                    monthlyRent,
                    advanceDeposit: advancePaid
                });
                property = freshProperty;
                const retry = await insertBooking();
                booking = retry.data as typeof booking;
                bookingError = retry.error as typeof bookingError;
            }
        }

        if (bookingError) throw new Error(`Failed to create paid booking: ${bookingError.message}`);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const { data: persistedBooking } = await this.supabase
                .from('bookings')
                .select('id')
                .eq('id', booking.id)
                .maybeSingle();

            if (persistedBooking?.id) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }

        let paymentError: { message: string } | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const paymentInsert = await this.supabase
                .from('payments')
                .insert({
                    booking_id: booking.id,
                    customer_id: customer.id,
                    amount: advancePaid,
                    status: 'completed',
                    payment_method: 'upi',
                    payment_type: 'advance',
                    webhook_received: true
                });

            if (!paymentInsert.error) {
                paymentError = null;
                break;
            }

            paymentError = paymentInsert.error as { message: string };
            if (!/payments_booking_id_fkey/i.test(paymentInsert.error.message || '')) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }

        if (paymentError) throw new Error(`Failed to create payment: ${paymentError.message}`);

        return { booking, property };
    }

    async createPendingBookingForOwner(customerEmail: string, ownerEmail: string) {
        const customer = await this.findUserByEmail(customerEmail);
        if (!customer) throw new Error(`Customer ${customerEmail} not found`);
        await this.ensureCustomerProfile(customer.id, customerEmail);

        const owner = await this.findUserByEmail(ownerEmail);
        if (!owner) throw new Error(`Owner ${ownerEmail} not found`);
        await this.ensureOwnerVerified(owner.id, ownerEmail);

        let { data: properties } = await this.supabase
            .from('properties')
            .select('id, owner_id, title, monthly_rent, advance_deposit')
            .eq('owner_id', owner.id)
            .limit(1);

        if (!properties || properties.length === 0) {
            const { property: createdProperty } = await this.createPropertyForOwner(ownerEmail, {
                title: `E2E Pending Property ${Date.now()}`,
                status: 'published',
                city: 'Test City',
                state: 'Test State',
                monthlyRent: 5000,
                advanceDeposit: 5000
            });
            properties = [createdProperty];
        }

        const property = properties[0];
        const checkInDate = new Date();
        checkInDate.setDate(checkInDate.getDate() + 10);
        const checkOutDate = new Date(checkInDate);
        checkOutDate.setDate(checkOutDate.getDate() + 2);

        const monthlyRent = Number(property.monthly_rent || 5000);
        const advancePaid = Number(property.advance_deposit || monthlyRent);

        const { data: booking, error: bookingError } = await this.supabase
            .from('bookings')
            .insert({
                customer_id: customer.id,
                property_id: property.id,
                owner_id: property.owner_id,
                start_date: checkInDate.toISOString().split('T')[0],
                end_date: checkOutDate.toISOString().split('T')[0],
                status: 'payment_pending',
                payment_status: 'pending',
                monthly_rent: monthlyRent,
                advance_paid: advancePaid,
                customer_name: customerEmail.split('@')[0],
                customer_phone: '9999999999',
                customer_email: customerEmail,
                payment_type: 'advance'
            })
            .select()
            .single();

        if (bookingError) throw new Error(`Failed to create pending booking: ${bookingError.message}`);

        return { booking, property };
    }

    async createConfirmedBooking(userEmail: string) {
        // 1. Get user ID
        const user = await this.findUserByEmail(userEmail);
        if (!user) throw new Error(`User ${userEmail} not found`);

        // 2. Get a valid property and check-in dates
        const { data: properties } = await this.supabase.from('properties').select('id, owner_id').limit(1);
        if (!properties || properties.length === 0) throw new Error('No properties found to book');
        const property = properties[0];

        const checkInDate = new Date();
        checkInDate.setDate(checkInDate.getDate() + 10);
        const checkOutDate = new Date(checkInDate);
        checkOutDate.setDate(checkOutDate.getDate() + 2);

        // 3. Create Booking
        const { data: booking, error: bookingError } = await this.supabase
            .from('bookings')
            .insert({
                customer_id: user.id,
                property_id: property.id,
                owner_id: property.owner_id,
                start_date: checkInDate.toISOString().split('T')[0],
                end_date: checkOutDate.toISOString().split('T')[0],
                status: 'approved',
                payment_status: 'paid',
                monthly_rent: 5000,
                advance_paid: 5000
            })
            .select()
            .single();

        if (bookingError) throw new Error(`Failed to create booking: ${bookingError.message}`);

        // 4. Create Payment Record linked to booking
        const txnid = `txnid_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const { error: paymentError } = await this.supabase
            .from('payments')
            .insert({
                booking_id: booking.id,
                customer_id: user.id,
                amount: 5000,
                status: 'completed',
                payment_method: 'upi',
                payment_type: 'advance',
                webhook_received: true
            });

        if (paymentError) throw new Error(`Failed to create payment: ${paymentError.message}`);

        return booking;
    }

    async createPendingBooking(userEmail: string) {
        // 1. Get user ID
        const user = await this.findUserByEmail(userEmail);
        if (!user) throw new Error(`User ${userEmail} not found`);
        await this.ensureCustomerProfile(user.id, userEmail);

        // 2. Get a valid property and check-in dates
        let { data: properties } = await withSupabaseAdminRetry(
            `createPendingBooking(${userEmail}) properties`,
            () => this.supabase
                .from('properties')
                .select('id, owner_id, monthly_rent, advance_deposit')
                .limit(1)
        );

        if (!properties || properties.length === 0) {
            // Fallback: ensure an owner and create a property for RLS tests
            let ownerId: string | null = null;
            const { data: owners } = await withSupabaseAdminRetry(
                `createPendingBooking(${userEmail}) owners`,
                () => this.supabase.from('owners').select('id').limit(1)
            );
            if (owners && owners.length > 0) {
                ownerId = owners[0].id as string;
            } else {
                const fallbackEmail = TEST_USERS.owner?.email || 'test_owner_e2e@example.com';
                const ownerUser = await this.createTestUser(fallbackEmail, TEST_USERS.owner?.password || 'password123', 'owner');
                if (!ownerUser) {
                    throw new Error('Failed to create fallback owner for property creation');
                }
                await this.ensureOwnerVerified(ownerUser.id, fallbackEmail);
                ownerId = ownerUser.id;
            }

            const fallbackEmail = TEST_USERS.owner?.email || 'test_owner_e2e@example.com';
            const { property: createdProperty } = await this.createPropertyForOwner(fallbackEmail, {
                title: `E2E Property ${Date.now()}`,
                status: 'published',
                city: 'Test City',
                state: 'Test State',
                monthlyRent: 5000,
                advanceDeposit: 5000
            });

            properties = [createdProperty];
        }

        const property = properties[0];

        const checkInDate = new Date();
        checkInDate.setDate(checkInDate.getDate() + 10);
        const checkOutDate = new Date(checkInDate);
        checkOutDate.setDate(checkOutDate.getDate() + 2);

        // 3. Create Booking (payment pending)
        const monthlyRent = Number(property.monthly_rent || 5000);
        const advancePaid = Number(property.advance_deposit || monthlyRent);

        const { data: booking, error: bookingError } = await withSupabaseAdminRetry(
            `createPendingBooking(${userEmail}) insert`,
            () => this.supabase
                .from('bookings')
                .insert({
                    customer_id: user.id,
                    property_id: property.id,
                    owner_id: property.owner_id,
                    start_date: checkInDate.toISOString().split('T')[0],
                    end_date: checkOutDate.toISOString().split('T')[0],
                    status: 'payment_pending',
                    payment_status: 'pending',
                    monthly_rent: monthlyRent,
                    advance_paid: advancePaid,
                    customer_name: userEmail.split('@')[0],
                    customer_phone: '9999999999',
                    customer_email: userEmail,
                    payment_type: 'advance'
                })
                .select()
                .single()
        );

        if (bookingError) throw new Error(`Failed to create pending booking: ${bookingError.message}`);

        await withSupabaseAdminRetry(
            `createPendingBooking(${userEmail}) confirm`,
            () => this.supabase
                .from('bookings')
                .select('id')
                .eq('id', booking.id)
                .maybeSingle()
        );

        return booking;
    }

    async createPendingPayment(bookingId: string, customerId: string, amount: number) {
        const { data: payment, error } = await withSupabaseAdminRetry(
            `createPendingPayment(${bookingId})`,
            () => this.supabase
                .from('payments')
                .insert({
                    booking_id: bookingId,
                    customer_id: customerId,
                    amount: amount,
                    status: 'pending',
                    payment_method: 'upi',
                    payment_type: 'advance',
                })
                .select()
                .single()
        );

        if (error) throw new Error(`Failed to create pending payment: ${error.message}`);
        await this.ensurePaymentAttemptForPayment(String(payment.id));
        return payment;
    }

    async getPaymentById(paymentId: string) {
        const { data, error } = await withSupabaseAdminRetry(
            `getPaymentById(${paymentId})`,
            () => this.supabase
                .from('payments')
                .select('*')
                .eq('id', paymentId)
                .maybeSingle()
        );
        if (error) throw error;
        return data || null;
    }

    async getPaymentsForBooking(bookingId: string) {
        const { data, error } = await withSupabaseAdminRetry(
            `getPaymentsForBooking(${bookingId})`,
            () => this.supabase
                .from('payments')
                .select('*')
                .eq('booking_id', bookingId)
                .order('created_at', { ascending: false })
        );
        if (error) throw error;
        return data || [];
    }

    async getBookingById(bookingId: string) {
        const { data, error } = await withSupabaseAdminRetry(
            `getBookingById(${bookingId})`,
            () => this.supabase
                .from('bookings')
                .select('*')
                .eq('id', bookingId)
                .maybeSingle()
        );
        if (error) throw error;
        return data || null;
    }

    async markPaymentCompleted(paymentId: string, bookingId: string) {
        const now = new Date().toISOString();

        const { error: paymentError } = await withSupabaseAdminRetry(
            `markPaymentCompleted(${paymentId}) payment`,
            () => this.supabase
                .from('payments')
                .update({
                    status: 'completed',
                    verified_at: now,
                    webhook_received: true
                })
                .eq('id', paymentId)
        );

        if (paymentError) {
            throw new Error(`Failed to mark payment completed: ${paymentError.message}`);
        }

        const { error: bookingError } = await withSupabaseAdminRetry(
            `markPaymentCompleted(${paymentId}) booking`,
            () => this.supabase
                .from('bookings')
                .update({
                    status: 'requested',
                    payment_status: 'paid',
                    updated_at: now
                })
                .eq('id', bookingId)
        );

        if (bookingError) {
            throw new Error(`Failed to update booking after payment completion: ${bookingError.message}`);
        }

        await withSupabaseAdminRetry(
            `markPaymentCompleted(${paymentId}) confirm`,
            () => this.supabase
                .from('bookings')
                .select('payment_status, status')
                .eq('id', bookingId)
                .maybeSingle()
        );
    }

    async markPaymentFailed(paymentId: string, bookingId: string, reason: string = 'Payment cancelled by customer') {
        const now = new Date().toISOString();
        await this.ensurePaymentAttemptForPayment(paymentId);

        const { error: paymentError } = await this.supabase
            .from('payments')
            .update({
                status: 'failed',
                payment_status: 'failed',
                failure_reason: reason,
                verified_at: now,
                webhook_received: true
            })
            .eq('id', paymentId);

        if (paymentError) {
            throw new Error(`Failed to mark payment failed: ${paymentError.message}`);
        }

        const { error: attemptError } = await this.supabase
            .from('payment_attempts')
            .update({
                status: 'failed',
                failure_reason: reason,
                updated_at: now
            })
            .eq('payment_id', paymentId);

        if (attemptError) {
            throw new Error(`Failed to update payment attempts after failure: ${attemptError.message}`);
        }

        const { error: bookingError } = await this.supabase
            .from('bookings')
            .update({
                payment_status: 'failed',
                updated_at: now
            })
            .eq('id', bookingId);

        if (bookingError) {
            throw new Error(`Failed to update booking after payment failure: ${bookingError.message}`);
        }

        const { error: bookingStatusError } = await this.supabase
            .from('bookings')
            .update({
                status: 'payment_failed',
                updated_at: now
            })
            .eq('id', bookingId);

        if (bookingStatusError) {
            const message = String(bookingStatusError.message || '').toLowerCase();
            if (message.includes('payment_failed') && (message.includes('enum') || message.includes('invalid input value') || message.includes('check constraint'))) {
                return;
            }
            throw new Error(`Failed to update booking status after payment failure: ${bookingStatusError.message}`);
        }
    }
    async createSettlement(ownerEmail: string) {
        return this.createOwnerSettlement(ownerEmail, {
            status: 'COMPLETED',
            providerReference: `payout_${Date.now()}`,
            processedAt: new Date().toISOString()
        });
    }



    async getLatestBookingForCustomerId(customerId: string) {
        const { data, error } = await this.supabase
            .from('bookings')
            .select('id, status, payment_status, created_at, customer_id')
            .eq('customer_id', customerId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('Error fetching latest booking:', error);
            throw error;
        }

        return data || null;
    }

    async getLatestBookingForEmail(email: string) {
        const user = await this.findUserByEmail(email);
        if (!user) return null;
        return await this.getLatestBookingForCustomerId(user.id);
    }

    async waitForLatestBooking(email: string, options?: { timeoutMs?: number; intervalMs?: number; statuses?: string[] }) {
        const timeoutMs = options?.timeoutMs ?? 30000;
        const intervalMs = options?.intervalMs ?? 1000;
        const statuses = (options?.statuses || []).map(s => s.toLowerCase());

        const endTime = Date.now() + timeoutMs;
        while (Date.now() < endTime) {
            const booking = await this.getLatestBookingForEmail(email);
            if (booking) {
                if (statuses.length == 0) return booking;
                const statusValue = String(booking.status || '').toLowerCase();
                if (statuses.includes(statusValue)) return booking;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        throw new Error(`Timed out waiting for booking for ${email}`);
    }

    async getBookingsForCustomerId(customerId: string, sinceIso?: string) {
        let query = this.supabase
            .from('bookings')
            .select('*')
            .eq('customer_id', customerId)
            .order('created_at', { ascending: false });

        if (sinceIso) {
            query = query.gte('created_at', sinceIso);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    }

    async getBookingsForCustomerEmail(email: string, sinceIso?: string) {
        const user = await this.findUserByEmail(email);
        if (!user) return [];
        return this.getBookingsForCustomerId(user.id, sinceIso);
    }
    async cleanupSettlements(ownerEmail: string) {
        const { data: user } = await this.supabase
            .from('accounts')
            .select('id')
            .eq('email', ownerEmail)
            .single();

        if (user) {
            await this.supabase
                .from('settlements')
                .delete()
                .eq('owner_id', user.id);
        }
    }

    async getSettlementsForOwner(ownerEmail: string) {
        const user = await this.findUserByEmail(ownerEmail);
        if (!user) return [];
        const { data, error } = await this.supabase
            .from('settlements')
            .select('*')
            .eq('owner_id', user.id)
            .order('week_start_date', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async createOwnerSettlement(ownerEmail: string, options?: {
        status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
        totalAmount?: number;
        platformFee?: number;
        netPayable?: number;
        providerTransferId?: string;
        providerReference?: string;
        processedAt?: string;
    }) {
        const user = await this.findUserByEmail(ownerEmail);
        if (!user) throw new Error(`Owner ${ownerEmail} not found`);
        await this.ensureOwnerProfile(user.id, ownerEmail);

        const baseDate = new Date();
        const defaultTotal = options?.totalAmount ?? 5000;
        const defaultFee = options?.platformFee ?? 500;
        const defaultNet = options?.netPayable ?? Math.max(0, defaultTotal - defaultFee);

        let lastError: { code?: string; message?: string } | null = null;
        for (let attempt = 0; attempt < 7; attempt++) {
            const now = new Date(baseDate);
            now.setDate(baseDate.getDate() + attempt);
            const dateStr = now.toISOString().split('T')[0];

            const { data: settlement, error } = await this.supabase
                .from('settlements')
                .insert({
                    owner_id: user.id,
                    total_amount: defaultTotal,
                    platform_fee: defaultFee,
                    net_payable: defaultNet,
                    status: options?.status || 'PENDING',
                    week_start_date: dateStr,
                    week_end_date: dateStr,
                    provider_transfer_id: options?.providerTransferId || null,
                    provider_reference: options?.providerReference || null,
                    processed_at: options?.processedAt || null,
                    created_at: now.toISOString()
                })
                .select()
                .single();

            if (error) {
                lastError = error as { code?: string; message?: string };
                if (error.code === '23505') {
                    continue;
                }
                console.error('Error creating settlement:', error);
                throw new Error(`Failed to create settlement: ${error.message}`);
            }

            return settlement;
        }

        const suffix = lastError?.message ? `: ${lastError.message}` : '';
        throw new Error(`Failed to create settlement after retries${suffix}`);
    }

    async getRefundForBooking(bookingId: string) {
        const { data, error } = await this.supabase
            .from('refunds')
            .select('*')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async markBookingRefunded(bookingId: string, refundAmount?: number) {
        const { data: payment, error: paymentError } = await this.supabase
            .from('payments')
            .select('*')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (paymentError) throw paymentError;

        const { data: booking, error: bookingErrorLookup } = await this.supabase
            .from('bookings')
            .select('customer_id')
            .eq('id', bookingId)
            .maybeSingle();
        if (bookingErrorLookup) throw bookingErrorLookup;

        const amount = refundAmount ?? Number(payment?.amount || 0);
        if (!payment || amount <= 0) {
            throw new Error(`No valid payment found for booking ${bookingId}`);
        }
        if (!booking?.customer_id) {
            throw new Error(`No customer_id found for booking ${bookingId}`);
        }

        const paymentAttemptId = await this.ensurePaymentAttemptForPayment(String(payment.id));

        const { error: bookingError } = await this.supabase
            .from('bookings')
            .update({ status: 'refunded', payment_status: 'refunded' })
            .eq('id', bookingId);
        if (bookingError) throw bookingError;

        const { error: paymentUpdateError } = await this.supabase
            .from('payments')
            .update({ status: 'refunded' })
            .eq('id', payment.id);
        if (paymentUpdateError) throw paymentUpdateError;

        const refundPayload = {
            payment_attempt_id: paymentAttemptId,
            idempotency_key: `e2e-refund-${payment.id}`,
            amount,
            payment_id: payment.id,
            booking_id: bookingId,
            customer_id: booking.customer_id,
            refund_amount: amount,
            refund_id: `e2e-refund-${payment.id}`,
            refund_status: 'SUCCESS',
            reason: 'E2E refund helper',
            refund_reason: 'E2E refund helper',
            initiated_by: 'e2e-helper',
            provider: 'cashfree',
            status: 'SUCCESS',
            processed_at: new Date().toISOString()
        };

        let nextPayload: Record<string, unknown> = { ...refundPayload };
        while (true) {
            const { error: refundError } = await this.supabase.from('refunds').insert(nextPayload);
            if (!refundError) {
                break;
            }

            const message = String(refundError.message || '').toLowerCase();
            const missingColumn = refundError.code === 'PGRST204'
                ? (
                    message.match(/could not find the '([a-z0-9_]+)' column of 'refunds'/)?.[1]
                    || message.match(/column refunds\.([a-z0-9_]+) does not exist/)?.[1]
                )
                : null;

            if (!missingColumn || !(missingColumn in nextPayload)) {
                throw refundError;
            }

            const { [missingColumn]: _ignored, ...rest } = nextPayload;
            nextPayload = rest;
        }
    }

    async getLatestAuditLog(action: string, bookingId?: string) {
        const { data, error } = await this.supabase
            .from('audit_logs')
            .select('*')
            .eq('action', action)
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) throw error;
        if (!bookingId) return data?.[0] || null;
        return (data || []).find((log: { details?: { bookingId?: string } }) => log.details?.bookingId === bookingId) || null;
    }

    async waitForRefund(bookingId: string, timeoutMs: number = 30000) {
        const endTime = Date.now() + timeoutMs;
        while (Date.now() < endTime) {
            const refund = await this.getRefundForBooking(bookingId);
            if (refund) return refund;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`Timed out waiting for refund for booking ${bookingId}`);
    }
}
