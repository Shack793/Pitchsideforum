#!/usr/bin/env bash
# Pitchside Forum: visitor counts by country (Admin → Visitors). No IP addresses are stored.
# Adds two new files, one database table, the country lookup file (downloaded from DB-IP) and one line in app/shell.html.
#   sudo bash apply.sh
# Safe to run again.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if ! command -v php >/dev/null 2>&1 || ! php -l app/ops/zz-visitors.php >/dev/null 2>&1; then echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; fi

STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
echo "==> Backup saved in $BK"
undo() { cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-visitors.php" "$APP/public/assets/visitors.1.js"; echo "$1 Everything was put back; nothing was changed."; exit 1; }

OWN_OPS=$(stat -c '%U:%G' "$APP/app/ops"); OWN_AS=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN_OPS%%:*}" -g "${OWN_OPS##*:}" app/ops/zz-visitors.php "$APP/app/ops/zz-visitors.php"
install -m 644 -o "${OWN_AS%%:*}" -g "${OWN_AS##*:}" public/assets/visitors.1.js "$APP/public/assets/visitors.1.js"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-visitors.php" "$APP/public/assets/visitors.1.js" 2>/dev/null || true

OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
OUT=$(cd "$APP" && "${RUN[@]}" -r 'require "app/lib/api.php"; vis_install_tables(); echo vis_ready() ? "TABLE OK" : "TABLE MISSING";' 2>&1)
grep -q 'TABLE OK' <<<"$OUT" || { echo "$OUT" | tail -5; undo "The database table couldn't be created."; }
echo "==> Database table ready"

echo "==> Downloading the country database from DB-IP (about 10 MB)…"
GEO=$(cd "$APP" && "${RUN[@]}" -d memory_limit=512M -r 'require "app/lib/api.php"; if (vis_geo_info()["installed"] && (vis_geo_info()["source"] ?? "") === "dbip-country-lite-" . gmdate("Y-m")) { echo "GEO current"; exit; } try { $r = vis_download_geo(); echo "GEO ", $r; } catch (Throwable $e) { echo "GEOFAIL ", $e->getMessage(); }' 2>&1)
if grep -q '^GEO ' <<<"$GEO"; then echo "    Country lookup ready."; else echo "    Couldn't download it right now; the site will retry every day. Until then visitors show as \"Unknown\" country."; fi
[[ -d "$APP/app/storage/geo" ]] && command -v restorecon >/dev/null 2>&1 && restorecon -R "$APP/app/storage/geo" 2>/dev/null || true

TAG='<script src="/assets/visitors.1.js"></script>'
if ! grep -q 'visitors.1.js' "$SHELL_HTML"; then
  if grep -q '/assets/automod.1.js' "$SHELL_HTML"; then sed -i "\#/assets/automod.1.js#a $TAG" "$SHELL_HTML"
  elif grep -q '/assets/market-rules.1.js' "$SHELL_HTML"; then sed -i "\#/assets/market-rules.1.js#a $TAG" "$SHELL_HTML"
  else sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; fi
fi
[[ $(grep -c 'visitors.1.js' "$SHELL_HTML") -eq 1 ]] || undo "The admin page couldn't be added."
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true

CHECK=$(cd "$APP/public" && REQUEST_URI=/ php index.php 2>/dev/null | head -c 200000 || true)
grep -q "We'll be right back" <<<"$CHECK" && undo "A test page didn't load."

FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

echo
echo "Done. Visitors are being counted from now on. See them in Admin → Visitors."
echo "To remove it: sudo cp -a $BK/app/shell.html $SHELL_HTML && sudo rm $APP/app/ops/zz-visitors.php $APP/public/assets/visitors.1.js"
