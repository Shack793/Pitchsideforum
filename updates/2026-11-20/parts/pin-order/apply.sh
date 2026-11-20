#!/usr/bin/env bash
# Pitchside Forum update: choose the order of pinned topics (Up / Down buttons for moderators and admins).
# Adds two new files and one line to app/shell.html. Nothing else on the site is changed.
#   sudo bash apply.sh
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" || ! -d "$APP/app/ops" || ! -d "$APP/public/assets" ]]; then
  echo "Couldn't find the site in $APP. Nothing was changed."; exit 1
fi

# Backup of the one existing file this changes
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
echo "==> Backup saved in $BK"

# New files, owned like the files next to them
OWN_OPS=$(stat -c '%U:%G' "$APP/app/ops"); OWN_ASSETS=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN_OPS%%:*}" -g "${OWN_OPS##*:}" app/ops/pin-order.php "$APP/app/ops/pin-order.php"
install -m 644 -o "${OWN_ASSETS%%:*}" -g "${OWN_ASSETS##*:}" public/assets/pin-order.1.js "$APP/public/assets/pin-order.1.js"
echo "==> Added the pinned-order files"

# Load the new script on every page (once)
TAG='<script src="/assets/pin-order.1.js"></script>'
if grep -q 'pin-order.1.js' "$SHELL_HTML"; then
  echo "==> The page already loads it"
elif grep -q '/assets/pins-scoped.1.js' "$SHELL_HTML"; then
  sed -i "\#/assets/pins-scoped.1.js#a $TAG" "$SHELL_HTML"; echo "==> The page now loads it"
else
  sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; echo "==> The page now loads it"
fi
if [[ $(grep -c 'pin-order.1.js' "$SHELL_HTML") -ne 1 ]]; then
  cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/pin-order.php" "$APP/public/assets/pin-order.1.js"
  echo "Something went wrong adding the script, so everything was put back. Nothing was changed."; exit 1
fi

# SELinux labels (AlmaLinux), PHP check, PHP restart, page cache
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/pin-order.php" "$APP/public/assets/pin-order.1.js" "$SHELL_HTML" 2>/dev/null || true
if command -v php >/dev/null 2>&1 && ! php -l "$APP/app/ops/pin-order.php" >/dev/null 2>&1; then
  cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/pin-order.php" "$APP/public/assets/pin-order.1.js"
  echo "This server's PHP couldn't read the new file, so everything was put back. Nothing was changed."; exit 1
fi
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

echo
echo "Done. Pinned topics can now be put in order."
echo "Open a board that has two or more pinned topics while signed in as an admin or moderator:"
echo "each pinned topic has Up and Down buttons. A topic you pin later shows at the top until you move it."
echo "To undo: sudo cp -a $BK/app/shell.html $SHELL_HTML && sudo rm $APP/app/ops/pin-order.php"
