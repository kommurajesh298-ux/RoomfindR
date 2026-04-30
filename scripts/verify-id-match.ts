import fs from 'fs';
import path from 'path';
import type { User } from '@supabase/supabase-js';
import { SupabaseAdminHelper } from '../tests/helpers/supabase-admin';

type BrowserStorageEntry = {
    name: string;
    value: string;
};

type BrowserAuthSnapshot = {
    origins: Array<{
        localStorage: BrowserStorageEntry[];
    }>;
};

type BrowserAuthUser = Pick<User, 'id' | 'email'>;

async function main() {
    console.log('--- VERIFY ID MATCH ---');

    const authPath = path.resolve('playwright/.auth/customer.json');
    if (!fs.existsSync(authPath)) {
        console.error('Auth file not found:', authPath);
        return;
    }

    const authContent = JSON.parse(fs.readFileSync(authPath, 'utf8')) as BrowserAuthSnapshot;
    const storage = authContent.origins[0]?.localStorage || [];
    const tokenEntry = storage.find((entry) => entry.name.includes('auth-token'));
    if (!tokenEntry) {
        console.error('No auth token found in storage');
        return;
    }

    const user = JSON.parse(tokenEntry.value).user as BrowserAuthUser;
    console.log(`[BROWSER] Auth User: ${user.email} (${user.id})`);

    const admin = new SupabaseAdminHelper();
    console.log(`[HELPER] Searching for users with email: ${user.email}`);

    const targetUsers: User[] = [];
    let page = 1;
    while (true) {
        const { data: pageData, error } = await admin.supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) {
            console.error(error);
            break;
        }

        if (pageData.users.length === 0) break;

        const matches = pageData.users.filter((candidate) => candidate.email === user.email);
        targetUsers.push(...matches);

        page += 1;
        if (page > 50) break;
    }

    console.log(`[HELPER] Found ${targetUsers.length} users:`);
    targetUsers.forEach((targetUser) => console.log(` - ${targetUser.id}`));

    const found = targetUsers.some((targetUser) => targetUser.id === user.id);
    if (found) {
        console.log('SUCCESS: Browser User ID found by Helper.');
        console.log('Attempting manual cleanup via script...');

        const { error } = await admin.supabase.from('bookings').delete().eq('customer_id', user.id);
        if (error) console.error('Cleanup Error:', error);
        else console.log('Cleanup Success (Manual Delete).');
        return;
    }

    console.error('FAILURE: Browser User ID NOT found by Helper!');
    console.error('Helper found IDs:', targetUsers.map((targetUser) => targetUser.id));
    console.error('Browser ID:', user.id);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
});
