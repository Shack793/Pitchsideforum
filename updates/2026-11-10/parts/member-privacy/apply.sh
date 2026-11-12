#!/usr/bin/env bash
# Pitchside Forum: keeps the member list and staff list out of Google; individual member profiles can still be found.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-member-privacy.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-member-privacy.php "$APP/app/ops/zz-member-privacy.php"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-member-privacy.php" 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
echo "Done. The member list and staff list are hidden from search engines; member profiles can still be found."
