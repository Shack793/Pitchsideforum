#!/usr/bin/env bash
# Pitchside Forum: penalty points. Admins can take points straight off any casino's or sportsbook's Safety Index
# (0.5 to 10), with a reason that visitors see under "What lowers it". Set in Admin → Reviews → Penalty points.
#  - app/ops/zz-penalty.php (new), public/assets/penalty.1.js (new, loaded right after admin-rating.1.js)
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-penalty.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-penalty.php "$APP/app/ops/zz-penalty.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/penalty.1.js "$APP/public/assets/penalty.1.js"
if ! grep -q 'penalty.1.js' "$SHELL_HTML"; then
  # must come after the admin rating script, which recalculates the score
  if grep -q 'admin-rating.1.js' "$SHELL_HTML"; then A='/assets/admin-rating.1.js'; else A=$(grep -oE '/assets/[^"]+\.js' "$SHELL_HTML" | tail -1); fi
  awk -v a="$A" '{print} !d && index($0,a){print "<script src=\"/assets/penalty.1.js\"></script>"; d=1}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
fi
if [[ $(grep -c 'penalty.1.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-penalty.php" "$APP/public/assets/penalty.1.js"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-penalty.php" "$APP/public/assets/penalty.1.js" "$SHELL_HTML" 2>/dev/null || true
echo "Done. Set penalty points in Admin → Reviews → Penalty points."
