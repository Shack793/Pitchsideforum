#!/usr/bin/env bash
# Pitchside Forum: first-time setup on a Namecheap Quasar VPS running Ubuntu 22.04 or 24.04.
# Run as root from inside the unzipped pitchside-vps folder:
#   sudo bash setup.sh yourdomain.com you@youremail.com
# What it does: installs Nginx and Certbot, copies the site to /var/www/pitchside,
# opens the firewall for web traffic, and gets a free HTTPS certificate.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash setup.sh yourdomain.com you@youremail.com"; exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"

echo "==> Installing Nginx, Certbot and the firewall"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx ufw rsync

echo "==> Copying the site to /var/www/pitchside"
mkdir -p /var/www/pitchside
rsync -a --delete public/ /var/www/pitchside/
chown -R www-data:www-data /var/www/pitchside
find /var/www/pitchside -type d -exec chmod 755 {} \;
find /var/www/pitchside -type f -exec chmod 644 {} \;

echo "==> Configuring Nginx for $DOMAIN"
sed "s/example\.com/$DOMAIN/g" nginx/pitchside.conf > /etc/nginx/sites-available/pitchside
ln -sf /etc/nginx/sites-available/pitchside /etc/nginx/sites-enabled/pitchside
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Opening the firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Getting a free HTTPS certificate from Let's Encrypt"
echo "    (your domain's A records for $DOMAIN and www.$DOMAIN must already point to this server's IP)"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  echo "==> Done. Visit https://$DOMAIN"
else
  echo "!! HTTPS step failed, usually because DNS isn't pointing here yet."
  echo "   The site is live on http://$DOMAIN. Once DNS has updated, run:"
  echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
fi
echo "Certificates renew automatically."
