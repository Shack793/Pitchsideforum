#!/usr/bin/env bash
# Pitchside Forum: publish a new version. Upload and unzip the new pitchside-vps folder, then:
#   sudo bash update.sh
# Your settings (config.php), uploads and database are kept. A backup is taken first.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"
APP=/var/www/pitchside
echo "==> Backing up first"
bash "$APP/backup.sh" || bash backup.sh
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/backups/pitchside/code
tar -czf "/var/backups/pitchside/code/code-$STAMP.tar.gz" -C "$APP" --exclude 'public/uploads' --exclude 'app/storage' app public
echo "==> Copying the new version"
rsync -a --delete --exclude 'app/config.php' --exclude 'app/storage/' --exclude 'public/uploads/' app public "$APP/"
cp backup.sh update.sh "$APP/"
chown -R root:www-data "$APP/app" "$APP/public"; chown -R www-data:www-data "$APP/app/storage" "$APP/public/uploads"; chmod 640 "$APP/app/config.php"
echo "==> Updating the database (new tables and settings only; nothing is deleted)"
runuser -u www-data -- php "$APP/app/install.php"
runuser -u www-data -- php "$APP/app/selftest.php" || echo "!! The self-test found a problem (see above)."
PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
systemctl reload "php$PHPV-fpm"; nginx -t && systemctl reload nginx
rm -f "$APP/app/storage/cache/"*.json
echo "Updated. To roll back the code: sudo tar -xzf /var/backups/pitchside/code/code-$STAMP.tar.gz -C $APP && sudo systemctl reload php$PHPV-fpm"
