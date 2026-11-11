#!/usr/bin/env bash
# Pitchside Forum: ad safety net. Puts the homepage banner and side ads back if the page comes out without them
# while they are switched on and live. One new file and one line in app/shell.html.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" || ! -d "$APP/public/assets" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" public/assets/ads-fix.1.js "$APP/public/assets/ads-fix.1.js"
grep -q 'ads-fix.1.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/ads-fix.1.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'ads-fix.1.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/public/assets/ads-fix.1.js"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/ads-fix.1.js" "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. Homepage banner and side ads will always show while they are on and live."
