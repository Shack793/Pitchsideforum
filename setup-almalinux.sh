#!/usr/bin/env bash
# Pitchside Forum: first-time setup on AlmaLinux 9 (Namecheap VPS Quasar, blank image).
# Run as root from inside the unzipped pitchside-vps folder:
#   sudo bash setup-almalinux.sh pitchsideforum.com admin@pitchsideforum.com
# What it does: installs Nginx + Certbot + firewalld + rsync + git,
# copies public/ to /var/www/pitchside, configures Nginx + firewall,
# gets free HTTPS via Let's Encrypt, creates `deploy` user for GitHub Actions.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash setup-almalinux.sh yourdomain.com you@youremail.com"; exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"

echo "==> [1/7] Installing EPEL + Nginx + Certbot + firewalld + rsync + git"
dnf install -y epel-release
dnf update -y
dnf install -y nginx certbot python3-certbot-nginx firewalld rsync git tar unzip policycoreutils-python-utils

echo "==> [2/7] Enabling and starting nginx + firewalld"
systemctl enable --now nginx
systemctl enable --now firewalld
# wait for firewalld to be ready
sleep 3
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload
firewall-cmd --list-all || true

echo "==> [3/7] Copying site to /var/www/pitchside"
mkdir -p /var/www/pitchside
mkdir -p /var/www/pitchside-backups
rsync -a --delete public/ /var/www/pitchside/
# AlmaLinux nginx runs as user `nginx` (not www-data like Ubuntu)
chown -R nginx:nginx /var/www/pitchside
find /var/www/pitchside -type d -exec chmod 755 {} \;
find /var/www/pitchside -type f -exec chmod 644 {} \;
# SELinux: allow nginx to serve files (harmless if SELinux disabled)
if command -v restorecon >/dev/null 2>&1; then
  restorecon -Rv /var/www/pitchside || true
  # httpd_t needs read access; public_content_t is safest for static files
  # chcon -R -t httpd_sys_content_t /var/www/pitchside || true
fi
if command -v setsebool >/dev/null 2>&1; then
  setsebool -P httpd_can_network_connect 1 || true
fi

echo "==> [4/7] Configuring Nginx for $DOMAIN"
# AlmaLinux uses /etc/nginx/conf.d/*.conf (no sites-available/sites-enabled)
sed "s/example\.com/$DOMAIN/g" nginx/pitchside.conf > /etc/nginx/conf.d/pitchside.conf
# Remove default server if it conflicts (AlmaLinux default.conf may exist)
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx
systemctl status nginx --no-pager || true

echo "==> [5/7] Creating 'deploy' user for GitHub Actions (key-based, no password)"
if ! id deploy >/dev/null 2>&1; then
  useradd -m -s /bin/bash deploy
fi
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
# Let deploy user write the web root and reload nginx without password
chgrp deploy /var/www/pitchside
chmod 775 /var/www/pitchside
# ACL so new files stay writable by deploy (if acl package present)
if command -v setfacl >/dev/null 2>&1; then
  setfacl -R -m g:deploy:rwx /var/www/pitchside || true
  setfacl -R -d -m g:deploy:rwx /var/www/pitchside || true
fi
cat > /etc/sudoers.d/deploy-nginx <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx, /usr/sbin/nginx -t, /usr/bin/rsync, /bin/tar
EOF
chmod 440 /etc/sudoers.d/deploy-nginx
visudo -c

echo "    -> Now add your GitHub Actions public key to /home/deploy/.ssh/authorized_keys:"
echo "       cat your-deploy-key.pub | ssh root@YOUR_VPS_IP 'cat >> /home/deploy/.ssh/authorized_keys'"
echo "    -> Or paste GitHub secret SSH_PUBLIC_KEY content manually."

echo "==> [6/7] Getting free HTTPS certificate from Let's Encrypt"
echo "    (DNS A records for $DOMAIN and www.$DOMAIN must already point to this server IP)"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  echo "==> HTTPS OK. Visit https://$DOMAIN"
else
  echo "!! HTTPS step failed, usually because DNS isn't pointing here yet."
  echo "   Current DNS (check on your PC): nslookup $DOMAIN ; nslookup www.$DOMAIN"
  echo "   Expected VPS IP: $(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')"
  echo "   The site is live on http://$DOMAIN. Once DNS has updated, run:"
  echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
fi
systemctl enable --now certbot-renew.timer 2>/dev/null || systemctl enable --now certbot.timer 2>/dev/null || echo "(certbot timer not found, renewal via cron)"
echo "Certificates renew automatically."

echo "==> [7/7] Done."
echo "    Web root : /var/www/pitchside"
echo "    Backups  : /var/www/pitchside-backups (update.sh keeps last 10)"
echo "    Nginx cfg: /etc/nginx/conf.d/pitchside.conf"
echo "    Test     : curl -I http://$DOMAIN ; curl -I https://$DOMAIN"
