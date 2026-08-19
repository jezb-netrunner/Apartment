# Orange Apartment — Tenant Billing Portal

A single-page tenant billing portal for apartments and multi-level condominiums.
No build step, no framework: `index.html` + `app.js` + `app.css`, backed by
[Supabase](https://supabase.com) (Postgres + REST + RPC), hosted free on GitHub Pages.

## What it does

**For the landlord/admin** (email + password login):
- Tenant records with per-tenant **billing model**:
  - *Itemized* — rent + utilities billed as separate line items.
  - *All-inclusive* — one flat monthly rate; management shoulders utilities.
- Bills with due dates, partial payments, remarks, scanned-bill links.
- Monthly **bill templates** + one-click "Generate Bills" for the whole building.
- **Expenses ledger** (electricity, water, maintenance…) with a monthly
  *collected − expenses = net* readout — the number that tells you whether an
  all-inclusive rate is still profitable after utilities.
- Floor/group labels with per-floor outstanding rollups.
- Insights: a **Key Findings** digest (collection pace, who to chase, habitual
  late payers, utility cost spikes, what the all-inclusive rates are
  absorbing), plus billed vs collected, utilities paid vs billed back,
  payment behavior, top outstanding, overdue aging, and net position.
- Printable Statements of Account (customizable, live preview), payment
  reminders ready to paste into SMS/Messenger/Viber, CSV export.
- Announcements board and payment instructions pushed to every tenant portal.
- Property name/tagline setting — rebrand the whole portal for any building
  without touching code.

**For tenants** (access code or one-tap portal link):
- Their bills, balance, payment history, and printable statement.
- All-inclusive tenants see their flat rate ("utilities included") and a
  simple *Paid ✓ / Due in N days* status instead of a bill breakdown.
- "Keep me signed in" + `?code=XXXX` deep links — the reminder message logs
  them straight in.

## Setup for a new building

1. **Supabase project** — create one, then in the SQL editor create the base tables:
   ```sql
   CREATE TABLE tenants (
     id text PRIMARY KEY,
     name text NOT NULL, unit text NOT NULL, code text NOT NULL,
     phone text, email text, move_in_date date,
     bills jsonb NOT NULL DEFAULT '[]',
     templates jsonb NOT NULL DEFAULT '[]',
     archived_at timestamptz
   );
   CREATE TABLE settings ( key text PRIMARY KEY, value text NOT NULL DEFAULT '' );
   ```
2. Run `supabase-migration.sql` (RLS, tenant-login RPC, rate limiting).
3. Run `supabase-migration-2.sql` (billing models, expenses table, floor labels,
   unique access codes, per-IP login throttling, optimistic concurrency).
   Both files are idempotent — safe to re-run.
4. Create the admin user under Supabase **Authentication → Users**.
5. In `app.js`, set `SB_URL` and `SB_KEY` to your project's URL and publishable
   key; update the `connect-src` host in `index.html`'s CSP to match.
6. Push to GitHub with Pages enabled — `.github/workflows/deploy.yml` deploys
   on every push to `main` (SQL files are stripped from the published site).
7. Sign in as admin → **Property → Edit** to set your building's name.

## Security model

- **Admin**: Supabase email auth (JWT). Row Level Security grants
  `authenticated` full CRUD on `tenants`, `settings`, `expenses`.
  Sessions live in memory and end with the tab unless the admin ticks
  **"Keep me signed in on this device"** at login — only then is the
  Supabase session (refresh token included) persisted to that device's
  localStorage. Signing out always clears it. Don't use the option on a
  shared computer.
- **Tenant**: an access code is exchanged for that tenant's row via the
  `login_tenant` RPC — the only anon path to tenant data. Failed attempts are
  rate-limited per code (5/15 min), per IP (20/15 min), and globally
  (circuit breaker). Successful logins are never throttled.
- Anon can additionally read only an allow-listed set of tenant-facing
  settings (payment instructions, announcements, property name).
- Tenant PATCHes carry an optimistic-concurrency `rev` token so two admin
  devices can't silently overwrite each other's changes.
- The tenant access code is a bearer credential for a read-only view of that
  tenant's own bills. "Keep me signed in" stores it on the tenant's device;
  portal links embed it in the URL (stripped from the address bar on load).
  That trade-off is deliberate — nothing money-moving lives behind it.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup: login, app shell, modals. CSP locked to self + Supabase. |
| `app.js` | All logic (~4.5k lines, vanilla JS). |
| `app.css` | All styles, mobile-first responsive. |
| `supabase-migration.sql` | v1 schema hardening: RLS, login RPC, rate limiting. |
| `supabase-migration-2.sql` | v2: billing models, expenses, floors, concurrency. |
| `vendor/` | Pinned supabase-js, served locally so the CSP stays `'self'`. |
