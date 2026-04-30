# AWS Production Checklist

## Load Balancer

- Use an Application Load Balancer per public hostname or routing rule set:
  - `app.roomfindr.example`
  - `owner.roomfindr.example`
  - `admin.roomfindr.example`
- Health check path:
  - `/healthz`

## Autoscaling

- Minimum instances:
  - customer: `3`
  - owner: `2`
  - admin: `2`
- Suggested scale-out:
  - CPU > `70%` for 5 minutes
  - request count per target rising beyond healthy baseline
- Suggested scale-in:
  - CPU < `30%` for 15 minutes

## Observability

- Ship container logs to CloudWatch.
- Alarm on:
  - 5xx rate
  - unhealthy target count
  - p95 latency
  - payment webhook error spikes

## Deployment

- Use rolling or blue/green deploys.
- Build app images in CI with final `VITE_*` values.
- Keep Supabase and Cashfree credentials outside images.
