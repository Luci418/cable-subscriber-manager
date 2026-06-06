# Production Readiness

The single question this document answers:

> **Can the system be safely deployed and operated today for a regional
> Cable TV + ISP operator with hundreds to a few thousand subscribers?**

Verdict: **Yes, with caveats.** Items marked 🟠 should be addressed before
go-live; 🟢 items are already in good shape; 🔵 items are nice-to-have.

---

## Critical (must be true before go-live)

| Item | Status | Notes |
|---|---|---|
| RLS enabled on every public table | 🟢 | Verified via `security--get_table_schema`; every operational table filters by `auth.uid()`. |
| GRANTs aligned with policies | 🟢 | All public tables grant to `authenticated` only; no anon access (correct — there is no public-facing data). |
| Auth works (sign-up, sign-in, sign-out, session refresh) | 🟢 | Standard Supabase auth via `useAuth`. |
| Auto-confirm email disabled in production | 🟠 | Verify in Supabase Auth settings — for an operational tool the owner should manually onboard. |
| Backups configured | 🟠 | Supabase free tier includes daily backups; **verify retention** and **test a restore** before go-live. Document the restore drill in the runbook. |
| Time source is synchronized | 🟢 | `src/lib/timeSync.ts` syncs IST; UI uses it instead of browser clock for active/expired calculations. |
| Subscription auto-expiry runs | 🟢 | `expire_lapsed_subscriptions` RPC runs hourly and on each list-load. Verify the hourly cron is enabled in the Supabase dashboard. |
| Data-integrity guards | 🟢 | `is_pack_in_use` / `is_provider_in_use` prevent destructive deletes. |
| No secrets in client code | 🟢 | Only `ANON_KEY` and `SUPABASE_URL` are in `.env`; both are publishable. |
| Error visibility for staff | 🟢 | Friendly DB errors via `friendlyDbError`; toast notifications surface failures. |

## Important (should be true within first 30 days)

| Item | Status | Notes |
|---|---|---|
| **Balance reconciliation** | 🟠 | Stored balances can drift (ADR-003). Phase 3 of the roadmap adds `reconcile_balances()` + `balance_audit`. Until then, run a weekly manual SQL check (see Runbook §3). |
| Subscription renewal lineage | 🟠 | Today, renewals look like new sales (BUSINESS_RULES §4.5). Phase 6 enriches the subscription blob. Renewal/churn analytics is approximate until then. |
| Per-staff roles | 🔵 | Single-account today (ADR-009). Acceptable for 1–3 staff. Add `user_roles` before going to 4+ staff. |
| Monitoring / uptime alert | 🟠 | Recommend a free uptime ping (UptimeRobot, BetterStack free tier) on the deployed URL and on `/auth`. |
| Browser support matrix declared | 🔵 | Tested on latest Chrome (desktop+mobile). Document in DEPLOYMENT.md. |
| Documentation drift check | 🟢 | This pass establishes the structure; review quarterly. |

## Nice-to-have

- Lighthouse pass for PWA installability (kiosk-style use on shop tablets).
- Sentry (or equivalent) for client-side error capture.
- A canary deploy environment for migration testing.
- Automated end-to-end smoke test (Playwright) over the critical paths:
  add subscriber → assign pack → collect payment → generate receipt.

---

## Security Review

- **Tenant isolation**: RLS by `user_id` on every table. Verified.
- **PII scope**: name, mobile, GPS lat/long, address-level. No payment card
  data is ever stored (we record amounts, not card details). UPI references
  *will* land in transaction `description` when Phase 2 ships — treat that
  field as PII.
- **Audit log**: not present today. Acceptable while staff share one account.
- **Rate limiting**: relies on Supabase defaults. Adequate for a single-tenant
  operator.
- **Dependency scanning**: run `npm audit` before every release; document any
  ignored advisories in CHANGELOG.

See `security/security-memory` for the project's standing security posture
and any accepted risks.

---

## Disaster Recovery

### RPO (data loss tolerance)
- Acceptable: **24 hours**, given daily Supabase backups.
- To get closer to 1 hour, enable point-in-time recovery (paid tier).

### RTO (time to restore)
- Target: **<4 hours** end-to-end (restore DB → redeploy frontend → smoke test).
- The restore drill should be performed at least once per quarter.

### Single points of failure
- Supabase project. Mitigation: backups + (optional) cross-region replica on
  paid tier.
- Domain DNS. Mitigation: keep registrar credentials with two trusted people.

### Recovery runbook (one-pager)
1. Restore latest Supabase backup into a new project.
2. Point frontend env vars at the new project; redeploy on Vercel.
3. Run `expire_lapsed_subscriptions` to refresh derived state.
4. Run the (planned) `reconcile_balances` reporter — fix any drift.
5. Smoke test: sign in, open one subscriber, collect a ₹1 payment, void it.
6. Announce restoration to staff with the data-cutoff timestamp.

---

## Migration Hygiene

- All schema changes live as numbered SQL files under `supabase/migrations/`.
- Every new public table in a migration MUST have its `GRANT` statements in
  the **same** migration (project convention; runtime breaks otherwise).
- Migrations are forward-only; no `DROP TABLE` without an ADR.

---

## Pre-Go-Live Checklist (one-shot)

- [ ] Restore drill completed and timed.
- [ ] Owner has Supabase + Vercel login credentials in a password manager.
- [ ] Hourly `expire_lapsed_subscriptions` cron verified.
- [ ] At least one full month of seeded demo data tested end-to-end.
- [ ] CHANGELOG updated to `v1.0.0` with go-live date.
- [ ] Operator trained on: add subscriber → assign pack → record payment →
      print receipt → handle complaint.
