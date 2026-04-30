# Email OTP: Free Tier Setup

This guide covers a hosted Supabase plus Resend setup for low-volume testing with `onboarding@resend.dev`.

This is acceptable for testing, but it is not a production-grade inbox delivery setup.

## Supabase SMTP

In Supabase Dashboard, open `Auth -> SMTP` and configure:

| Field | Value |
| --- | --- |
| Enable Custom SMTP | ON |
| SMTP Host | `smtp.resend.com` |
| SMTP Port | `587` |
| Username | `resend` |
| Password | Resend production API key |
| Sender Email | `onboarding@resend.dev` |
| Sender Name | `RoomFindR` |
| TLS | Auto |
| Minimum interval per user | `30 seconds` |

## Auth settings

In Supabase Dashboard, open `Auth -> Providers`:

- enable email provider
- disable magic links
- enable email OTP
- use 6-digit OTP
- use 300-second expiry
- keep resend cooldown at 30 seconds

## Email template

Suggested subject:

```text
Your RoomFindR verification code
```

Suggested body:

```text
Your RoomFindR verification code is: {{ .Token }}

This code expires in 5 minutes.
```

Keep the template simple:

- no links
- no images
- no buttons

## Frontend expectations

- send OTP once per click
- enforce resend cooldown
- accept numeric 6-digit OTP input
- show friendly errors for invalid, expired, or rate-limited requests

## Limitations

- delivery may land in inbox or spam
- delivery speed can vary
- this setup is for testing, not trusted production delivery

## Not allowed for this flow

- local Supabase
- Mailpit
- Gmail or Yahoo SMTP
- Resend test keys
