# Supabase Setup Guide for RoomFindR

This guide walks you through setting up Supabase for the RoomFindR migration.

## Step 1: Create Supabase Project

1. **Sign up/Login to Supabase**
   - Go to [https://app.supabase.com](https://app.supabase.com)
   - Sign up for a free account or login

2. **Create a New Project**
   - Click "New Project"
   - Choose your organization
   - Fill in project details:
     - **Name**: `roomfindr` (or your preference)
     - **Database Password**: Create a strong password and **save it** somewhere safe
     - **Region**: Choose the region closest to your users (e.g., `ap-south-1` for India)
   - Click "Create new project"
   - Wait 2-3 minutes for project setup to complete

## Step 2: Get Your API Credentials

Once your project is ready:

1. Go to your project settings (⚙️ icon in sidebar → Project Settings)
2. Click "API" in the left menu
3. You'll see two important values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (long string starting with `eyJ...`)
4. **Copy these values** - you'll need them in Step 4

## Step 3: Run Database Schema

1. In your Supabase project dashboard, click on "SQL Editor" in the sidebar
2. Click "New Query"
3. Open the file `supabase/schema.sql` from this project
4. **Copy the entire contents** of `schema.sql`
5. **Paste it** into the SQL Editor
6. Click "Run" button (or press Ctrl+Enter)
7. Wait for execution to complete (you should see "Success" message)

This creates all 17 tables needed for RoomFindR.

## Step 4: Run Security Policies

1. Still in SQL Editor, click "New Query"
2. Open the file `supabase/policies.sql`
3. **Copy the entire contents** of `policies.sql`
4. **Paste it** into the SQL Editor
5. Click "Run"
6. Wait for completion

This sets up Row Level Security (RLS) policies for all tables.

## Step 5: Set Up Storage Buckets

1. Click "Storage" in the Supabase sidebar
2. Create the following buckets:

### Bucket 1: property-images
- Click "New bucket"
- **Name**: `property-images`
- **Public bucket**: ✅ Yes (check this)
- Click "Create bucket"

### Bucket 2: profile-photos
- **Name**: `profile-photos`
- **Public bucket**: ✅ Yes
- Click "Create bucket"

### Bucket 3: chat-media
- **Name**: `chat-media`
- **Public bucket**: ❌ No (private)
- Click "Create bucket"

### Bucket 4: documents
- **Name**: `documents`
- **Public bucket**: ❌ No (private)
- Click "Create bucket"

## Step 6: Configure Storage Policies

For each bucket, you need to set access policies:

### For property-images bucket:
1. Click on `property-images` bucket
2. Go to "Policies" tab
3. Click "New Policy"
4. Choose "Custom policy"
5. Create policy for SELECT (read):
   ```
   Policy name: Public read access
   Allowed operations: SELECT
   Policy definition: true
   ```
6. Click "Save"
7. Create another policy for INSERT (upload):
   ```
   Policy name: Authenticated users can upload
   Allowed operations: INSERT
   Policy definition: auth.role() = 'authenticated'
   ```

### For profile-photos bucket:
- Same as property-images (public read, authenticated upload)

### For chat-media and documents buckets:
1. SELECT policy:
   ```
   Policy name: Users can view own files
   Allowed operations: SELECT
   Policy definition: auth.uid() IS NOT NULL
   ```
2. INSERT policy:
   ```
   Policy name: Users can upload files
   Allowed operations: INSERT
   Policy definition: auth.uid() IS NOT NULL
   ```

## Step 7: Enable Realtime

1. Go to "Database" in Supabase sidebar
2. Click "Replication"
3. Find these tables and enable realtime for them:
   - ✅ `messages`
   - ✅ `chats`
   - ✅ `bookings`
   - ✅ `notifications`
   - ✅ `properties` (for live updates)

Click "Enable" for each table.

## Step 8: Update Environment Variables

1. Create a `.env` file in each app directory (customer-app, owner-app, admin-panel)
2. Copy the template from `.env.example`
3. Fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://[YOUR-PROJECT-ID].supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc[YOUR-ANON-KEY]

# Keep Firebase vars for now during migration
VITE_BACKEND_MODE=firebase
```

**IMPORTANT**: Do NOT commit actual `.env` files to git. They should be in `.gitignore`.

## Step 9: Verify Setup

1. Go to "Table Editor" in Supabase dashboard
2. You should see all 17 tables:
   - accounts
   - customers
   - owners
   - properties
   - rooms
   - food_menu
   - bookings
   - payments
   - chats
   - messages
   - notifications
   - notices
   - offers
   - claimed_offers
   - favorites
   - analytics
   - audit_logs

3. Go to "Storage" and verify 4 buckets exist

4. Go to "Authentication" → "Settings" and ensure:
   - Email provider is enabled
   - User email confirmation is configured as needed

## Troubleshooting

### Schema Errors
- If you get "relation already exists" errors, it means tables are already created
- Check "Table Editor" to see what exists
- You can drop tables and re-run if needed (be careful!)

### Policy Errors
- If policies fail, make sure the schema was created first
- Check that RLS is enabled on tables

### Storage Issues
- Make sure bucket names are exactly as specified (case-sensitive)
- Verify public/private settings match above

## Next Steps

Once Supabase is set up:
1. ✅ All tables created
2. ✅ RLS policies applied
3. ✅ Storage buckets configured
4. ✅ Environment variables set

You're ready to proceed with the authentication migration!

## Support Resources

- **Supabase Documentation**: https://supabase.com/docs
- **SQL Editor**: Test queries directly in dashboard
- **Logs**: Check "Logs" in sidebar for debugging
- **API Docs**: Auto-generated API docs in your project
