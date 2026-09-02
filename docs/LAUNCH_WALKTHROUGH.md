# Launch Walkthrough — from zero accounts to a live production site

This is the complete, click-by-click runbook. It assumes you have **nothing**:
no Supabase account, no Vercel account, no GitHub account, no CLI tools
installed. Every step is written out. Nothing is left as "and then set up X".

Follow it in order. Do not skip ahead — several steps depend on values you
copy down in earlier steps.

Estimated time: **2.5 to 3 hours** for the first pass, including the backup
restore test. Do it in one sitting, with no staff using the app.

Legend:
- 🖥️ = something you do on your own computer (terminal)
- 🌐 = something you do in a web browser
- ⚠️ = a step people get wrong; read it twice
- 📋 = write this value down; you need it later

Keep a scratch text file open. You will collect eight values across this
runbook. There is a checklist of them in §0.

---

## 0. The values you will collect

Create a file on your desktop called `launch-notes.txt`. By the end of §6 it
should contain all of these. Delete it after launch (it contains secrets).

```
GITHUB_REPO_URL        =
SUPABASE_PROJECT_REF   =
SUPABASE_DB_PASSWORD   =        <-- secret
SUPABASE_URL           =
SUPABASE_ANON_KEY      =
SUPABASE_ACCESS_TOKEN  =        <-- secret
SUPABASE_DB_URL        =        <-- secret (contains the password)
OWNER_USER_UUID        =
```

⚠️ Never paste `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, or
`SUPABASE_DB_URL` into the app's source code, into `.env`, or into any chat.
They are server-only. The `ANON_KEY` and `URL` are public by design and are
supposed to ship in the browser bundle.

---

## 1. Install the tools on your computer

You need four things: Git, Node.js, the Supabase CLI, and the Postgres client
tools (`psql` and `pg_dump`).

### 1.1 macOS

🖥️ Open Terminal (Cmd+Space, type "Terminal", Enter).

Install Homebrew if you do not have it. Paste this and press Enter:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It will ask for your Mac password (typing shows nothing — that is normal) and
then print two `echo` commands at the end telling you to add Homebrew to your
PATH. Run those two commands exactly as printed. Then:

```sh
brew install git node@20 supabase/tap/supabase libpq
brew link --force libpq        # puts psql and pg_dump on your PATH
```

### 1.2 Windows

🖥️ Open PowerShell **as Administrator** (Start → type "PowerShell" → right
click → Run as administrator).

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Supabase.CLI -e
winget install --id PostgreSQL.PostgreSQL.16 -e
```

⚠️ The PostgreSQL installer asks for a password for a *local* Postgres server.
That is not the same as your Supabase password. You will not use the local
server; set anything and forget it. During the component picker you may
uncheck everything except **Command Line Tools**.

Close PowerShell and open a **new** one so the PATH updates.

### 1.3 Linux (Debian/Ubuntu)

```sh
sudo apt update
sudo apt install -y git curl postgresql-client
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb -o /tmp/supabase.deb
sudo dpkg -i /tmp/supabase.deb
```

### 1.4 Verify all four

🖥️ Run each of these. Every one must print a version, not "command not found".

```sh
git --version         # expect 2.x
node --version        # expect v20.x
npm --version         # expect 10.x
supabase --version    # expect 2.x
psql --version        # expect 16.x or 17.x
pg_dump --version     # expect 16.x or 17.x
```

⚠️ If `pg_dump` is older than the Supabase server version (17), dumps will
fail with "server version mismatch". Upgrade the client, not the server.

---

## 2. Create the GitHub account and push the code

### 2.1 Account

🌐 Go to https://github.com/signup

1. Enter your email → **Continue**.
2. Create a password (use a password manager) → **Continue**.
3. Pick a username → **Continue**.
4. Answer the "email preferences" prompt (`n` is fine) → **Continue**.
5. Solve the puzzle → **Create account**.
6. Enter the code emailed to you.
7. On the "welcome" survey, click **Skip personalization**.

### 2.2 Enable two-factor authentication

⚠️ Do this now, not later. This account will hold deployment secrets.

🌐 https://github.com/settings/security → **Enable two-factor authentication**
→ choose **Authenticator app** → scan the QR with Google Authenticator / 1Password
→ enter the 6-digit code → **Save recovery codes to your password manager**.

### 2.3 Create the repository

🌐 https://github.com/new

| Field | Value |
|---|---|
| Repository name | `isp-management` |
| Description | (optional) |
| Visibility | **Private** ⚠️ |
| Add a README | **unchecked** |
| .gitignore | **None** |
| License | **None** |

Click **Create repository**. On the next page copy the HTTPS URL — it looks
like `https://github.com/<you>/isp-management.git`.

📋 Save it as `GITHUB_REPO_URL`.

### 2.4 Get the code onto your computer

The project currently lives in Lovable. Connect it to GitHub from inside the
Lovable editor: top-right **GitHub** button → **Connect to GitHub** →
authorize → select your account → **Create repository**. Lovable pushes the
full history to the repo you just made.

Then clone it locally:

🖥️
```sh
cd ~/Documents
git clone https://github.com/<you>/isp-management.git
cd isp-management
npm install
```

The first `git clone` will ask for GitHub credentials. Use your username and
a **personal access token** as the password (GitHub no longer accepts account
passwords):

🌐 https://github.com/settings/tokens?type=beta → **Generate new token** →
Name: `local-cli`, Expiration: 90 days, Repository access: **Only select
repositories** → `isp-management`, Permissions → Repository permissions →
**Contents: Read and write** → **Generate token** → copy it and paste it as
the password when git asks.

### 2.5 Confirm the working tree is sane

🖥️
```sh
git log --oneline | head -5     # should show your project history
ls supabase/migrations | wc -l  # should print 75
npm run typecheck               # must exit 0
npm run test                    # must be green (130 assertions)
```

⚠️ If any of these fail, stop. Do not deploy a broken tree.

---

## 3. Create the Supabase project

### 3.1 Account

🌐 https://supabase.com/dashboard/sign-up

Click **Continue with GitHub** (simplest — reuses the account from §2) →
**Authorize supabase**.

### 3.2 Organization

If it is your first login, Supabase asks you to create an organization.

| Field | Value |
|---|---|
| Name | your business name |
| Type | Company |
| Plan | **Free** |

Click **Create organization**.

### 3.3 The production project

🌐 Dashboard → **New project**.

| Field | Value | Why |
|---|---|---|
| Project name | `isp-production` | |
| Database password | click **Generate a password** | |
| Region | **South Asia (Mumbai) ap-south-1** | ⚠️ lowest latency for Indian staff |
| Postgres version | leave default | |

⚠️ **Copy the database password into your password manager before clicking
Create.** It is shown once and cannot be retrieved later — only reset.

📋 Save it as `SUPABASE_DB_PASSWORD`.

Click **Create new project**. Provisioning takes 2–3 minutes.

### 3.4 Collect the project values

🌐 Project → **Settings** (gear, bottom-left) → **General**

- **Reference ID** → 📋 `SUPABASE_PROJECT_REF` (e.g. `abcdefghijklmnop`)

🌐 Settings → **API** (or **Data API**)

- **Project URL** → 📋 `SUPABASE_URL` (`https://<ref>.supabase.co`)
- **Project API keys → `anon` `public`** → 📋 `SUPABASE_ANON_KEY`

⚠️ On the same page there is a `service_role` key. **Never copy it anywhere.**
It bypasses all row-level security. It has no role in this deployment.

🌐 Settings → **Database** → **Connection string** → **URI** tab → select
**Session pooler** (works on IPv4 networks; the direct connection often does
not).

It looks like:
```
postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```
Replace `[YOUR-PASSWORD]` with your actual password.

📋 Save the completed string as `SUPABASE_DB_URL`.

### 3.5 A personal access token (for CI)

🌐 https://supabase.com/dashboard/account/tokens → **Generate new token** →
Name: `github-actions` → **Generate token** → copy immediately.

📋 Save as `SUPABASE_ACCESS_TOKEN`.

---

## 4. Apply the schema

The full schema is 75 migration files in `supabase/migrations/`. Applying them
in order reproduces the database exactly — tables, RLS policies, grants,
functions, triggers, and the immutability guards.

🖥️ From the project folder:

```sh
supabase login
```

This opens a browser tab. Click **Authorize**. Copy the verification code back
into the terminal if prompted.

```sh
supabase link --project-ref <SUPABASE_PROJECT_REF>
```

It prompts for the database password. Paste `SUPABASE_DB_PASSWORD`. ⚠️ The
terminal shows nothing while you type or paste — that is normal. Press Enter.

Now see what is pending:

```sh
supabase migration list --linked
```

Expect 75 rows, each with a `Local` timestamp and an empty `Remote` column.

Apply everything:

```sh
supabase db push
```

It prints each file as it applies and asks for confirmation once. Type `Y`.
This takes 30–90 seconds.

Verify there is no drift:

```sh
supabase migration list --linked
```

⚠️ **Every row must now have both Local and Remote filled in.** If any row has
a Remote but no Local, or vice versa, stop and resolve it before continuing —
that means the two histories diverged.

### 4.1 Sanity-check the schema in SQL

🌐 Dashboard → **SQL Editor** → **New query**. Paste and **Run**:

```sql
-- tables should be ~25+
select count(*) as tables
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';

-- every public table must have RLS enabled: expect zero rows
select tablename
from pg_tables
where schemaname = 'public'
  and not rowsecurity;

-- key functions must exist
select proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'has_role','create_subscription','cancel_subscription',
    'extend_subscription','pair_device','mark_device_faulty',
    'commit_provider_import','cancel_provider_import',
    'reconcile_subscriber_balance','expire_lapsed_subscriptions'
  )
order by proname;
```

The second query returning **zero rows** is the important one. If any table
comes back, RLS is off on it and it is readable by anyone with the anon key.

### 4.2 Enable the pgcrypto extension

The Credentials tab encrypts at rest with pgcrypto. The migrations create it,
but confirm:

```sql
select extname, extnamespace::regnamespace as schema
from pg_extension where extname = 'pgcrypto';
```

If it returns nothing:

```sql
create extension if not exists pgcrypto with schema extensions;
```

---

## 5. Move your data (or start clean)

You have a decision to make first.

### 5.1 The decision

Your current Lovable Cloud database holds 16 subscribers, of which ~6 are test
fixtures (`DEFAULT-001/002/003`, the `__QA__` / `NORTH-001` fixture, and the
Venkatesh Nyamgoud test prospect), plus 60 transactions and 33 provider import
runs, most of them from sync testing.

Two options:

**Option A — start clean (recommended).** Re-enter the real subscribers by
hand in the new app. With around ten real records this is under an hour and
gives you a database with zero test residue, a clean ledger, and no ID
remapping. This is what most operators at your scale should do.

**Option B — migrate the data.** Preserves transaction history. Requires an
export from the Lovable Cloud database.

⚠️ **Constraint you need to know about Option B:** on Lovable Cloud you do not
have the database password or the `service_role` key, so you cannot run
`pg_dump` against it yourself. The data has to be exported through the API
layer as SQL `INSERT` statements. Ask in the Lovable chat for a data export and
you will get a `data.sql`; there is no self-service path to a binary dump.

The rest of §5 covers Option B. **If you chose Option A, skip to §6.**

### 5.2 Import the data (Option B)

🖥️ With `data.sql` in your project folder:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "select 1"   # test the connection first
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f data.sql
```

The export is generated with triggers disabled around the inserts. ⚠️ Without
that, the immutability triggers on `transactions`, `subscriptions`,
`payment_allocations`, and `device_assignment_log` reject every row.

`auth.users` is **not** part of the export — you cannot move password hashes
between projects. Staff sign up fresh in §6, which is why ownership remapping
in §6.4 has to happen after.

### 5.3 Delete the test records

Whichever option you chose, run this cleanup in the SQL Editor **before** going
live. Inspect first:

```sql
select subscriber_id, name, created_at, archived_at
from public.subscribers
where subscriber_id in ('DEFAULT-001','DEFAULT-002','DEFAULT-003','NORTH-001')
   or name ilike '%__QA__%'
   or name ilike '%venkatesh nyamgoud%'
order by created_at;
```

Read that list. Confirm nothing on it is a real customer. Then hard-delete,
children first, inside one transaction:

```sql
begin;

create temp table doomed as
select id from public.subscribers
where subscriber_id in ('DEFAULT-001','DEFAULT-002','DEFAULT-003','NORTH-001')
   or name ilike '%__QA__%'
   or name ilike '%venkatesh nyamgoud%';

delete from public.payment_allocations   where subscriber_id in (select id from doomed);
delete from public.transaction_notes     where transaction_id in (
  select id from public.transactions where subscriber_id in (select id from doomed));
delete from public.transactions          where subscriber_id in (select id from doomed);
delete from public.subscriptions         where subscriber_id in (select id from doomed);
delete from public.device_assignment_log where subscriber_id in (select id from doomed);
delete from public.subscriber_provider_state where subscriber_id in (select id from doomed);
delete from public.complaints            where subscriber_id in (select id from doomed);
delete from public.balance_audit         where subscriber_id in (select id from doomed);
delete from public.subscribers           where id in (select id from doomed);

commit;
```

⚠️ If any `delete` errors with a foreign-key violation, **`rollback;`** and
tell me the table name — there is a child table missing from the list above.

Then clear the sync test history:

```sql
delete from public.provider_import_runs;   -- 33 test runs, all pre-launch
```

Finally, release any devices those customers held:

```sql
update public.stb_inventory
set status = 'available', assigned_subscriber_id = null
where assigned_subscriber_id is not null
  and assigned_subscriber_id not in (select id from public.subscribers);
```

### 5.4 Fill in real pack costs

`provider_cost` is currently NULL on all 11 packs, which means the Analytics
Margin section will show nothing. That is by design (packs without cost data
are excluded rather than counted as 100% margin), but you should fill them in:

🌐 In the app, **Catalog** → each pack → **Edit** → set **Provider cost**.

---

## 6. Auth: lock it down and make yourself Owner

### 6.1 Turn off auto-confirm

🌐 Dashboard → **Authentication** → **Sign In / Providers** → **Email**

| Setting | Value |
|---|---|
| Enable Email provider | **on** |
| Confirm email | **on** ⚠️ (this is what disables auto-confirm) |
| Secure email change | on |
| Minimum password length | 10 |
| Password requirements | Letters, digits and symbols |

Click **Save**.

🌐 Authentication → **Attack Protection**

| Setting | Value |
|---|---|
| Leaked password protection | **on** |
| Max failed sign-in attempts | leave default |

### 6.2 Set the URLs

🌐 Authentication → **URL Configuration**

- **Site URL**: `https://<your-domain>` — you do not have it yet. Put
  `http://localhost:8080` for now and come back in §7.6.
- **Redirect URLs**: add these (one per line):
  ```
  http://localhost:8080/**
  https://<your-vercel-domain>/**
  https://<your-custom-domain>/**
  ```
  Again, fill the last two in §7.6.

⚠️ Getting this wrong is the single most common launch bug: sign-in appears to
work, then bounces the user back to the login screen because the redirect
target is not on the allow-list.

### 6.3 Create your account

🌐 Once the frontend is deployed (§7) go to `https://<your-site>/auth` and
**sign up** with your real email. Check your inbox and click the confirmation
link.

⚠️ Do this through the app, not through the dashboard's "Add user" button —
signing up through the app exercises the same path your staff will use, so if
something is misconfigured you find out now.

### 6.4 Grant yourself Owner — manually

The `grant_owner_on_signup` trigger was **deliberately dropped** (ADR: an
automatic owner grant on signup is a privilege-escalation hole — anyone who
could sign up would become Owner). So the first Owner is granted by hand,
exactly once, in SQL.

🌐 SQL Editor:

```sql
-- 1. find your UUID
select id, email, created_at, email_confirmed_at
from auth.users
order by created_at;
```

📋 Copy your `id` as `OWNER_USER_UUID`. ⚠️ Confirm `email_confirmed_at` is not
null — if it is null you have not clicked the confirmation email yet.

```sql
-- 2. grant the role
insert into public.user_roles (user_id, role, granted_by)
values ('<OWNER_USER_UUID>', 'owner', '<OWNER_USER_UUID>');

-- 3. verify — must return exactly one row
select ur.role, u.email
from public.user_roles ur join auth.users u on u.id = ur.user_id
where ur.role = 'owner';
```

Reload the app. You should now see every nav item, including **Settings** and
**Roles**.

### 6.5 If you migrated data (Option B), remap ownership

Every operational row carries the owning `user_id`, and your UUID changed when
you signed up on the new project. Find the old one:

```sql
select distinct user_id from public.subscribers;
```

Then remap in one transaction — ⚠️ **all tables, or none**:

```sql
begin;
update public.subscribers               set user_id = '<new>' where user_id = '<old>';
update public.transactions              set user_id = '<new>' where user_id = '<old>';
update public.subscriptions             set user_id = '<new>' where user_id = '<old>';
update public.packs                     set user_id = '<new>' where user_id = '<old>';
update public.regions                   set user_id = '<new>' where user_id = '<old>';
update public.providers                 set user_id = '<new>' where user_id = '<old>';
update public.stb_inventory             set user_id = '<new>' where user_id = '<old>';
update public.complaints                set user_id = '<new>' where user_id = '<old>';
commit;
```

Confirm nothing was missed:

```sql
select table_name from information_schema.columns
where table_schema = 'public' and column_name = 'user_id'
order by table_name;
```

Every table in that list must appear in the update block above. If one does
not, add it and re-run.

### 6.6 Close public signups

Once **every** staff member has an account (you can do this on day 2 — but do
not forget):

🌐 Authentication → **Sign In / Providers** → **Email** → turn **Allow new
users to sign up** off → **Save**.

From then on you add staff via Authentication → **Users** → **Add user** →
*Send invite*, then grant their role in the app's **Settings → Roles** screen.

### 6.7 Re-enable the hourly expiry cron

`expire_lapsed_subscriptions()` is what moves subscriptions to `expired` when
their end date passes. Nothing else does this.

🌐 Dashboard → **Database** → **Extensions** → search `pg_cron` → toggle **on**.

🌐 SQL Editor:

```sql
select cron.schedule(
  'expire-lapsed-subscriptions',
  '0 * * * *',
  $$select public.expire_lapsed_subscriptions()$$
);

select jobid, schedule, jobname, active from cron.job;
```

⚠️ Come back an hour later and confirm it actually ran:

```sql
select jobid, status, return_message, start_time
from cron.job_run_details
order by start_time desc limit 5;
```

`status` must be `succeeded`.

---

## 7. Deploy the frontend on Vercel

### 7.1 Account

🌐 https://vercel.com/signup → **Continue with GitHub** → **Authorize Vercel**
→ choose **Hobby** (free) → enter your name → **Continue**.

### 7.2 Import the repository

🌐 Vercel dashboard → **Add New…** → **Project**

If your repo is not listed, click **Adjust GitHub App Permissions** → select
**Only select repositories** → `isp-management` → **Save**.

Click **Import** next to `isp-management`.

### 7.3 Build settings

Vercel detects Vite. The repo's `vercel.json` already pins everything, so the
UI fields should read:

| Field | Value |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Node.js Version | 20.x (Settings → General, after the first deploy) |

⚠️ Do **not** click Deploy yet. Expand **Environment Variables** first.

### 7.4 Environment variables

Add these three. For each: type the name, paste the value, and — this is the
part people miss — make sure **all three environment checkboxes**
(Production, Preview, Development) are ticked.

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | your `SUPABASE_ANON_KEY` |
| `VITE_SUPABASE_PROJECT_ID` | your `SUPABASE_PROJECT_REF` |

⚠️ The variable is `VITE_SUPABASE_PUBLISHABLE_KEY`, **not** `..._ANON_KEY`.
The client reads that exact name; a typo produces a blank white page with no
error message, because the client initialises with `undefined`.

⚠️ These are public by design — they ship inside the JavaScript bundle. Row
Level Security is what protects your data, not secrecy of these values. Never
add `service_role` or the DB password here.

Now click **Deploy**. It takes 1–2 minutes.

### 7.5 First check

Vercel gives you a URL like `https://isp-management-xyz.vercel.app`. Open it.

You should see the sign-in screen. If you see a blank white page:

🌐 Press F12 → **Console** tab. `Failed to construct 'URL': Invalid URL`
means an environment variable is missing or misnamed. Fix it in Settings →
Environment Variables, then **Deployments** → the latest → ⋯ → **Redeploy**
(⚠️ environment variable changes require a redeploy; they are baked in at
build time).

### 7.6 Go back and fix the auth URLs

Now that you have a real URL, return to §6.2:

🌐 Supabase → Authentication → URL Configuration
- **Site URL** = `https://isp-management-xyz.vercel.app` (or your custom domain
  once §7.7 is done)
- **Redirect URLs** — add:
  ```
  https://isp-management-xyz.vercel.app/**
  https://*-<your-vercel-scope>.vercel.app/**
  ```
  The second line is the wildcard that makes PR preview deploys signable-into.

**Save.** Then do §6.3 (sign up) and §6.4 (grant Owner) if you have not yet.

### 7.7 Custom domain (optional, do it now if you have one)

🌐 Vercel project → **Settings** → **Domains** → type `app.yourdomain.com` →
**Add**.

Vercel shows a DNS record to create. At your registrar (GoDaddy, Namecheap,
Cloudflare, BigRock…) add:

| Type | Name | Value |
|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` |

For an apex domain (`yourdomain.com` with no subdomain) Vercel gives an
`A` record pointing at `76.76.21.21` instead.

DNS propagation is 5 minutes to 2 hours. Vercel issues the TLS certificate
automatically once it resolves. ⚠️ After the domain goes green, update the
Supabase **Site URL** and **Redirect URLs** again to the custom domain.

### 7.8 Require CI before deploying

🌐 Vercel project → **Settings** → **Git** → scroll to **Ignored Build Step**
and the **Deployment Protection** section → enable **Require CI checks to
pass before deploying** (available once GitHub Actions has reported at least
one check — come back after §8.2).

---

## 8. Continuous integration

The repo already contains `.github/workflows/ci.yml` (typecheck, lint, 130
unit assertions, production build, `supabase db reset` from scratch, and the
pgTAP suite) and `.github/workflows/deploy-db.yml` (applies migrations to
production). They need secrets.

### 8.1 Add the repository secrets

🌐 GitHub repo → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Add three, one at a time:

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | from §3.5 |
| `SUPABASE_PROJECT_REF` | from §3.4 |
| `SUPABASE_DB_PASSWORD` | from §3.3 |

### 8.2 Gate the database workflow behind an approval

🌐 GitHub repo → **Settings** → **Environments** → **New environment** → name
it exactly `production` → **Configure environment** → tick **Required
reviewers** → add yourself → **Save protection rules**.

Now every migration push to production waits for you to click Approve.

### 8.3 Prove CI works

🖥️
```sh
git checkout -b ci-smoke-test
echo "" >> README.md
git commit -am "chore: trigger CI"
git push -u origin ci-smoke-test
```

🌐 GitHub repo → **Actions**. Two jobs run: *Typecheck, lint, unit tests* and
*Database migrations + pgTAP*. ⚠️ Both must go green. The second one spins up
a throwaway local Postgres, replays all 75 migrations from scratch, and runs
31 pgTAP assertions — this is your proof the migration history is coherent.

Vercel also posts a preview URL on the branch. Open it, confirm it loads, then
delete the branch.

---

## 9. Backups — set up and prove a restore

⚠️ Supabase free tier gives daily backups with **7-day retention** and no
point-in-time recovery, and restores on free need support involvement. Own
your own backups. This section is not optional.

### 9.1 Take a backup manually, right now

🖥️
```sh
mkdir -p ~/isp-backups
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -Fc \
  -f ~/isp-backups/backup-$(date +%F).dump
ls -lh ~/isp-backups/
```

A file of a few hundred KB is expected at your data volume. ⚠️ It contains
full customer PII. Encrypt it:

```sh
# macOS/Linux, using age or gpg — gpg shown here
gpg --symmetric --cipher-algo AES256 ~/isp-backups/backup-$(date +%F).dump
```

### 9.2 Prove it restores (the step nobody does)

Create a throwaway project: 🌐 Supabase dashboard → **New project** → name it
`isp-restore-test`, same region, generate a password, **Free** plan.

Get its connection string exactly as in §3.4. Then:

🖥️
```sh
export SCRATCH_DB_URL="postgresql://postgres.<scratch-ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "$SCRATCH_DB_URL" ~/isp-backups/backup-<date>.dump
```

⚠️ A handful of errors about `extension "..." already exists` or ownership of
`auth`/`storage` schemas are normal and harmless. Errors about *your* tables
in `public` are not.

Verify the restore is real, not just "the command exited":

```sh
psql "$SCRATCH_DB_URL" -c "
  select 'subscribers' t, count(*) from public.subscribers
  union all select 'transactions', count(*) from public.transactions
  union all select 'subscriptions', count(*) from public.subscriptions
  union all select 'devices', count(*) from public.stb_inventory;"
```

Compare against the same query on production. ⚠️ The counts must match
exactly. **Time how long the whole restore took** and write it in
`docs/PRODUCTION_READINESS.md` — that number is your recovery time objective.

Then 🌐 delete the scratch project: its Settings → General → scroll down →
**Delete project**. Free tier allows two projects; leaving this one alive
blocks your future staging project.

### 9.3 Automate the nightly dump

Cheapest reliable option: a scheduled GitHub Action.

🌐 Add one more repo secret: `SUPABASE_DB_URL` = your full connection string
(§3.4).

🖥️ Create `.github/workflows/backup.yml`:

```yaml
name: Nightly backup
on:
  schedule:
    - cron: "30 20 * * *"   # 02:00 IST
  workflow_dispatch:
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-client-16
      - run: pg_dump "$DB_URL" --no-owner --no-privileges -Fc -f backup.dump
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: backup-${{ github.run_id }}
          path: backup.dump
          retention-days: 30
```

⚠️ GitHub artifacts on a private repo are private, but they are still a
third party holding customer PII. For a stricter posture, push the dump to
your own encrypted object storage instead. Either way: **once a quarter,
repeat §9.2.** An untested backup is not a backup.

### 9.4 Confirm Supabase's own backups exist

🌐 Dashboard → **Database** → **Backups**. On free tier you should see daily
entries appear within 24 hours of the project being created. Treat these as a
secondary copy, not your primary recovery path.

---

## 10. Uptime monitoring

🌐 https://uptimerobot.com/signUp — free tier gives 50 monitors at 5-minute
intervals.

1. Sign up, confirm your email.
2. **+ New monitor**.

| Field | Value |
|---|---|
| Monitor type | HTTPS |
| Friendly name | ISP App |
| URL | your production URL |
| Monitoring interval | 5 minutes |
| Alert contacts | tick your email; add SMS if you want it |

3. **Create monitor**.

Add a second monitor for the database's health, so you learn about a Supabase
outage rather than inferring it:

| Field | Value |
|---|---|
| Monitor type | HTTPS |
| Friendly name | ISP Database |
| URL | `https://<ref>.supabase.co/rest/v1/` |
| Custom HTTP header | `apikey: <your anon key>` |

⚠️ Also relevant on free tier: a Supabase project **pauses after 7 days with
zero requests**. Daily staff use makes this a non-issue, but the UptimeRobot
ping alone is enough to prevent it during a holiday period.

---

## 11. Staging (do this in week two, not before launch)

Free tier allows two active projects, so once the restore-test project from
§9.2 is deleted you have room for one staging project.

1. 🌐 New project `isp-staging`, same region, generate a password.
2. 🖥️ `supabase link --project-ref <staging-ref>` then `supabase db push`.
3. 🌐 Vercel → Settings → **Environment Variables** → edit each of the three
   variables: **untick Preview** on the production values, then add a second
   copy of each variable with the **staging** values and only **Preview**
   ticked.

Now every PR preview URL runs against staging data, and §12's warning goes
away. ⚠️ Until you do this, **preview deploys read and write your production
database.** A preview URL is new frontend code against real customer money.

For anything touching the ledger, subscriptions, or provider sync, test
locally instead:

🖥️
```sh
supabase start        # local Postgres with all 75 migrations
supabase db reset     # rebuild from scratch any time
supabase stop
```

---

## 12. Launch day sequence

Do these in order, on a day with no staff activity.

- [ ] §4 schema applied; `supabase migration list --linked` shows no drift
- [ ] §4.1 RLS check returns zero rows
- [ ] §5.3 test records hard-deleted; `provider_import_runs` cleared
- [ ] §5.4 real `provider_cost` on every pack
- [ ] §6.1 Confirm email **on**, leaked-password protection **on**
- [ ] §6.2/§7.6 Site URL and Redirect URLs point at the real domain
- [ ] §6.4 exactly one row in `user_roles` with role `owner`
- [ ] §6.7 `cron.job` lists the hourly expiry job
- [ ] §7 site loads over HTTPS at the real domain and sign-in works
- [ ] §8.3 both CI jobs green
- [ ] §9.2 a restore has actually been performed and counts matched
- [ ] §9.3 nightly backup workflow committed
- [ ] §10 both uptime monitors reporting Up
- [ ] `select public.reconcile_all_balances();` reports zero drift

Then the smoke test — do this as the owner account on the live site:

1. Sign in.
2. Customers list loads; pagination works.
3. Create a throwaway subscriber → assign a 1-day pack → record a payment →
   generate the receipt PDF → void the payment → hard-delete the subscriber.
4. **Billing** — Worklist, Collections, Activity tabs all render.
5. **Analytics** — KPIs and charts render over a 30-day range; Margin section
   shows numbers now that costs are filled in.
6. **Catalog** — packs and providers render with mapping badges.
7. **Settings** → Roles shows your Owner grant.
8. One hour later: `cron.job_run_details` shows a `succeeded` expiry run.

---

## 13. The ongoing release process

For every change from here on:

```sh
git checkout -b fix/whatever
# ...make the change...
npm run test        # ⚠️ mandatory if the change touches money, identity, or sync
npm run typecheck
npm run lint
# bump CHANGELOG.md in THIS commit, not a later one  (ADR-010)
git commit -am "fix: whatever"
git push -u origin fix/whatever
```

Then: open a PR → CI runs → Vercel posts a preview URL → review it → merge →
CI runs on `main` → the `deploy-db` workflow waits for your approval → you
approve → migrations apply → Vercel promotes the build to production.

Three standing rules:

1. **Migrations ship before the frontend that needs them.** Migrations here are
   forward-only and additive, so applying early is always safe; the reverse is
   not.
2. **Never edit an applied migration.** New change, new file.
3. **Never publish a money-touching change without `npm run test` and
   `npm run test:db` green**, and read the output rather than trusting the
   exit code.

---

## 14. Cost, and when it stops being free

| | Free | You today | Upgrade trigger |
|---|---|---|---|
| Supabase DB size | 500 MB | ~5 MB | > 400 MB |
| Supabase MAU | 50,000 | 1–5 staff | never, realistically |
| Supabase egress | 5 GB/mo | < 1 GB | > 4 GB/mo |
| Supabase backups | 7 days, awkward restore | mitigated by §9 | you want PITR |
| Vercel bandwidth | 100 GB/mo | < 5 GB | > 80 GB/mo |
| Vercel build minutes | 6,000/mo | < 100 | never, realistically |
| UptimeRobot | 50 monitors | 2 | never |

**Expected monthly bill at your scale: ₹0.** The first upgrade you will ever
need is Supabase Pro at $25/month, and the honest trigger for it is wanting
point-in-time recovery, not hitting a resource limit.

---

## 15. When something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Blank white page | env var missing/misnamed | §7.4, then redeploy |
| Sign-in loops back to login | redirect URL not allow-listed | §6.2 |
| "Failed to fetch dynamically imported module" | stale chunk after a deploy | app self-heals with one reload; if persistent, hard-refresh |
| Permission denied on a table | missing GRANT in a migration | run the `HINT` from the error verbatim, then capture it as a new migration |
| Subscriptions never expire | cron not scheduled or pg_cron off | §6.7 |
| Nav items missing after sign-in | no Owner role granted | §6.4 |
| `supabase db push` says "up to date" but a table is missing | linked to the wrong project | `supabase link` again with the right ref |
| pg_dump "server version mismatch" | client older than 17 | upgrade `libpq`/`postgresql-client` |

---

See also: [DEPLOYMENT.md](./DEPLOYMENT.md) for the architecture rationale and
host comparison, and [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for
the broader go-live audit.
