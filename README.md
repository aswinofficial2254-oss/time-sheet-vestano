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

## Deploy the full portal

GitHub Pages only runs the browser demo. To run login, employees, approvals, attendance,
profile updates, and persistent data, deploy the repository as a Node web service using
the included `render.yaml` Blueprint.

On Render, the portal and eSSL ADMS receiver share the service's HTTPS port. Configure
the attendance machine with the deployed hostname and HTTPS port `443`. Runtime data is
stored on the mounted `/var/data` persistent disk.

## Email OTP configuration

Copy `.env.example` to `.env` and provide the company SMTP mailbox credentials.

Runtime attendance, session, and employee data under `data/` is intentionally excluded from Git.
