# Equus Jojimo Mokykla

Production booking and rider-management web app for **Equus Jojimo Mokykla / Pilaitės Žirgynas**.

Built and maintained by Adrija Kalikaitė.

## Stack

- React + TypeScript
- Vite
- Tailwind CSS + shadcn/Radix UI
- Supabase Auth + PostgreSQL + Edge Functions
- React Router
- TanStack Query
- Framer Motion
- Vitest + Testing Library
- PWA / service worker
- Cloudflare Pages / Vercel deployments

## Main areas

### Riders
- Weekly schedule and booking
- Subscription packages
- Individual / group / Po 2 lessons
- Waiting lists
- Cancellations and makeup handling
- Horse assignments
- Permanent weekly slots
- Account/profile settings
- LT / EN interface
- PWA installation and push notifications

### Staff
- Admin schedule management
- One-day slot overrides
- Rider/client management
- Subscriptions and payments
- Cancellation history
- Horse assignment
- Trainer rider rosters
- Statistics
- Site settings and maintenance mode

## Important booking rules

Keep these rules in sync with the database functions and UI:

- Maximum 5 trainings per day for the school schedule
- Group lesson duration: 50 minutes
- 15-minute self warm-up before riding
- Arena capacity: normally 4
- One horse cannot have two riders at the same time
- Horse daily ride limit is configurable by admin
- Subscription duplicates are only automatically removed when the narrow duplicate pattern matches:
  same rider + date + lesson purpose/type + times within 15 minutes + one subscription booking without a horse + one horse-assigned duplicate

## Project structure

```
src/
  components/       Reusable UI and booking components
  contexts/         Auth, language, theme and effects state
  lib/              Supabase helpers and shared utilities
  pages/            Route-level screens
  integrations/     Supabase client and generated types

supabase/
  functions/        Edge Functions
  migrations/       Database schema, RLS and business rules

public/
  sw.js             PWA service worker
  manifest.webmanifest
  og-image.svg      Social sharing preview
```

## Local development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run linting:

```bash
npm run lint
```

Run tests:

```bash
npm run test
```

## Environment

Frontend variables use the `VITE_` prefix.

Never commit:

- Supabase service-role/secret keys
- private API keys
- local `.env` files
- credentials or tokens

The browser should only receive publishable/anon-safe configuration.

## Database changes

All production database changes should be committed as timestamped migrations under:

```
supabase/migrations/
```

For security-sensitive migrations, test both the allowed and denied cases before applying them to production.

## Security notes

- Normal riders can see the rider information intentionally needed for a shared lesson, but their private profile/contact information is restricted.
- Admins and trainers retain access to staff-only profile information.
- Public phone-based authentication endpoints are rate-limited server-side without requiring a paid third-party service.
- Password changes for already signed-in users use Supabase Auth directly instead of the public phone-reset endpoint.
- The public recovery endpoint remains a legacy free recovery path and should eventually be replaced with a single-use email/OTP recovery flow if the school needs stronger account recovery assurance.

## Deployment

The production frontend is deployed from `main`.

Before merging a risky database change:

1. Review the migration.
2. Run the build.
3. Run tests/lint.
4. Verify the affected flow with a normal rider account.
5. Verify the same flow with an admin/trainer account where applicable.
