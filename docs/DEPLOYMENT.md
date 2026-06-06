# Deployment

The deployment philosophy is unambiguous: **simple, reliable, cheap**. The
system should run on free tiers for a single operator and scale modestly
without re-architecture.

## Reference deployments

### Option A — Vercel + Supabase (recommended)

```
[ Browser ]
     │ HTTPS
     ▼
[ Vercel ]   ←  static frontend (Vite build of src/)
     │ HTTPS
     ▼
[ Supabase ] ←  Postgres + Auth + RLS + Edge Functions + scheduled jobs
```

- **Frontend**: Vite static build pushed to Vercel. Free tier covers small
  operator traffic with room to spare.
- **Backend**: Supabase project (free tier is sufficient up to a few thousand
  subscribers and modest transaction volume).
- **Cron**: Supabase scheduled function runs `expire_lapsed_subscriptions`
  hourly.
- **Monthly cost target**: **₹0** until traffic forces an upgrade.

### Option B — Self-hosted single box

```
[ Browser ] ──▶ [ Nginx ] ──▶ [ static dist/ ]
                     │
                     └─▶ [ Docker: supabase/postgres + supabase services ]
```

- Single VM (2 vCPU / 4 GB RAM) hosts Postgres + Supabase services + a static
  reverse proxy.
- Daily `pg_dump` to off-machine object storage.
- **Monthly cost target**: cost of the VM (₹500–₹1000 / month typical).

Self-hosting is appropriate when the operator must keep data on-premises or
expects to scale beyond Supabase free tier without paying for it.

## Environment variables

The client reads only these (auto-generated, do not edit by hand):

- `VITE_SUPABASE_URL` — backend URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — anon/publishable key (safe in client).
- `VITE_SUPABASE_PROJECT_ID`.

No secret keys live in the frontend. Edge Functions, when added, read secrets
from Supabase's secret store.

## Deploy flow

1. `git push` to the main branch.
2. Vercel builds and deploys automatically (zero config beyond connecting the
   repo).
3. If the change includes a SQL migration, apply it to Supabase **before**
   the new frontend goes live (additive migrations are safe to apply early).
4. Tag the release: `vX.Y.Z` matching the entry in CHANGELOG.

## Browser support

Tested and supported on the **latest two versions** of Chrome, Edge, Firefox,
and Safari (desktop + Android Chrome + iOS Safari). The UI is responsive down
to 360px width — designed for staff phones.

## Sizing guidance

| Subscribers | Tx / month | Comfortable on |
|---|---|---|
| < 2,000 | < 10,000 | Supabase free tier |
| 2,000 – 10,000 | 10k – 50k | Supabase Pro (~$25/mo) |
| > 10,000 | > 50k | Reconsider architecture (ADR-002, ADR-008) before scaling further |

## Operational checks (post-deploy)

1. Sign in as the owner account.
2. Confirm the subscriber list loads.
3. Add a throwaway subscriber, assign a 1-day pack, record a payment,
   generate a receipt PDF, then delete the subscriber.
4. Inspect the **Analytics** page — KPIs and charts should render.
5. Verify the hourly `expire_lapsed_subscriptions` job in the Supabase
   dashboard.

See [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for the broader
go-live checklist.
