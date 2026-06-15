# Vestano Timesheet Portal

Corporate employee timesheet and attendance portal for Vestano International Pvt Ltd.

## Features

- Employee work entries and manager approvals
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

## Email OTP configuration

Copy `.env.example` to `.env` and provide the company SMTP mailbox credentials.

Runtime attendance, session, and employee data under `data/` is intentionally excluded from Git.
