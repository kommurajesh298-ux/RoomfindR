const { createSupabaseAdminClient } = require('./supabase-admin-client');

let supabase;

try {
    supabase = createSupabaseAdminClient();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

const USER_EMAIL = 'kommurajesh298@gmail.com';
const USER_PASSWORD = 'Rajesh@7674';
const USER_ROLE = 'admin';

async function createAdmin() {
    console.log(`Creating Admin: ${USER_EMAIL}...`);

    try {
        // 1. Check if user exists in Auth
        const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) throw listError;

        let user = usersData.users.find(u => u.email === USER_EMAIL);
        let userId;

        if (user) {
            console.log(`User ${USER_EMAIL} already exists in Auth. ID: ${user.id}`);
            userId = user.id;
        } else {
            // 2. Create User in Auth
            const { data, error } = await supabase.auth.admin.createUser({
                email: USER_EMAIL,
                password: USER_PASSWORD,
                email_confirm: true,
                user_metadata: { role: USER_ROLE, name: 'Rajesh Admin' },
                app_metadata: { role: USER_ROLE }
            });

            if (error) throw error;
            console.log(`Created ${USER_EMAIL} in Auth.`);
            userId = data.user.id;
        }

        // 3. Sync to public.accounts
        console.log(`Syncing to public.accounts...`);
        const { error: accountError } = await supabase.from('accounts').upsert({
            id: userId,
            email: USER_EMAIL,
            role: USER_ROLE,
            updated_at: new Date().toISOString()
        });

        if (accountError) console.error(`Failed to update accounts:`, accountError);
        else console.log(`Synced public.accounts for ${USER_EMAIL}`);

        // 4. Upsert into public.admins
        console.log(`Syncing to public.admins...`);
        const { error: adminError } = await supabase.from('admins').upsert({
            id: userId,
            name: 'Rajesh Admin',
            email: USER_EMAIL,
            updated_at: new Date().toISOString()
        });

        if (adminError) console.error(`Failed to upsert admins:`, adminError);
        else console.log(`Synced public.admins for ${USER_EMAIL}`);

        console.log('\nAdmin creation complete!');
        console.log(`Email: ${USER_EMAIL}`);
        console.log(`Password: ${USER_PASSWORD}`);

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
    }
}

createAdmin();
