# Supabase Production Rollout

## Scope

This rollout hardens the `public.config` table and removes the live automation dependency on it for internal payout, refund, settlement, and notification jobs.

## SQL Changes Included

- Deploy edge functions:
  - `cashfree-refund`
  - `cashfree-settlement`
  - `sync-processing-settlements`
- Set edge secret:
  - `ROOMFINDR_INTERNAL_AUTOMATION_KEY`
- Apply migrations:
  - `supabase/migrations/20260406193000_harden_config_rls_and_secret_rows.sql`
  - `supabase/migrations/20260406203000_move_internal_automation_secrets_to_vault.sql`
- Post-deploy verification: `supabase/production_security_verification.sql`

## Deploy Order

1. Take a fresh database backup or snapshot.
2. Deploy the updated edge functions in staging.
3. Apply the new migrations in staging.
4. Run the verification SQL in staging.
5. Smoke test these flows in staging:
   - Customer booking creation
   - Payment order creation
   - Refund prepare/process
   - Settlement sync / payout sync
   - Owner bank verification sync
6. Confirm admin users can still use app settings screens.
7. Deploy the updated edge functions in production during a low-traffic window.
8. Apply the migrations in production.
9. Re-run the verification SQL in production.

## Required Checks

- `public.config` secret rows are not visible to authenticated admin sessions.
- `public.config` no longer stores `supabase_service_role_key`.
- Internal automation paths read runtime values from `vault.decrypted_secrets` through `private.*` helper functions.
- Edge functions can validate internal automation calls against `ROOMFINDR_INTERNAL_AUTOMATION_KEY` without reopening `public.config`.
- `settings` reads/writes in admin panel still work.
- Payment and refund edge functions still execute successfully.

## Residual Risk

The internal service-role JWT still exists in Supabase Vault and in the deployed edge-function environment, so rotation discipline still matters. The main public-table exposure path is removed, but secret rotation should still be part of release operations.
