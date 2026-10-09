#!/usr/bin/env bash
# Pitchside Forum: publish a new version on AlmaLinux 9.
# Upload the new pitchside-vps folder (or just its public/ folder), then run:
#   sudo bash update-almalinux.sh
# The previous version is kept in /var/www/pitchside-backups (last 10 kept).
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/www/pitchside-backups
tar -czf "/var/www/pitchside-backups/pitchside-$STAMP.tar.gz" -C /var/www pitchside
ls -1t /var/www/pitchside-backups/*.tar.gz | tail -n +11 | xargs -r rm -f   # keep the last 10

rsync -a --delete public/ /var/www/pitchside/
chown -R nginx:nginx /var/www/pitchside
chgrp deploy /var/www/pitchside 2>/dev/null || true
chmod 775 /var/www/pitchside
if command -v restorecon >/dev/null 2>&1; then restorecon -Rv /var/www/pitchside || true; fi
nginx -t && systemctl reload nginx
echo "Updated. Backup saved as /var/www/pitchside-backups/pitchside-$STAMP.tar.gz"
echo "To roll back: sudo tar -xzf /var/www/pitchside-backups/pitchside-$STAMP.tar.gz -C /var/www"
