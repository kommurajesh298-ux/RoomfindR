# Admin Panel Security Notes

## Current security model

The admin panel uses Supabase, not Firebase. Access control should be enforced with:

- Supabase Auth sessions
- role checks against `public.accounts`
- Row Level Security policies on admin-sensitive tables
- edge-function secrets for internal automation

## Required expectations

1. Admin users must resolve to `role = 'admin'` in `public.accounts`.
2. Admin-only tables or rows must not be writable by normal authenticated users.
3. Public frontend environments must never contain:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - payment provider secrets
   - internal automation secrets
4. Sensitive values should live in Supabase Vault or server-side secrets.

## Recommended table coverage

Review RLS and grants for:

- `accounts`
- `owners`
- `properties`
- `settings`
- payment, refund, settlement, and audit-related tables

## Verification checklist

- Non-admin users cannot open the admin panel successfully.
- Admin screens still load with authenticated admin sessions.
- Secret rows are not exposed through public tables or browser queries.
- Internal automation paths use secure server-side values only.
