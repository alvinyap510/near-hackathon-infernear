#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 VPS, run as root from a copy of this repo at /opt/infernear.
# Usage: API_HOST=api.example.com APP_HOST=app.example.com bash deploy/setup.sh
# Before running: fill /opt/infernear/.env from .env.example (RELAY_PUBLIC_URL=https://$API_HOST,
# RELAY_WEB_ORIGIN=https://$APP_HOST, VITE_RELAY_URL=https://$API_HOST) and point both DNS names at this host.
set -euo pipefail
: "${API_HOST:?}" "${APP_HOST:?}"
cd /opt/infernear

apt-get update
apt-get install -y ca-certificates curl gnupg caddy
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

id infernear >/dev/null 2>&1 || useradd --system --home /opt/infernear --shell /usr/sbin/nologin infernear
chown root:infernear .env && chmod 640 .env

(cd relay && npm ci --ignore-scripts)
(cd web && npm ci --ignore-scripts && npm run build)

mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=API_HOST=%s APP_HOST=%s\n' "$API_HOST" "$APP_HOST" > /etc/systemd/system/caddy.service.d/hosts.conf
cp deploy/Caddyfile /etc/caddy/Caddyfile
cp deploy/infernear-relay.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now infernear-relay
systemctl restart caddy
echo "Check: curl https://$API_HOST/v1/models"
