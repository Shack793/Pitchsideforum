#!/usr/bin/env bash
# Pitchside Forum: Bug Reports board with statuses (New, Investigating, Confirmed, Fixed, Closed).
# Adds two new files and one line in app/shell.html, creates the board (in Community) and pins a short
# "How to report a bug" guide there.
#   sudo bash apply.sh
# Safe to run again.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if ! command -v php >/dev/null 2>&1 || ! php -l app/ops/zz-bugs.php >/dev/null 2>&1; then echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; fi

STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
echo "==> Backup saved in $BK"
undo() { cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-bugs.php" "$APP/public/assets/bugs.1.js"; echo "$1 Everything was put back; nothing was changed."; exit 1; }

OWN_OPS=$(stat -c '%U:%G' "$APP/app/ops"); OWN_AS=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN_OPS%%:*}" -g "${OWN_OPS##*:}" app/ops/zz-bugs.php "$APP/app/ops/zz-bugs.php"
install -m 644 -o "${OWN_AS%%:*}" -g "${OWN_AS##*:}" public/assets/bugs.1.js "$APP/public/assets/bugs.1.js"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-bugs.php" "$APP/public/assets/bugs.1.js" 2>/dev/null || true

OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
OUT=$(cd "$APP" && "${RUN[@]}" -r 'require "app/lib/api.php"; $d = bugs_install(); echo "SETUP OK ", implode(" ", $d);' 2>&1)
grep -q 'SETUP OK' <<<"$OUT" || { echo "$OUT" | tail -5; undo "The board couldn't be set up."; }
echo "==> Bug Reports board ready"

TAG='<script src="/assets/bugs.1.js"></script>'
if ! grep -q 'bugs.1.js' "$SHELL_HTML"; then
  if grep -q '/assets/pin-order.1.js' "$SHELL_HTML"; then sed -i "\#/assets/pin-order.1.js#a $TAG" "$SHELL_HTML"
  else sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; fi
fi
[[ $(grep -c 'bugs.1.js' "$SHELL_HTML") -eq 1 ]] || undo "The page script couldn't be added."
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
CHECK=$(cd "$APP/public" && REQUEST_URI=/forum/bug-reports php index.php 2>/dev/null | head -c 200000 || true)
grep -q "We'll be right back" <<<"$CHECK" && undo "A test page didn't load."

FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

echo
echo "Done. Bug Reports is open in Community, with a pinned \"How to report a bug\" guide."
echo "Staff change a report's status with the \"Change status\" button on the report."
echo "To remove the statuses: sudo cp -a $BK/app/shell.html $SHELL_HTML && sudo rm $APP/app/ops/zz-bugs.php $APP/public/assets/bugs.1.js"
