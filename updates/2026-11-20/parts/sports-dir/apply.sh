#!/usr/bin/env bash
# Pitchside Forum: Sports page organised by sport. Football first with its competitions grouped by region, then a
# compact directory of the other sports; each sport has its own page of tidy competition cards.
#  public/assets/sports-dir.1.js (new); app/shell.html loads it
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" ]] || ! grep -q '</body>' "$SHELL_HTML"; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/sports-dir.1.js "$APP/public/assets/sports-dir.1.js"
grep -q 'sports-dir.1.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/sports-dir.1.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'sports-dir.1.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/public/assets/sports-dir.1.js"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/sports-dir.1.js" "$SHELL_HTML" 2>/dev/null || true
echo "Done. The Sports page is organised by sport, with Football first."
