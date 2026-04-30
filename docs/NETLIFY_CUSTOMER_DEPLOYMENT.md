# Netlify Customer Deployment

## Build settings

- Base directory: `customer-app`
- Build command: `npm run build`
- Publish directory: `dist`

If you prefer config-based setup, Netlify can read `customer-app/netlify.toml` once the site base directory is set to `customer-app`.

## SPA routing

The customer Vite build now emits `customer-app/public/_redirects`, which becomes `dist/_redirects` during build:

```text
/*    /index.html   200
```

This prevents refresh-time 404s for React Router routes such as `/bookings`, `/chat`, `/payment`, and `/property/:id`.

## Netlify environment variables

Use `customer-app/.env.production.example` as the safe frontend template.

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Recommended:

- `VITE_SITE_URL`
- `VITE_PAYMENT_RETURN_BASE_URL`
- `VITE_CUSTOMER_PAYMENT_RETURN_BASE_URL`
- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT`
- `VITE_SENTRY_RELEASE`

Do not add server-side secrets such as:

- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_TOKEN`
- `CASHFREE_CLIENT_SECRET`

## Validation checklist

1. Open `/`, `/bookings`, `/chat`, and `/payment`.
2. Refresh each route and confirm the app stays on the route instead of returning a 404.
3. Verify login and session restore.
4. Confirm Supabase requests succeed with no CORS errors.
5. Confirm payment pages render with production env values.
