# Deployment

This document describes how the system is hosted, how a change reaches
production, and how to perform the one-time move onto your own
infrastructure.

The philosophy is unchanged: **simple, reliable, cheap**. A single operator
with a few thousand subscribers should run at ~₹0/month.

---

## 1. The production stack

```
[ Browser ]
     │ HTTPS
     ▼
[ Vercel ]      static Vite build of src/  (free Hobby tier)
     │ HTTPS
     ▼
[ Supabase ]    Postgres + Auth + RLS + RPCs + cron  (free tier)
```

- **Frontend**: static bundle. No server-side rendering, no Node runtime, no
  serverless functions. Any static host works — Vercel is the default.
- **Backend**: your own Supabase project. All business logic lives in SQL
  functions with RLS; the browser talks to PostgREST directly.
- **Cron**: `expire_lapsed_subscriptions` runs hourly via `pg_cron`.

### Choosing the frontend host

All three are free for this workload and deploy on `git push`. The app is a
pure SPA, so the only real requirements are HTTPS, a custom domain, and an
SPA fallback (every unknown path serves `index.html`).

| | **Vercel** (chosen) | Cloudflare Pages | Netlify |
|---|---|---|---|
| Free bandwidth | 100 GB/mo | Unlimited | 100 GB/mo |
| Free builds | 6,000 min/mo | 500 builds/mo | 300 min/mo |
| Preview deploys per PR | Yes | Yes | Yes |
| Custom domain + SSL | Free | Free | Free |
| SPA fallback | `vercel.json` (already in repo) | `_redirects` file | `_redirects` file |
| India edge presence | Mumbai PoP | Strongest (Mumbai + Chennai) | Via CDN, no India PoP on free |
| Cost if you outgrow free | $20/user/mo | $5/mo Workers Paid | $19/user/mo |

**Why Vercel**: best-in-class preview deployments (every PR gets its own
URL, which is how you'll test against the production database safely — see
§5), zero-config Vite detection, and the free tier is far above this app's
traffic. Realistic usage for a few thousand subscribers with staff phones
hitting the app all day is well under 5 GB/month.

**When to pick Cloudflare Pages instead**: if bandwidth ever becomes the
binding constraint (it won't at this scale), or if you want the lowest
latency in India. The tradeoff is a slightly clunkier preview-deploy
experience. Migration is trivial — swap `vercel.json` for a `public/_redirects`
file containing `/*  /index.html  200`.

**When to pick Netlify**: no strong reason here. Its free build minutes are
the tightest of the three, and it has no India edge on the free plan.

You are not locked in. The build output is plain static files; moving hosts
is a 15-minute job.

---

## 2. Cost and limits (free tier reality check)

Supabase free tier, and what this app actually uses:

| Limit | Free tier | Expected at 3,000 subscribers |
|---|---|---|
| Database size | 500 MB | ~50–80 MB after 2 years of transactions |
| Monthly active users (auth) | 50,000 | 1–5 (staff accounts) |
| Egress | 5 GB/mo | < 1 GB |
| Storage | 1 GB | Unused today |
| Edge function invocations | 500k/mo | Unused today |
| Backups | Daily, **7-day retention** | — |
| **Pause after inactivity** | **7 days with zero requests** | Not a risk — daily use |

The two free-tier facts that matter operationally:

1. **Backups are 7-day retention and cannot be restored from the UI on the
   free plan without support involvement.** Mitigate with your own nightly
   `pg_dump` (§6). Do not skip this.
2. **No point-in-time recovery.** Your recovery point objective is
   "yesterday's dump". Acceptable for this business; upgrade to Pro ($25/mo)
   the day that stops being true.

Upgrade triggers: database > 400 MB, or you want PITR, or you need more
than 7 days of backup retention.

---

## 3. One-time migration onto your own Supabase project

Do this once, in one sitting, with no staff using the app.

### 3.1 Create the project

1. Create a Supabase account and a new project in the **ap-south-1
   (Mumbai)** region — lowest latency for Indian users.
2. Save the database password in a password manager immediately. It is
   shown once.
3. Note the project ref (the subdomain of the project URL).

### 3.2 Move the schema

The full schema history is in `supabase/migrations/` (75 files). Applying
them in order reproduces the database exactly.

```sh
npm install -g supabase           # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-new-project-ref>
supabase db push                  # applies every migration in order
```

Verify:

```sh
supabase migration list --linked  # local and remote columns must match
```

### 3.3 Move the data

Export from the current backend, import into yours. Schema is already in
place, so this is data-only.

```sh
# Export (run against the OLD database connection string)
pg_dump "$OLD_DB_URL" \
  --data-only \
  --schema=public \
  --exclude-table-data='public.provider_import_runs' \
  --no-owner --no-privileges \
  --disable-triggers \
  -f data.sql

# Import (run against the NEW database connection string)
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f data.sql
```

Notes:

- `--disable-triggers` is essential. Without it, the immutability triggers
  on `transactions`, `subscriptions`, `payment_allocations`, and
  `device_assignment_log` will reject the inserts.
- `auth.users` is **not** included. Recreate staff accounts by having each
  person sign up at `/auth` on the new deployment, then re-grant roles.
  Subscriber rows reference `user_id`, so this ordering matters — see 3.4.
- Import runs are excluded above because they are audit history of a sync
  that already committed; include them if you want the full trail.

### 3.4 Re-point ownership and seed the first Owner

Every operational row carries the owning `user_id`. After the owner signs
up on the new project their UUID changes, so remap:

```sql
-- 1. find the new UUID
SELECT id, email FROM auth.users WHERE email = 'owner@example.com';

-- 2. remap every table that carries user_id (run inside one transaction)
UPDATE public.subscribers   SET user_id = '<new-uuid>' WHERE user_id = '<old-uuid>';
-- ...repeat for every table with a user_id column...

-- 3. grant the Owner role (the bootstrap trigger was dropped by design)
INSERT INTO public.user_roles (user_id, role, granted_by)
VALUES ('<new-uuid>', 'owner', '<new-uuid>');
```

### 3.5 Auth settings

In the new project's Auth settings:

- **Disable auto-confirm email.** Staff are onboarded manually.
- **Disable public signups** once every staff member has an account.
- Set **Site URL** and **Redirect URLs** to your production domain
  (and the Vercel preview wildcard if you use preview deploys).

### 3.6 Re-enable the cron job

```sql
SELECT cron.schedule(
  'expire-lapsed-subscriptions',
  '0 * * * *',
  $$SELECT public.expire_lapsed_subscriptions()$$
);
SELECT * FROM cron.job;   -- confirm it is listed
```

### 3.7 Cutover checklist

- [ ] `supabase migration list --linked` shows no drift.
- [ ] Row counts match between old and new for `subscribers`,
      `transactions`, `subscriptions`, `devices`.
- [ ] `SELECT count(*) FROM public.user_roles WHERE role='owner'` ≥ 1.
- [ ] Hourly cron job listed in `cron.job`.
- [ ] Run `reconcile_all_balances()` and confirm zero drift.
- [ ] Smoke test (§7).

---

## 4. Connecting the frontend

1. Push the repo to GitHub.
2. In Vercel: **Add New Project → import the repo**. Framework is detected
   as Vite; `vercel.json` in the repo already sets the build command, output
   directory, SPA rewrites, and cache/security headers.
3. Add environment variables for **both** Production and Preview
   (Settings → Environment Variables), copying the names from `.env.example`:

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`

   These are public by design — they ship in the browser bundle and RLS is
   what protects the data. The `service_role` key and database password must
   **never** appear here or anywhere in `src/`.
4. Settings → Git → enable **"Require CI checks to pass before deploying"**
   so a red test run cannot reach production.
5. Add your custom domain and let Vercel issue the certificate.

---

## 5. How a change reaches production

```
feature branch
   │
   ├─▶ push  ──▶ GitHub Actions "CI"          typecheck, lint, 130 unit
   │                                          assertions, clean build,
   │                                          `supabase db reset` from
   │                                          scratch, pgTAP suite
   │
   ├─▶ Vercel Preview deploy                  unique URL, same database
   │
   ├─▶ manual review on the preview URL
   │
   └─▶ merge to main
          │
          ├─▶ CI runs again on main
          ├─▶ "Deploy database migrations" workflow → `supabase db push`
          │     (gated behind the `production` GitHub environment; add a
          │      required reviewer there for a manual approval step)
          └─▶ Vercel promotes the build to the production domain
```

Workflow files: `.github/workflows/ci.yml`, `.github/workflows/deploy-db.yml`.

Repository secrets required for the database workflow
(Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase account → Access Tokens |
| `SUPABASE_PROJECT_REF` | Production project ref |
| `SUPABASE_DB_PASSWORD` | Saved at project creation |

### Ordering rule

**Migrations go out before the frontend that depends on them.** Migrations
in this project are forward-only and additive, so applying them early is
always safe; the reverse is not. The workflow order above enforces this —
`deploy-db` runs on the merge commit, and Vercel's promotion is
independent of it, so keep migrations additive and never ship a migration
that a currently-live frontend would break on.

### Preview deploys share the production database

There is one database. A preview deploy writes to real data. Treat previews
as a UI review tool, not a sandbox. For anything touching the ledger,
subscriptions, or provider sync, test against a local stack instead:

```sh
supabase start        # local Postgres with every migration applied
supabase db reset     # rebuild from scratch, any time
```

### Non-negotiables for money-touching changes

Per the project's standing rules:

- Never publish a change touching the ledger, subscriptions, or provider
  sync without running `npm run test` and `npm run test:db` green. CI does
  this for you, but read the output.
- Bump `CHANGELOG.md` in the same commit as the change, not in a later
  cleanup pass (ADR-010).
- New schema changes are new migration files. Never edit an applied
  migration.

---

## 6. Backups (do not skip)

Supabase free tier gives daily backups with 7-day retention and awkward
restores. Own your backups:

```sh
# nightly, from any always-on machine or a scheduled GitHub Action
pg_dump "$PROD_DB_URL" --no-owner --no-privileges -Fc \
  -f "backup-$(date +%F).dump"
```

Rules:

- Keep 30 daily dumps off-machine (object storage or an encrypted drive).
- The dump contains full customer PII. Encrypt it at rest.
- **Test a restore once per quarter** into a throwaway Supabase project and
  time it. An untested backup is not a backup.

---

## 7. Post-deploy smoke test

Run after every production deploy that touched money or sync:

1. Sign in as the owner account.
2. Subscriber list loads and pagination works.
3. Add a throwaway subscriber → assign a 1-day pack → record a payment →
   generate the receipt PDF → void the payment → delete the subscriber.
4. Open **Billing** — worklist, collections, and activity tabs render.
5. Open **Analytics** — KPIs and charts render for a 30-day range.
6. Open the latest import run detail page and confirm it renders.
7. Check `cron.job_run_details` for a successful expiry run in the last hour.

---

## 8. Browser support

Latest two versions of Chrome, Edge, Firefox, Safari (desktop, Android
Chrome, iOS Safari). Responsive down to 360 px — designed for staff phones.

---

## 9. Sizing guidance

| Subscribers | Tx / month | Comfortable on |
|---|---|---|
| < 2,000 | < 10,000 | Supabase free tier |
| 2,000 – 10,000 | 10k – 50k | Supabase Pro (~$25/mo) |
| > 10,000 | > 50k | Reconsider architecture (ADR-002, ADR-008) first |

---

## 10. Self-hosted alternative

If data must stay on-premises:

```
[ Browser ] ──▶ [ Nginx ] ──▶ [ static dist/ ]
                     └─▶ [ Docker: supabase/postgres + supabase services ]
```

Single VM (2 vCPU / 4 GB), daily `pg_dump` off-machine, ₹500–1,000/month.
Only worth it for a data-residency requirement — it trades ₹0 hosting and
managed backups for sysadmin work.

See [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for the broader
go-live checklist.
