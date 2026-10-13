#!/usr/bin/env bash
# Pitchside Forum: nightly backup of the database and uploaded files (runs at 03:15 from /etc/cron.d/pitchside).
# Keeps 14 days in /var/backups/pitchside. To also copy backups off the server (recommended), install rclone,
# run "rclone config" to add a remote named "offsite" (for example Backblaze B2), and this script uploads each night.
set -euo pipefail
APP=/var/www/pitchside
DEST=/var/backups/pitchside
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"; chmod 700 "$DEST"
mysqldump --single-transaction --quick --routines pitchside | gzip > "$DEST/db-$STAMP.sql.gz"
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C "$APP/public" uploads -C "$APP/app" config.php
find "$DEST" -type f -mtime +14 -delete
OFFSITE=0
if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q '^offsite:'; then
  rclone copy "$DEST" offsite:pitchside-backups --max-age 26h && OFFSITE=$(date +%s)
fi
PREV_OFF=$(php -r '$b=json_decode(@file_get_contents("'"$APP"'/app/storage/backup.json"),true); echo (int)($b["offsite"]??0);' 2>/dev/null || echo 0)
[[ "$OFFSITE" == "0" ]] && OFFSITE=$PREV_OFF
echo "{\"last\": $(date +%s), \"offsite\": $OFFSITE}" > "$APP/app/storage/backup.json"
chown www-data:www-data "$APP/app/storage/backup.json"
echo "Backup saved: $DEST/db-$STAMP.sql.gz"
