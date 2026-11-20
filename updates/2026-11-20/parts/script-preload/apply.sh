#!/usr/bin/env bash
# Pitchside Forum: pages start faster. Every page's scripts now start downloading straight away, at the same time as
# the page itself, instead of only after the whole page (with its data) has arrived. app/ops/zz-script-preload.php (new).
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-script-preload.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-script-preload.php "$APP/app/ops/zz-script-preload.php"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-script-preload.php" 2>/dev/null || true
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: pitchsideforum.com' http://127.0.0.1/ 2>/dev/null || echo 000)
if [[ "$CODE" == "500" ]]; then rm -f "$APP/app/ops/zz-script-preload.php"; echo "The home page stopped working with this change, so it was taken out again. Nothing was changed."; exit 1; fi
echo "Done. Page scripts now start downloading straight away."
