#!/usr/bin/env bash
# Pitchside Forum: ads show without a delay. The homepage banner and side ad pictures start downloading as soon as the
# page arrives (and are no longer "lazy"), so there's no empty white box while they load.
#  - app/ops/zz-adpreload.php: tells the browser about those pictures in the page head
#  - public/assets/full-banners.3.js: replaces full-banners.2.js (in-post ads still load lazily, further down the page)
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" || ! -d "$APP/public/assets" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWNA=$(stat -c '%U:%G' "$APP/public/assets"); OWNO=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/full-banners.3.js "$APP/public/assets/full-banners.3.js"
install -m 644 -o "${OWNO%%:*}" -g "${OWNO##*:}" app/ops/zz-adpreload.php "$APP/app/ops/zz-adpreload.php"
if grep -qE '/assets/full-banners\.2\.js' "$SHELL_HTML"; then
  sed -i -E 's#/assets/full-banners\.2\.js#/assets/full-banners.3.js#' "$SHELL_HTML"
  if [[ $(grep -c 'full-banners.3.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-adpreload.php"; echo "Couldn't switch the page script. Nothing was changed."; exit 1; fi
fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/full-banners.3.js" "$APP/app/ops/zz-adpreload.php" "$SHELL_HTML" 2>/dev/null || true
echo "Done. The homepage banner and side ads now load straight away."
