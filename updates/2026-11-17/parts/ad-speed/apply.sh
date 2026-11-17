#!/usr/bin/env bash
# Pitchside Forum: ad pictures never slow pages down. Banner pictures (homepage, side, under the first post) start
# downloading only after the page itself has loaded; their space is kept meanwhile (ad-placeholder step).
#  - public/assets/full-banners.4.js: replaces full-banners.2.js / .3.js
#  - app/ops/zz-adpreload.php: emptied (it used to push banner pictures ahead of the page's own files)
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" || ! -d "$APP/public/assets" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWNA=$(stat -c '%U:%G' "$APP/public/assets"); OWNO=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/full-banners.4.js "$APP/public/assets/full-banners.4.js"
install -m 644 -o "${OWNO%%:*}" -g "${OWNO##*:}" app/ops/zz-adpreload.php "$APP/app/ops/zz-adpreload.php"
if grep -qE '/assets/full-banners\.[123]\.js' "$SHELL_HTML"; then
  sed -i -E 's#/assets/full-banners\.[123]\.js#/assets/full-banners.4.js#' "$SHELL_HTML"
  if [[ $(grep -c 'full-banners.4.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-adpreload.php"; echo "Couldn't switch the page script. Nothing was changed."; exit 1; fi
fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/full-banners.4.js" "$APP/app/ops/zz-adpreload.php" "$SHELL_HTML" 2>/dev/null || true
echo "Done. Ad pictures now load after the page, so they never slow it down."
