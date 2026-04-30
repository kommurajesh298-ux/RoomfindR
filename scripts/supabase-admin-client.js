const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

const loadEnvFiles = () => {
    [
        '../supabase/.env',
        '../.env.local',
        '../.env',
        '../customer-app/.env',
        '../customer-app/.env.development'
    ].forEach((envPath) => {
        dotenv.config({ path: path.resolve(__dirname, envPath), override: false });
    });
};

const resolveEnv = (...names) => names
    .map((name) => process.env[name]?.trim())
    .find(Boolean);

const createSupabaseAdminClient = () => {
    loadEnvFiles();

    const supabaseUrl = resolveEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const serviceRoleKey = resolveEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
};

module.exports = {
    createSupabaseAdminClient
};
