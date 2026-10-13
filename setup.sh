#!/usr/bin/env bash
# Pitchside Forum: first-time setup on a Namecheap Quasar VPS (Ubuntu 22.04 or 24.04).
# Run as root from inside the unzipped pitchside-vps folder:
#   sudo bash setup.sh yourdomain.com you@youremail.com
# It installs Nginx, PHP, MariaDB (MySQL), creates the database, copies the site,
# makes your Super Admin account, sets up HTTPS, nightly backups and background jobs.
set -euo pipefail

DOMAIN="${1:-}"; EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then echo "Usage: sudo bash setup.sh yourdomain.com you@youremail.com"; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"
APP=/var/www/pitchside

echo "==> Your Super Admin account (you'll sign in with this)"
read -rp "   Username (letters, numbers, underscores): " ADMIN_NAME
read -rp "   Email for the account [$EMAIL]: " ADMIN_EMAIL; ADMIN_EMAIL="${ADMIN_EMAIL:-$EMAIL}"
while true; do
  read -rsp "   Password (at least 10 characters): " ADMIN_PASS; echo
  read -rsp "   Same password again: " ADMIN_PASS2; echo
  [[ "$ADMIN_PASS" == "$ADMIN_PASS2" && ${#ADMIN_PASS} -ge 10 ]] && break
  echo "   Passwords didn't match or were too short. Try again."
done
read -rp "   Load sample topics and members to try things out? Not for the real launch. [y/N]: " DEMO

echo "==> Installing Nginx, PHP, MariaDB, Certbot and the firewall"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx mariadb-server php-fpm php-mysql php-gd php-curl php-mbstring php-xml php-intl php-zip \
  certbot python3-certbot-nginx ufw rsync unzip fail2ban
PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
PHP_SOCK="/run/php/php${PHPV}-fpm.sock"
echo "   PHP $PHPV"

echo "==> PHP settings (uploads up to 10 MB, safe defaults)"
cat > "/etc/php/$PHPV/fpm/conf.d/90-pitchside.ini" <<INI
upload_max_filesize = 12M
post_max_size = 14M
memory_limit = 256M
max_execution_time = 60
expose_php = Off
session.use_strict_mode = 1
opcache.enable = 1
opcache.validate_timestamps = 1
opcache.revalidate_freq = 10
INI
systemctl restart "php$PHPV-fpm"

echo "==> Database"
systemctl enable --now mariadb
DB_PASS=$(openssl rand -hex 24)
mysql <<SQL
CREATE DATABASE IF NOT EXISTS pitchside CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'pitchside'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER 'pitchside'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON pitchside.* TO 'pitchside'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "==> Copying the site to $APP"
mkdir -p "$APP"
rsync -a --delete --exclude 'app/config.php' --exclude 'app/storage/' --exclude 'public/uploads/' app public "$APP/"
mkdir -p "$APP/app/storage" "$APP/public/uploads"
cp backup.sh update.sh "$APP/" 2>/dev/null || true
if [[ ! -f "$APP/app/config.php" ]]; then
  cat > "$APP/app/config.php" <<PHP
<?php
// Pitchside Forum settings. Keep this file private: it holds your database password.
return [
  'site_url' => 'https://$DOMAIN',
  'db_driver' => 'mysql', 'db_host' => '127.0.0.1', 'db_port' => 3306, 'db_name' => 'pitchside', 'db_user' => 'pitchside', 'db_pass' => '$DB_PASS',
  // Email (sign-up confirmation, password resets, notification emails). Fill these in from your email provider
  // (Brevo, Amazon SES, Postmark, Mailgun…), then run: sudo systemctl reload php$PHPV-fpm
  'smtp_host' => '', 'smtp_port' => 587, 'smtp_secure' => 'tls', 'smtp_user' => '', 'smtp_pass' => '',
  'mail_from' => 'no-reply@$DOMAIN', 'mail_from_name' => 'Pitchside Forum',
  'require_email_verify' => true,
  // Human check on sign-up (Cloudflare Turnstile, free). Leave empty to turn off.
  'turnstile_site_key' => '', 'turnstile_secret' => '',
  // Secret for partner conversion postbacks: /api/aff/postback?...&key=THIS
  'postback_key' => '$(openssl rand -hex 16)',
  // Set to true only if the site sits behind Cloudflare's proxy
  'trust_cf_ip' => false,
  'debug' => false,
];
PHP
else
  sed -i "s/'db_pass' => '[^']*'/'db_pass' => '$DB_PASS'/" "$APP/app/config.php"
fi
chown -R root:www-data "$APP"
find "$APP" -type d -exec chmod 755 {} \; ; find "$APP" -type f -exec chmod 644 {} \;
chmod 640 "$APP/app/config.php"
chown -R www-data:www-data "$APP/app/storage" "$APP/public/uploads"
chmod 750 "$APP/app/storage"

echo "==> Creating tables and your Super Admin"
EXTRA=""; [[ "${DEMO,,}" == "y" ]] && EXTRA="--demo"
runuser -u www-data -- php "$APP/app/install.php" --admin="$ADMIN_NAME" --email="$ADMIN_EMAIL" --password="$ADMIN_PASS" $EXTRA

echo "==> Checking everything works"
runuser -u www-data -- php "$APP/app/selftest.php" || echo "!! The self-test found a problem (see above). The site may still work; send the output to your developer."

echo "==> Web server for $DOMAIN"
sed -e "s/DOMAIN/$DOMAIN/g" -e "s#PHP_SOCK#$PHP_SOCK#g" deploy/nginx.conf > /etc/nginx/sites-available/pitchside
ln -sf /etc/nginx/sites-available/pitchside /etc/nginx/sites-enabled/pitchside
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx && systemctl reload nginx

echo "==> Background jobs (every 5 minutes) and nightly backups (03:15)"
cat > /etc/cron.d/pitchside <<CRON
*/5 * * * * www-data php $APP/app/cron.php >/dev/null 2>&1
15 3 * * * root bash $APP/backup.sh >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/pitchside

echo "==> Firewall (SSH, HTTP, HTTPS) and brute-force protection for SSH"
ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw --force enable
systemctl enable --now fail2ban

echo "==> Free HTTPS certificate from Let's Encrypt"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  echo "==> Done. Visit https://$DOMAIN and sign in as $ADMIN_NAME"
else
  echo "!! HTTPS step failed, usually because DNS isn't pointing here yet."
  echo "   The site works on http://$DOMAIN. Once DNS has updated, run:"
  echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
fi
bash "$APP/backup.sh" || true
echo
echo "Next: add your email (SMTP) settings to $APP/app/config.php so sign-up confirmations and password resets are sent."
