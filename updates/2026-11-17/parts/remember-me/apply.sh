#!/usr/bin/env bash
# Pitchside Forum: "Keep me signed in" tick box on sign-in. Unticked: signed out when the browser closes or after 12 idle hours. Ticked: 30 days.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-remember.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-remember.php "$APP/app/ops/zz-remember.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/remember-me.1.js "$APP/public/assets/remember-me.1.js"
grep -q 'remember-me.1.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/remember-me.1.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'remember-me.1.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-remember.php" "$APP/public/assets/remember-me.1.js" "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
echo "Done. The sign-in form now has a \"Keep me signed in\" tick box."
