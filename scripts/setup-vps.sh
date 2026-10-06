#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 24.04 DigitalOcean droplet. Run as root:
#   curl -fsSL <raw url of this file> -o setup-vps.sh   (or paste it)
#   API_DOMAIN=api.yourdomain.com bash setup-vps.sh
# Installs: app user, firewall, swap, Node 20, git, pm2, Caddy (HTTPS reverse proxy to :3000).
set -euo pipefail

API_DOMAIN="${API_DOMAIN:?Set API_DOMAIN, e.g. API_DOMAIN=api.yourdomain.com (or 1-2-3-4.sslip.io)}"
APP_USER="${APP_USER:-clip}"

if [[ $EUID -ne 0 ]]; then echo "Run as root"; exit 1; fi
echo "==> Setting up for $API_DOMAIN (app user: $APP_USER)"

# --- app user with sudo + your SSH key -----------------------------------------
if ! id "$APP_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$APP_USER"
  usermod -aG sudo "$APP_USER"
  rsync --archive --chown="$APP_USER:$APP_USER" /root/.ssh "/home/$APP_USER"
  echo "==> Choose a password for $APP_USER (needed for sudo):"
  passwd "$APP_USER"
fi

# --- firewall --------------------------------------------------------------------
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# --- 2 GB swap (Next.js builds need memory) -------------------------------------
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- packages ----------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y curl git debian-keyring debian-archive-keyring apt-transport-https gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

# --- Caddy (automatic HTTPS) -------------------------------------------------------
if ! command -v caddy &>/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
printf '%s {\n  reverse_proxy localhost:3000\n}\n' "$API_DOMAIN" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# --- pm2 on boot for the app user -----------------------------------------------
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

# --- deploy key for cloning the private GitHub repo ------------------------------
KEY="/home/$APP_USER/.ssh/github_deploy"
if [[ ! -f "$KEY" ]]; then
  sudo -u "$APP_USER" ssh-keygen -t ed25519 -N "" -f "$KEY" -C "paperclip-vps" >/dev/null
  sudo -u "$APP_USER" bash -c "printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' '$KEY' >> ~/.ssh/config && chmod 600 ~/.ssh/config"
  sudo -u "$APP_USER" bash -c "ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null"
fi

echo
echo "==================================================================="
echo " Done. Node $(node -v), pm2 $(pm2 -v), Caddy installed."
echo
echo " NEXT: add this read-only DEPLOY KEY to the GitHub repo"
echo " (repo → Settings → Deploy keys → Add deploy key, leave 'write' unticked):"
echo
cat "$KEY.pub"
echo
echo " Then log in as $APP_USER:   ssh $APP_USER@<this-ip>"
echo " and follow docs/DEPLOY.md from step 5 (clone, .env, build, pm2)."
echo "==================================================================="
