#!/usr/bin/env bash
# Pitchside Forum: publish a new version of the site.
# Upload the new pitchside-vps folder (or just its public/ folder), then run:
#   sudo bash update.sh
# The previous version is kept in /var/www/pitchside-backups in case you need to roll back.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/www/pitchside-backups
tar -czf "/var/www/pitchside-backups/pitchside-$STAMP.tar.gz" -C /var/www pitchside
ls -1t /var/www/pitchside-backups/*.tar.gz | tail -n +11 | xargs -r rm -f   # keep the last 10

rsync -a --delete public/ /var/www/pitchside/
chown -R www-data:www-data /var/www/pitchside
nginx -t && systemctl reload nginx
echo "Updated. Backup saved as /var/www/pitchside-backups/pitchside-$STAMP.tar.gz"
echo "To roll back: sudo tar -xzf /var/www/pitchside-backups/pitchside-$STAMP.tar.gz -C /var/www"
