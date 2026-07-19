# Moving from Vercel + Supabase to Hostinger KVM4 (with hPanel)

One complete walkthrough, top to bottom. Do the steps in order — later
steps depend on earlier ones. Two things are moving: the **database/auth
backend** (Supabase) and the **Nuxt app** (currently on Vercel). Get
Supabase running and verified with your real data *before* touching the
app or DNS.

Budget this as multi-day work, not one sitting. Keep your current Vercel
+ managed Supabase setup completely untouched and running throughout —
it's your fallback until the new setup is fully verified.

---

## Step 1 — Find your VPS in hPanel

Log into hPanel → **VPS** in the left sidebar → select the KVM4 instance
you were given. The Overview tab shows its IP address, resource usage,
and OS. Confirm it's Ubuntu 24.04 (per what the admin sent you).

Two tabs you'll come back to a lot:
- **Applications** — one-click app installer (this is what makes hPanel
  worth using over raw SSH)
- **Domains** — DNS zone editor, if this VPS's domain is also managed
  through Hostinger. If your domain is registered elsewhere, you'll set
  DNS records at that registrar instead (Step 3 covers what records you
  need either way).

## Step 2 — Install Supabase via the Applications tab

VPS → **Applications** → search **Supabase** → Install.

hPanel will ask for basic config (subdomain if you want one, admin
credentials for Supabase Studio). Let it generate secure values where it
offers to — this saves you the manual `JWT_SECRET`/`ANON_KEY`/
`SERVICE_ROLE_KEY` generation that's otherwise the fussiest part of a
manual install (those three values are cryptographically linked, and
getting them inconsistent silently breaks auth later).

Once installed, note down and save somewhere safe:
- The Postgres connection details (host, port, password)
- `ANON_KEY` and `SERVICE_ROLE_KEY` — shown in the app's settings in
  hPanel, or in whatever `.env` file it created on the server
- The Supabase Studio URL and admin login

Confirm you can open Studio and see the Table Editor / SQL Editor before
moving on.

**If the one-click installer isn't available or fails for some reason**,
fall back to the manual Docker Compose path — SSH into the VPS (Web
Terminal button in hPanel works fine for this too) and run:
```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```
then generate the three linked auth values with the script included in
this repo (no npm install needed):
```bash
node deploy/generate-supabase-keys.js
```
Paste the six values it prints into `supabase/docker/.env`, replacing
the example entries for those same keys, then `docker compose up -d`.

## Step 3 — Point your domain at the VPS

hPanel → **Domains** → DNS Zone Editor (if the domain is managed through
Hostinger), or your domain registrar's DNS settings otherwise. Add:
- An **A record** for your main domain (e.g. `@` or `yourdomain.com`) →
  the VPS's IP address
- An **A record** for a subdomain like `supabase.yourdomain.com` → the
  same IP, if you want Supabase reachable on its own hostname (cleaner
  than using a raw port number)

DNS propagation can take anywhere from minutes to a few hours — start
this now so it's likely ready by the time you need it (Step 7).

## Step 4 — Migrate your database

This part is inherently a command-line/SQL task regardless of hPanel —
there's no one-click "import my data" button for this. You'll need the
**old (current) Supabase project's direct Postgres connection string**:
Supabase dashboard → your current project → Settings → Database →
Connection string → URI (port 5432, direct connection, not the pooler).

Use hPanel's **Web Terminal** (or SSH) to reach the VPS, then run these
using a throwaway `postgres:16` Docker container — nothing extra needs
installing:

```bash
mkdir -p ~/db-migration && cd ~/db-migration

# 1. Dump your app's tables from the OLD project
docker run --rm -v "$(pwd):/dump" postgres:16 \
  pg_dump "postgresql://postgres:[OLD_DB_PASSWORD]@[OLD_HOST]:5432/postgres" \
  --schema=public --no-owner --no-privileges -F c -f /dump/public_schema.dump

# 2. Restore into the NEW self-hosted Postgres
#    (use the Postgres password from Step 2)
docker run --rm --network host -v "$(pwd):/dump" postgres:16 \
  pg_restore --no-owner --no-privileges \
  -d "postgresql://postgres:[NEW_POSTGRES_PASSWORD]@localhost:5432/postgres" \
  /dump/public_schema.dump
```

**Verify before continuing** — Studio → SQL Editor on the new instance:
```sql
select count(*) from students;
select count(*) from scheduled_meetings;
select count(*) from student_season_progress;
```
Row counts should roughly match what you'd expect. If `pg_restore`
reported errors, stop and share them before moving on.

### Auth users (separate step, after the above is verified)

The new `JWT_SECRET` does **not** need to match the old project's — it
only signs session tokens, not stored passwords. Migrating `auth.users`
brings across the actual password hashes (bcrypt, independent of
JWT_SECRET), so existing users can still log in with their current
password. The only effect of a fresh secret is that anyone currently
logged in gets signed out once and needs to log in again.

Migrate **auth data only** (not schema DDL — the new instance's `auth`
schema is already correctly created by Supabase's own auth service):
```bash
docker run --rm -v "$(pwd):/dump" postgres:16 \
  pg_dump "postgresql://postgres:[OLD_DB_PASSWORD]@[OLD_HOST]:5432/postgres" \
  --schema=auth --data-only --no-owner --no-privileges -F c -f /dump/auth_data.dump

docker run --rm --network host -v "$(pwd):/dump" postgres:16 \
  pg_restore --no-owner --no-privileges --data-only \
  -d "postgresql://postgres:[NEW_POSTGRES_PASSWORD]@localhost:5432/postgres" \
  /dump/auth_data.dump
```
If this errors on constraint mismatches (possible if the old project's
auth service has run newer internal migrations than what you're
self-hosting), stop and share the error rather than forcing it —
there's a fallback of migrating just `auth.users`' core columns by hand.

### Storage files (only if applicable)

If anything's stored in Supabase Storage (uploaded files, as opposed to
externally-hosted URLs like the Google profile picture links already in
`students.profile_image_url`), those live outside Postgres and need a
separate copy via the Supabase CLI or a direct bucket sync. Flag it if
this applies to you.

## Step 5 — Deploy the Nuxt app

This repo includes a `Dockerfile` and `docker-compose.yml` at the
project root, built for exactly this. Two ways to run them:

**Via hPanel's Docker Compose manager** (VPS → Applications, or a
dedicated Docker/Compose section depending on your hPanel version):
point it at this repo (or upload the project folder) and let it manage
`docker-compose.yml` visually — start/stop/logs all from the UI.

**Via terminal**, if you'd rather:
```bash
git clone <your repo> app && cd app
# create a real .env file here with the values from Step 6 below
docker compose up -d --build
```

Either way, this runs the app on `localhost:3000` on the VPS.

## Step 6 — Configure the app's environment variables

Copy every value from your current Vercel project's environment
variables into the new `.env` on the VPS, updating the Supabase-related
ones to point at your new self-hosted instance:
```
NUXT_PUBLIC_SUPABASE_URL=https://supabase.yourdomain.com
NUXT_PUBLIC_SUPABASE_KEY=<new ANON_KEY from Step 2>
SUPABASE_SERVICE_ROLE_KEY=<new SERVICE_ROLE_KEY from Step 2>
# ...plus everything else unchanged: GOOGLE_CLIENT_ID/SECRET,
# GOOGLE_CALENDAR_* vars, SCRAPER_USERNAME/PASSWORD, etc.
```

Also update the **redirect URL allow-list** in the new Supabase's Auth
settings (Studio → Authentication → URL Configuration) to your new
domain — otherwise Google login will fail with a redirect mismatch.

Restart the app container after any `.env` change:
```bash
docker compose restart
```

## Step 7 — Reverse proxy + HTTPS

If hPanel's Applications setup for Supabase already configured a reverse
proxy + SSL for its own subdomain, you likely just need to do the same
for the app. A `Caddyfile` is included at the project root as a
starting point if you're doing this manually:
```bash
sudo apt install caddy
caddy run --config Caddyfile
```
(edit the domains in that file to match yours first). Caddy handles
Let's Encrypt certificates automatically — no manual cert management.

If hPanel offers its own reverse-proxy/SSL management for the app
(depends on your hPanel version and how you deployed in Step 5), use
that instead and skip the manual Caddy setup.

## Step 8 — The scraper / cron jobs

The GitHub Actions workflows (`.github/workflows/*.yaml`) that run
`data_processor.py`, `student_management.py`, etc. don't need to move.
Update their Supabase-related repo secrets to point at the new
self-hosted instance's URL/keys — GitHub Actions just needs network
access to reach it, same as it does today. Optional: move these to a
cron job on the VPS instead if you'd rather centralize everything, but
that's not required for the migration to work.

## Step 9 — Cutover

1. With everything running and verified, do one final `pg_dump`/
   `pg_restore` pass (repeat Step 4's commands) to catch anything
   written since your first pass — ideally during a short maintenance
   window, since this is the point where the old and new databases
   diverge if left running in parallel too long.
2. Confirm DNS (Step 3) is pointing at the VPS and has propagated.
3. Test the live app end to end on the new domain: login (both
   email/password and Google), student roadmap page, admin meetings
   scheduling + Google Calendar sync, the season-completion logic.
4. Keep the old Vercel + managed Supabase project around, untouched, for
   a week or two as a fallback before decommissioning it.

## What to double-check after cutover

- Google OAuth login (redirect URL updated, same Google client ID/secret)
- The shared Google Calendar sync (`server/utils/googleCalendar.js`) —
  same service account credentials, should be unaffected by this move
- Scraper GitHub Actions secrets updated to the new Supabase URL/keys
- RLS policies came across intact — spot-check a few tables in the new
  Studio's SQL editor against `schema.sql`
