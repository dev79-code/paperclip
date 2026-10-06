# Deploying: DigitalOcean VPS (agent + API + data) and Vercel (website)

```
visitors ──► Vercel (dashboard pages) ──/api/*──► VPS: Caddy (HTTPS) ──► Next.js API :3000 + agent worker
                                                                         └── data/ (db.json, x-token.json)
```

Vercel can't keep files between requests, so the agent and its data live on the VPS. The Vercel site
proxies every `/api/*` call there, because `BACKEND_URL` turns on the rewrite in `next.config.mjs`.

Replace these placeholders throughout:
* `YOUR_IP`: the droplet's IP address
* `api.yourdomain.com`: a subdomain pointed at the droplet. No domain? Use `YOUR-IP-WITH-DASHES.sslip.io`, e.g. `203-0-113-7.sslip.io`.
* `you/paperclip`: your GitHub repo

---

## 0. Before you start
- OpenRouter key (openrouter.ai → Keys)
- X app with **Client ID / Secret**, callback `http://localhost:3001/callback`, and a plan that can read mentions
- The code pushed to a **private** GitHub repo:
  ```bash
  cd paperclip
  git init && git add . && git commit -m "Paperclip"
  git branch -M main
  git remote add origin https://github.com/you/paperclip.git
  git push -u origin main
  ```

## 1. Create the droplet (DigitalOcean dashboard)
1. On your computer, if you don't have an SSH key yet, run `ssh-keygen -t ed25519` and press Enter through the prompts. Then show it with `cat ~/.ssh/id_ed25519.pub`.
2. In DigitalOcean, go to **Create → Droplets**:
   - **Region:** closest to you (e.g. London LON1)
   - **Image:** Ubuntu **24.04 (LTS) x64**
   - **Size:** Basic → Regular → **2 GB / 1 CPU** (about $12/mo)
   - **Authentication:** SSH Key → **New SSH Key** → paste your `.pub` key
   - **Hostname:** `paperclip`
   - Optional: tick **Backups**
3. Click **Create Droplet** and copy its **IPv4** address (`YOUR_IP`).

## 2. DNS (skip if using sslip.io)
At your domain provider, add an **A record**: name `api`, value `YOUR_IP`. Wait a few minutes, then check that `ping api.yourdomain.com` shows your IP.

## 3. Run the one-shot setup script (as root)
```bash
ssh root@YOUR_IP
curl -fsSL https://raw.githubusercontent.com/you/paperclip/main/scripts/setup-vps.sh -o setup-vps.sh
# private repo? Raw URLs need auth, so paste the file instead: nano setup-vps.sh, paste, save
API_DOMAIN=api.yourdomain.com bash setup-vps.sh
```
The script:
- creates user `clip` (it asks you to pick a password)
- sets up the firewall (SSH, 80, 443)
- adds 2 GB of swap
- installs Node 20, git and pm2
- installs Caddy with HTTPS for your domain
- turns on pm2 start-on-boot
- creates a **deploy key**

It prints the deploy key at the end.

## 4. Give the server read access to the GitHub repo
The repo owner goes to the GitHub repo → **Settings → Deploy keys → Add deploy key**:
- Title: `paperclip-vps`
- Key: the `ssh-ed25519 …` line the script printed
- Leave **Allow write access** unticked → **Add key**

Then log in as the app user:
```bash
exit
ssh clip@YOUR_IP
```

## 5. Get the code
```bash
cd ~
git clone git@github.com:you/paperclip.git
cd paperclip
npm ci
cp .env.example .env
nano .env
```
Set these in `.env` (save with Ctrl+O, Enter, Ctrl+X):
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
AGENT_MODE=demo
DEMO_AUTOPLAY=0
PUBLIC_URL=https://paperclip.vercel.app        # your Vercel URL (update after step 10)
ADMIN_PASSWORD=<long random string>
APPROVAL_THRESHOLD_USD=50
TICK_MINUTES=15
X_CLIENT_ID=...
X_CLIENT_SECRET=...
```
Do **not** set `BACKEND_URL` on the VPS.

## 6. Build and start with pm2
```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs --lines 30          # you should see "tick 1 done …" from paperclip-agent
```

## 7. Check HTTPS
Caddy was configured by the setup script. From your computer, run:
```bash
curl https://api.yourdomain.com/api/state
```
It should return JSON. If it doesn't, check DNS (step 2) and run `sudo systemctl status caddy` on the VPS.

## 8. Log the agent's X account in (once)
On **your computer**, open an SSH tunnel so X's callback reaches the VPS:
```bash
ssh -L 3001:localhost:3001 clip@YOUR_IP
```
In that same SSH session:
```bash
cd ~/paperclip && npm run x:login
```
In your browser, logged into X as the **agent** account, open the printed URL and click Authorize.
The token is saved to `~/paperclip/data/x-token.json` on the VPS and refreshes itself. Ignore the env values it prints; you don't need them here.

## 9. Test with AI in demo mode
`pm2 logs paperclip-agent` should show AI-written plans and posts (simulated, nothing published).

## 10. Deploy the website on Vercel
1. vercel.com → Add New → Project → import `you/paperclip`. Framework: Next.js; leave the defaults.
2. **Environment Variables**: add `BACKEND_URL=https://api.yourdomain.com`. That's the only one Vercel needs.
3. Deploy. Open `https://<project>.vercel.app`; the dashboard should show the VPS's data.
4. Optional: Settings → Domains → add `yourdomain.com`.
5. Put the final site URL in the VPS `.env` as `PUBLIC_URL` (it's the link in every post), then run `pm2 restart all --update-env`.

## 11. Go live
```bash
cd ~/paperclip
sed -i 's/^AGENT_MODE=.*/AGENT_MODE=live/' .env
pm2 restart all --update-env
pm2 logs paperclip-agent
```
The first live round posts on X. Approve deals at `https://<your site>/admin`, using `ADMIN_PASSWORD`.

## Everyday commands
```bash
pm2 status                          # both processes online?
pm2 logs paperclip-agent            # watch the agent think
cd ~/paperclip && git pull && npm ci && npm run build && pm2 restart all --update-env   # update code (Vercel redeploys itself on push)
cp data/db.json ~/db-$(date +%F).json   # quick backup (or enable DigitalOcean droplet backups)
```

## Adding Reddit, forums or email later
Add the keys to the VPS `.env` (see SETUP.md), run `pm2 restart all --update-env`, then mark each approved community **granted** in `/admin`.
For inbound email, point the webhook at `https://api.yourdomain.com/api/webhooks/email?key=ADMIN_PASSWORD`.
