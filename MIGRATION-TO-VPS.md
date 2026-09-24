# Migrating the Frontend to Hostinger VPS (Phase 1)

**Scope of this phase:** move the Nuxt app off Vercel and onto the Hostinger VPS,
running against your **existing live Supabase project** (unchanged). Vercel stays
live in parallel the whole time — you're only testing against the VPS's IP
address, so there's no risk to your current users until you deliberately point a
domain at it later.

Server details for this run:

- OS: Ubuntu 24.04 LTS
- Plan: KVM 4 (4 vCPU / 200 GB disk)

Everywhere below, replace:

- `<VPS_IP>` — your VPS's public IPv4 address
- `<SSH_USER>` — the SSH username Hostinger gave you
- `<REPO_URL>` — your GitHub repo's SSH clone URL (e.g. `git@github.com:you/repo.git`)

---

## 1. Connect and update the system

```bash
ssh <SSH_USER>@<VPS_IP>
sudo apt update && sudo apt upgrade -y
```

## 2. Install Node.js 22 (LTS)

Nuxt 4 wants a recent Node — 22 LTS is the safe choice.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v22.x
npm -v
```

## 3. Install PM2 (keeps the app running, restarts it on crash/reboot)

```bash
sudo npm install -g pm2
```

## 4. Give the VPS access to your GitHub repo

If the repo is private, the cleanest approach is a **read-only deploy key**
(scoped to just this repo, can't push, can't touch anything else on your
GitHub account):

```bash
ssh-keygen -t ed25519 -C "hostinger-vps-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy that output → GitHub repo → **Settings → Deploy keys → Add deploy key**
→ paste it → leave "Allow write access" **unchecked** → Add key.

## 5. Clone and build the app

```bash
sudo mkdir -p /var/www/app
sudo chown $USER:$USER /var/www/app
git clone <REPO_URL> /var/www/app
cd /var/www/app
npm ci
```

## 6. Create the production `.env`

```bash
nano /var/www/app/.env
```

Paste in the same variables from your current Vercel project (Vercel dashboard
→ Settings → Environment Variables), **with the same values** since Supabase
isn't moving yet:

```
NUXT_PUBLIC_SUPABASE_URL=
NUXT_PUBLIC_SUPABASE_KEY=
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_ROLE_KEY=
SUPABASE_SERVICE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NUXT_PUBLIC_GOOGLE_CLIENT_ID=
NUXT_PUBLIC_GOOGLE_CLIENT_SECRET=
CANVAS_DOMAIN=
CANVAS_TOKEN=
CANVAS_ACCOUNT_ID=
CANVAS_EXTRA_COURSE_IDS=
COURSE_IDS=
MENTOR_API_SECRET=
SCRAPER_USERNAME=
SCRAPER_PASSWORD=
```

Save (`Ctrl+O`, `Enter`, `Ctrl+X`).

> ⚠️ Don't commit this `.env` to git or paste real values into chat with me —
> copy them directly from Vercel's dashboard into `nano` on the server.

## 7. Build

```bash
npm run build
```

This produces `.output/` — a self-contained Node server.

## 8. Start it with PM2

Upload the `ecosystem.config.cjs` file from this package to `/var/www/app/`
(scp it, or just create it there — contents below), then:

```bash
sudo mkdir -p /var/log/pm2
sudo chown $USER:$USER /var/log/pm2
cd /var/www/app
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # run the sudo command it prints, so PM2 survives a reboot
```

Check it's actually up:

```bash
pm2 status
pm2 logs nuxt-app --lines 50
curl http://127.0.0.1:3000
```

## 9. Install and configure Nginx as a reverse proxy

The Nuxt server runs on port 3000 internally — Nginx sits in front on port 80
and forwards to it (needed for normal URLs, eventually SSL, and so PM2 isn't
directly exposed to the internet).

```bash
sudo apt install -y nginx
```

Upload `nginx-nuxt-app.conf` from this package (contents below), then:

```bash
sudo cp nginx-nuxt-app.conf /etc/nginx/sites-available/nuxt-app
sudo ln -s /etc/nginx/sites-available/nuxt-app /etc/nginx/sites-enabled/nuxt-app
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # should say "syntax is ok" / "test is successful"
sudo systemctl reload nginx
```

## 10. Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 11. Test it

Open `http://<VPS_IP>` in your browser. You should see the app.

**If auth (Google/Supabase login) doesn't work yet, that's expected** — see
the next section.

---

## 12. Things that must be updated elsewhere for auth to work on this new address

Your Supabase project and Google OAuth client currently only trust your
Vercel domain. Until you add the VPS's address to their allow-lists, login
will fail (redirect errors) even though the app itself is running fine.

- **Supabase** → your project → **Authentication → URL Configuration** →
  add `http://<VPS_IP>` to **Redirect URLs** (and Site URL if you want it as
  the primary, though you can leave Site URL pointed at Vercel for now and
  just add the VPS as an _additional_ redirect URL).
- **Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0
  Client ID → add `http://<VPS_IP>` to **Authorized JavaScript origins**, and
  the callback path (matches your app's `/auth/confirm` route) to
  **Authorized redirect URIs**.

Once you move to a real domain, you'll repeat this step with the domain
instead of the IP (and again switch to `https://` once SSL is on).

---

## 13. What's intentionally NOT done in this phase

- Supabase itself is not moving — it stays exactly where it is, still live,
  still serving both Vercel and the VPS during testing.
- No SSL yet — you're on plain `http://` against a bare IP. Don't point real
  users here yet. SSL requires a domain (Let's Encrypt won't issue a
  certificate for a bare IP).
- No GitHub Actions auto-deploy yet — see the manual `deploy.sh` script
  included in this package for redeploying by hand for now.

## 14. Redeploying after this (manual, for now)

Upload `deploy.sh` to `/var/www/app/`, then whenever you push a change:

```bash
cd /var/www/app
bash deploy.sh
```

It pulls the latest code, reinstalls dependencies, rebuilds, and reloads PM2
with zero downtime.

---

## Next steps (once you're ready)

1. Point a domain/subdomain's DNS `A` record at `<VPS_IP>`.
2. Update the Nginx config's `server_name` to that domain instead of `_`.
3. Run `sudo apt install certbot python3-certbot-nginx` and
   `sudo certbot --nginx -d your-domain.com` for free auto-renewing SSL.
4. Update the Supabase/Google redirect URLs again, this time to
   `https://your-domain.com`.
5. Set up a GitHub Actions workflow that SSHs in and runs `deploy.sh` on every
   push to your main branch — happy to build that with you when you're there.
6. Only after all of this is verified stable: consider migrating Supabase
   itself, which is a separate, bigger conversation (self-hosting Supabase is
   a significantly heavier lift than the frontend move — worth discussing
   before committing to it).
