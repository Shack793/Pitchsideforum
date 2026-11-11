#!/usr/bin/env bash
# Pitchside Forum: the AI moderator (Admin → AI moderation).
# Adds two new files, two new database tables and one line in app/shell.html. Your AI chatbots are not touched.
#   sudo bash apply.sh
# Safe to run again.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if ! command -v php >/dev/null 2>&1 || ! php -l app/ops/zz-automod.php >/dev/null 2>&1; then echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; fi
if ! php -m 2>/dev/null | grep -qi '^curl$'; then echo "Note: PHP's curl module isn't loaded, so the AI check won't be able to reach an AI service. The rule-based checks still work."; fi

STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
echo "==> Backup saved in $BK"

undo() { cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-automod.php" "$APP/public/assets/automod.1.js"; echo "$1 Everything was put back; nothing was changed."; exit 1; }

OWN_OPS=$(stat -c '%U:%G' "$APP/app/ops"); OWN_AS=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN_OPS%%:*}" -g "${OWN_OPS##*:}" app/ops/zz-automod.php "$APP/app/ops/zz-automod.php"
install -m 644 -o "${OWN_AS%%:*}" -g "${OWN_AS##*:}" public/assets/automod.1.js "$APP/public/assets/automod.1.js"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-automod.php" "$APP/public/assets/automod.1.js" 2>/dev/null || true

# Database tables (as the account that owns the site's storage)
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
OUT=$(cd "$APP" && "${RUN[@]}" -r 'require "app/lib/api.php"; am_install_tables(); if (cfg("db_driver") !== "sqlite") q("ALTER TABLE meta MODIFY v MEDIUMTEXT NOT NULL"); echo am_ready() ? "TABLES OK" : "TABLES MISSING";' 2>&1)
if ! grep -q 'TABLES OK' <<<"$OUT"; then echo "$OUT" | tail -5; undo "The database tables couldn't be created."; fi
echo "==> Database tables ready"

# Load the admin page script (once)
TAG='<script src="/assets/automod.1.js"></script>'
if ! grep -q 'automod.1.js' "$SHELL_HTML"; then
  if grep -q '/assets/market-rules.1.js' "$SHELL_HTML"; then sed -i "\#/assets/market-rules.1.js#a $TAG" "$SHELL_HTML"
  elif grep -q '/assets/pin-order.1.js' "$SHELL_HTML"; then sed -i "\#/assets/pin-order.1.js#a $TAG" "$SHELL_HTML"
  else sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; fi
fi
[[ $(grep -c 'automod.1.js' "$SHELL_HTML") -eq 1 ]] || undo "The admin page couldn't be added."
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true

# Check the site still answers
CHECK=$(cd "$APP/public" && REQUEST_URI=/ php index.php 2>/dev/null | head -c 200000 || true)
grep -q "We'll be right back" <<<"$CHECK" && undo "A test page didn't load."

FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

echo
echo "Done. The AI moderator is checking new posts with its rule-based checks."
echo "Open Admin → AI moderation to see its log, reverse decisions and change settings."
echo "To switch on the AI check, add your AI key there under \"AI service\" (Super Admins only)."
echo "To remove it completely: sudo cp -a $BK/app/shell.html $SHELL_HTML && sudo rm $APP/app/ops/zz-automod.php $APP/public/assets/automod.1.js"
