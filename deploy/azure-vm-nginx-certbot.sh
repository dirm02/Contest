#!/usr/bin/env bash
# AccountabilityMax — nginx + Let's Encrypt on Ubuntu (Azure VM).
# Run as root: sudo CERTBOT_EMAIL=you@example.com bash azure-vm-nginx-certbot.sh lev3l.website
#
# Optional: INCLUDE_WWW=1 to also request www (DNS must point www to this VM).
#
# Before running:
#  1. DNS: A record for the apex domain → this VM's public IPv4 (and www if INCLUDE_WWW=1).
#  2. Azure NSG: allow inbound TCP 80 and 443 to this VM.
#  3. Place hackathon repo at /var/www/AccountabilityMax-/ and create general/.env with DB_CONNECTION_STRING.
#  4. Copy frontend build: `dist/` → /var/www/accountibilitymax/dist on the VM.
#
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "${DOMAIN}" ]]; then
  echo "Usage: sudo CERTBOT_EMAIL=you@example.com bash $0 your.domain.tld"
  exit 1
fi

if [[ -z "${CERTBOT_EMAIL:-}" ]]; then
  echo "Set CERTBOT_EMAIL to a real address for Let's Encrypt (account notifications)."
  echo "Example: sudo CERTBOT_EMAIL=you@example.com bash $0 ${DOMAIN:-your.domain}"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

install -d -m 0755 /var/www/accountibilitymax/dist

# Remove default site if present
rm -f /etc/nginx/sites-enabled/default

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="${SCRIPT_DIR}/nginx-accountibilitymax.conf"
CONF_DST="/etc/nginx/sites-available/accountibilitymax"

if [[ ! -f "${CONF_SRC}" ]]; then
  echo "Missing ${CONF_SRC} (run this script from the deploy/ directory or copy the conf file next to it)."
  exit 1
fi

sed "s/YOUR_DOMAIN/${DOMAIN}/g" "${CONF_SRC}" > "${CONF_DST}"
ln -sf "${CONF_DST}" /etc/nginx/sites-enabled/accountibilitymax

nginx -t
systemctl enable --now nginx

CERT_ARGS=(--nginx --non-interactive --agree-tos --email "${CERTBOT_EMAIL}" --redirect -d "${DOMAIN}")
if [[ "${INCLUDE_WWW:-0}" == "1" ]]; then
  CERT_ARGS+=(-d "www.${DOMAIN}")
fi

echo "HTTP site ready. Obtaining certificate for: ${CERT_ARGS[*]} ..."
certbot "${CERT_ARGS[@]}"

systemctl reload nginx
echo "Done. https://${DOMAIN}/ should serve the app; /api proxies to localhost:3801."
echo "Install and start API:"
echo "  sudo cp \"${SCRIPT_DIR}/accountibilitymax-api.service\" /etc/systemd/system/"
echo "  cd /var/www/AccountabilityMax-/general && npm install --omit=dev"
echo "  sudo systemctl daemon-reload && sudo systemctl enable --now accountibilitymax-api"
