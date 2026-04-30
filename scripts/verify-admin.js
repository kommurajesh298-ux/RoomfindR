const { createSupabaseAdminClient } = require('./supabase-admin-client');

let supabase;

try {
    supabase = createSupabaseAdminClient();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

const USER_EMAIL = 'kommurajesh298@gmail.com';

async function verify() {
    console.log(`Verifying user: ${USER_EMAIL}`);

    const { data: accounts, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('email', USER_EMAIL)
        .single();

    if (accountError) {
        console.error('Error fetching account:', accountError.message);
    } else {
        console.log('Account found:', JSON.stringify(accounts, null, 2));
    }

    const { data: admin, error: adminError } = await supabase
        .from('admins')
        .select('*')
        .eq('email', USER_EMAIL)
        .single();

    if (adminError) {
        console.error('Error fetching admin profile:', adminError.message);
    } else {
        console.log('Admin profile found:', JSON.stringify(admin, null, 2));
    }
}

verify();
