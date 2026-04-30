# Production Email OTP

This document describes the production OTP setup for hosted Supabase plus Resend.

## Phase 1: environment cleanup

- remove local auth or SMTP values from frontend environments
- use hosted Supabase URL and anon key only in frontend apps
- never ship service-role keys to browser environments

## Phase 2: Resend production setup

1. Verify your sending domain in Resend.
2. Use a production API key.
3. Use a verified sender such as `no-reply@roomfindr.com`.
4. Avoid `onboarding@resend.dev` for real production delivery.

## Phase 3: DNS

Publish all required Resend DNS records:

- SPF
- DKIM
- domain verification
- DMARC

Example DMARC:

```text
v=DMARC1; p=none; rua=mailto:dmarc@roomfindr.com;
```

## Phase 4: Supabase SMTP

In Supabase Dashboard, open `Auth -> SMTP`:

| Field | Value |
| --- | --- |
| Enable Custom SMTP | ON |
| SMTP Host | `smtp.resend.com` |
| SMTP Port | `587` |
| SMTP User | `resend` |
| SMTP Password | `RESEND_API_KEY` |
| TLS | ENABLED |
| Sender Email | `no-reply@roomfindr.com` |
| Sender Name | `RoomFindR` |

## Phase 5: auth rules

- email OTP only
- disable magic links if OTP is the intended flow
- use 6-digit OTP
- use 300-second expiry
- keep resend cooldown at 30 seconds
- rate-limit OTP attempts

## Phase 6: email template

Subject:

```text
Your RoomFindR verification code
```

Body:

```text
Your RoomFindR verification code is: {{ .Token }}
This code expires in 5 minutes.
```

Keep the template minimal and avoid links or images.

## Phase 7: frontend behavior

Send OTP:

- validate email first
- disable the action immediately
- show loading state
- send only one request per click

Verify OTP:

- accept numeric OTP only
- validate before submit
- verify once
- restore session and continue the flow on success

## Phase 8: error handling

Handle and surface clear messages for:

- server errors
- timeouts
- resend restrictions
- duplicate attempts
- invalid OTP
- expired OTP

## Phase 9: security

- throttle resend requests
- prevent duplicate submissions
- clean auth listeners on unmount
- keep secrets out of the frontend

## Phase 10: production checks

Test delivery to:

- Gmail
- Outlook
- Yahoo
- a custom domain mailbox

Verify:

- OTP arrives quickly
- one email is sent per click
- delivery lands in expected folders
- browser console and network traces stay clean
