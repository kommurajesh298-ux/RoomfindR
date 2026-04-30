# Cloudflare Production Checklist

## DNS

- Add:
  - `app` -> customer app origin
  - `owner` -> owner app origin
  - `admin` -> admin app origin
- Proxy all three through Cloudflare.

## Caching

- Enable:
  - Auto Minify
  - Brotli
  - Early Hints
- Cache static assets:
  - `*.js`
  - `*.css`
  - `*.woff2`
  - `*.png`
  - `*.jpg`
  - `*.webp`
- Do not aggressively cache:
  - `index.html`
  - authenticated API responses

## Security

- Enable:
  - WAF managed rules
  - Bot fight mode
  - DDoS protection
  - Rate limiting on high-risk public endpoints

## Performance

- Turn on image optimization for large property images.
- Validate that cache hit ratio improves on JS/CSS/image traffic after rollout.
