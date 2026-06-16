# Vestano Timesheet Portal

Corporate employee timesheet and attendance portal for Vestano International Pvt Ltd.

## Features

- Employee work entries and admin approvals
- Admin employee management
- eSSL K90 Pro attendance integration using ADMS/iClock push
- Employee-specific attendance dashboard
- Profile image uploads
- Email OTP password-reset workflow

## Run locally

```powershell
npm start
```

Open `http://localhost:3000`.

The eSSL receiver listens on TCP port `8081`.

## Local Node backend

The local Node server remains available for development and direct LAN attendance-device
testing. Copy `.env.example` to `.env` and provide SMTP credentials to enable its email OTP.

Runtime data under `data/` is intentionally excluded from Git.

## Supabase backend

The GitHub Pages build uses Supabase Auth, Postgres, Row Level Security, and Edge Functions.
Until `public/supabase-config.js` is filled, the page uses browser fallback storage so the UI
can be tested. Fallback data is saved only on that device.

1. Create a Supabase project.
2. Put its project URL and publishable/anon key in `public/supabase-config.js`.
3. Link the Supabase CLI and apply `supabase/migrations`.
4. Deploy the `admin-users` and `iclock` Edge Functions.
5. Create the first user in Supabase Authentication with `employee_id` and `name` user metadata.
   The first profile is assigned the admin role automatically.
6. Disable public sign-ups after creating the first administrator.

For email password-reset codes, change the Supabase magic-link email template to include
`{{ .Token }}`. The K90 endpoint is:

`https://<project-ref>.supabase.co/functions/v1/iclock/iclock/cdata`
