# Production Infra Kit

This folder contains deployment scaffolding for the RoomFindR frontend apps.

## Included

- `docker/`
  - multi-stage production images for `customer-app`, `owner-app`, and `admin-panel`
- `nginx/spa.conf`
  - static SPA origin config with gzip, immutable asset caching, and SPA fallback
- `cloudflare/production-checklist.md`
  - DNS, cache, WAF, Brotli, and image optimization rollout checklist
- `aws/production-checklist.md`
  - ALB, autoscaling, health checks, and instance layout checklist

## Recommended Topology

1. Build each app image from this repo.
2. Run app images behind an ALB or Nginx reverse proxy.
3. Put Cloudflare in front of the public domains.
4. Keep Supabase and Cashfree as managed upstreams.

## Suggested Domains

- `app.roomfindr.example` -> customer app
- `owner.roomfindr.example` -> owner app
- `admin.roomfindr.example` -> admin app

Replace the `*.example` hostnames with your real production domains before rollout.

## Notes

- These images serve prebuilt static assets and do not alter business logic.
- Environment variables for Vite apps are injected at build time, so production builds should be created in CI with the final `VITE_*` values.
- `infra/nginx/spa.conf` already serves `/healthz`, so the containers do not need a static health file baked into the image.
- Redis cache secrets do not belong in the frontend apps. They must be configured in Supabase Edge Function secrets:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- Frontend monitoring belongs in the app build/runtime env:
  - `VITE_SENTRY_DSN`
  - `VITE_SENTRY_ENVIRONMENT`
  - `VITE_SENTRY_RELEASE`
