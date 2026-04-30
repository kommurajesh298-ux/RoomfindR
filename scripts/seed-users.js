const { createSupabaseAdminClient } = require('./supabase-admin-client');

let supabase;

try {
    supabase = createSupabaseAdminClient();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

const TEST_USERS = [
    { email: 'test_customer_e2e@example.com', password: 'password123', role: 'customer', phone: '9000000001' },
    { email: 'test_owner_e2e@example.com', password: 'password123', role: 'owner', phone: '9000000002' },
    { email: 'test_admin_e2e@example.com', password: 'password123', role: 'admin', phone: '9000000003' }
];

async function upsertProfile(userId, user) {
    if (user.role === 'customer') {
        const { error } = await supabase.from('customers').upsert({
            id: userId,
            name: 'Test Customer',
            email: user.email,
            phone: '9000000001',
            city: 'Test City',
            updated_at: new Date().toISOString()
        });
        if (error) console.error(`Failed to upsert customers for ${user.email}:`, error);
    } else if (user.role === 'owner') {
        const { error } = await supabase.from('owners').upsert({
            id: userId,
            name: 'Test Owner',
            email: user.email,
            phone: '9000000002',
            verified: true,
            verification_status: 'approved',
            updated_at: new Date().toISOString()
        });
        if (error) console.error(`Failed to upsert owners for ${user.email}:`, error);
    } else if (user.role === 'admin') {
        const { error } = await supabase.from('admins').upsert({
            id: userId,
            name: 'Test Admin',
            email: user.email,
            updated_at: new Date().toISOString()
        });
        if (error) console.error(`Failed to upsert admins for ${user.email}:`, error);
    }
}

async function seed() {
    console.log('Seeding Users...');

    for (const u of TEST_USERS) {
        try {
            const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
            if (listError) throw listError;

            const exists = usersData.users.find(user => user.email === u.email);
            if (exists) {
                console.log(`User ${u.email} already exists.`);
                // Update anyway
                const { error: accountError } = await supabase.from('accounts').upsert({
                    id: exists.id,
                    email: u.email,
                    phone: u.phone,
                    role: u.role,
                    updated_at: new Date().toISOString()
                });
                if (accountError) console.error(`Failed to update accounts for ${u.email}:`, accountError);
                else console.log(`Synced public.accounts for ${u.email}`);
                await upsertProfile(exists.id, u);
                continue;
            }

            const { data, error } = await supabase.auth.admin.createUser({
                email: u.email,
                password: u.password,
                email_confirm: true,
                user_metadata: { role: u.role },
                app_metadata: { role: u.role }
            });

            if (error) {
                console.error(`Failed to create ${u.email}:`, error.message);
            } else {
                console.log(`Created ${u.email}`);
            }

            // Explicitly ensure public.accounts entry exists
            // (Login logic checks this table for role)
            const userId = exists ? exists.id : data.user.id;
            const { error: accountError } = await supabase.from('accounts').upsert({
                id: userId,
                email: u.email,
                phone: u.phone,
                role: u.role,
                updated_at: new Date().toISOString()
            });

            if (accountError) {
                console.error(`Failed to update accounts for ${u.email}:`, accountError);
            } else {
                console.log(`Synced public.accounts for ${u.email}`);
            }
            await upsertProfile(userId, u);
        } catch (error) {
            console.error(`Exception for ${u.email}:`, error);
        }
    }
    console.log('Seeding Complete.');
}

seed();
