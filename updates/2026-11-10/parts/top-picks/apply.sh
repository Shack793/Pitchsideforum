#!/usr/bin/env bash
# Pitchside Forum: Top picks (partner casinos first on the Casinos & Sportsbooks page) with Admin → Top picks to change them.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-toppicks.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-toppicks.php "$APP/app/ops/zz-toppicks.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/toppicks.1.js "$APP/public/assets/toppicks.1.js"
grep -q 'toppicks.1.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/toppicks.1.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'toppicks.1.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-toppicks.php" "$APP/public/assets/toppicks.1.js"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-toppicks.php" "$APP/public/assets/toppicks.1.js" "$SHELL_HTML" 2>/dev/null || true
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "Top picks installed, but the list couldn't be set: $(echo "$OUT" | tail -1)"; exit 1; }
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
M=$(awk '/^MISSING/{sub(/^MISSING /,""); print}' <<<"$OUT")
echo "Done. Top picks: $(awk '/^PICKS/{sub(/^PICKS /,""); print}' <<<"$OUT")."
[[ "$M" != "-" ]] && echo "Not in your directory yet, so not shown: $M." || true
