# Owner App Architecture

## Overview

The owner app is a React + Vite application backed by Supabase. It manages owner onboarding, property management, bookings, bank verification state, settlements, and owner-to-customer communication.

## Main providers and hooks

- `AuthProvider`: bootstraps the authenticated owner session and owner-linked profile data
- `OwnerProvider`: derives owner verification, bank verification, property counts, and booking counts
- `useAuth`, `useOwner`, and `useSite`: expose app state to pages and components

## Primary data sources

- `accounts`: shared identity and role information
- `owners`: owner profile and approval state
- `owner_bank_accounts`: bank verification and payout readiness state
- `properties`: owner-managed listings
- `bookings`, payments, refunds, and settlements tables for operations

## Authentication and verification flow

1. Owner authenticates with Supabase Auth.
2. The app resolves the user's role from `accounts`.
3. Owner profile and verification state are loaded from `owners` and related tables.
4. The UI gates key actions until required approval and bank verification conditions are met.

## Realtime behavior

- owner profile updates
- property list updates
- booking changes
- refund and settlement updates
- site settings updates

These flows are driven by Supabase realtime subscriptions, not Firebase listeners.

## Operational notes

- Verification is no longer documented as a direct Firestore flag update.
- Bank verification state is part of the owner approval flow and can affect whether payouts and operational features are enabled.
