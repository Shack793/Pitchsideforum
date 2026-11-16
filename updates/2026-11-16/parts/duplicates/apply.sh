#!/usr/bin/env bash
# Pitchside Forum: duplicate-post detection. Adds one new server file; no existing file is changed.
#   sudo bash apply.sh
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/ops/forum.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi

if command -v php >/dev/null 2>&1 && ! php -l app/ops/zz-duplicates.php >/dev/null 2>&1; then
  echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1
fi
OWN=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-duplicates.php "$APP/app/ops/zz-duplicates.php"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-duplicates.php" 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true

echo
echo "Done. Duplicate-post detection is on."
echo "To turn it off again: sudo rm $APP/app/ops/zz-duplicates.php"
