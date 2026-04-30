# Admin Panel Testing Guide

## Access prerequisites

You need a valid Supabase-authenticated user whose `public.accounts.role` is `admin`.

## Core scenarios

### Admin sign-in

- Sign in with an admin account
- Confirm protected routes load
- Confirm a non-admin account is denied access

### Owner verification

- Open the owner management flow
- Review pending owner details
- Approve or reject and confirm the owner state updates correctly

### Property moderation

- Open property oversight pages
- Review pending or flagged properties
- Verify moderation actions update the property state correctly

### Settings and operations

- Open settings screens
- Confirm reads and writes still work
- Confirm no secret values are exposed in browser responses

## Commands

```bash
cd admin-panel
npm test
npm run test:e2e
npm run lint
npm run build
```

## Notes

- Use staging or safe test data when verifying moderation and finance flows.
- If auth behavior changes, retest both admin login and non-admin denial paths.
