#!/usr/bin/env bash
# Pitchside Forum: makes every step of the page trail a working link (section names like Gambling, Sports, Crypto,
# Marketplace and Community; and Tags, with a new /tags page), and the section headings on the Forum page.
# One new file and one line in app/shell.html (replaces links.1.js if an earlier version was installed).
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" || ! -d "$APP/public/assets" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" public/assets/links.2.js "$APP/public/assets/links.2.js"
sed -i '\#/assets/links\.1\.js#d' "$SHELL_HTML"
grep -q 'src="/assets/links.2.js"' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/links.2.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'src="/assets/links.2.js"' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/public/assets/links.2.js"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/links.2.js" "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. Every page-trail step and Forum section heading is a working link."
