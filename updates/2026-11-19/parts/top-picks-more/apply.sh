#!/usr/bin/env bash
# Pitchside Forum: more Top picks. Adds SportyBet, then (once) sets the Top picks: your current top 6 stay as 1-6,
# SportyBet 7th, then the bookmakers from your November list. The Top picks row now follows the order in
# Admin → Top picks and shows them all (first 12, then "Show all"). Up to 60 picks are allowed.
#  - public/assets/casino-list.7.js replaces casino-list.6.js; app/ops/zz-toppicks.php allows 60 picks
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"; TP="$APP/app/ops/zz-toppicks.php"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" || ! -f "$TP" ]]; then echo "Couldn't find the site (or its Top picks feature) in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app/ops" && cp -a "$SHELL_HTML" "$BK/app/shell.html" && cp -a "$TP" "$BK/app/ops/zz-toppicks.php" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
sed -i 's/\$ok = array_slice(\$ok, 0, 12);/$ok = array_slice($ok, 0, 60);/' "$TP"
php -l "$TP" >/dev/null 2>&1 || { cp -a "$BK/app/ops/zz-toppicks.php" "$TP"; echo "Couldn't update the Top picks limit. Nothing was changed."; exit 1; }
OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/casino-list.7.js "$APP/public/assets/casino-list.7.js"
sed -i -E 's#/assets/casino-list\.[3456]\.js#/assets/casino-list.7.js#' "$SHELL_HTML"
if [[ $(grep -c 'casino-list.7.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't find the casino list script in shell.html. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "Installed, but the Top picks couldn't be set: $(echo "$OUT" | tail -1)"; exit 1; }
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/casino-list.7.js" "$SHELL_HTML" "$TP" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
A=$(awk '/^ADDED/{sub(/^ADDED /,""); print}' <<<"$OUT"); K=$(awk '/^PICKS/{sub(/^PICKS /,""); print}' <<<"$OUT"); M=$(awk '/^MISSING/{sub(/^MISSING /,""); print}' <<<"$OUT")
echo "Done. Added: $A. Top picks: $K.$([[ -n "$M" && "$M" != "-" ]] && echo " Not found in the directory: $M.")"
