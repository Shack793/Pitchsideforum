#!/usr/bin/env bash
# Pitchside Forum: shows the complaints policy on the Complaints page and the review guidelines on the casino and
# sportsbook card pages (plus a link in the complaint and review forms), and merges the two guideline copies into one.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp merge.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/merge.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "Couldn't merge the review guidelines: $(echo "$OUT" | tail -1)"; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" public/assets/policy-pins.1.js "$APP/public/assets/policy-pins.1.js"
TAG='<script src="/assets/policy-pins.1.js"></script>'
if ! grep -q 'policy-pins.1.js' "$SHELL_HTML"; then
  if grep -q '/assets/bugs.1.js' "$SHELL_HTML"; then sed -i "\#/assets/bugs.1.js#a $TAG" "$SHELL_HTML"
  else sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; fi
fi
if [[ $(grep -c 'policy-pins.1.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/public/assets/policy-pins.1.js"; echo "Couldn't add the page script."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/policy-pins.1.js" "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. Complaints policy on the Complaints page; review guidelines on the casino and sportsbook pages. $OUT"
