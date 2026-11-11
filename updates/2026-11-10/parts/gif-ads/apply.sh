#!/usr/bin/env bash
# Pitchside Forum: animated GIF ads. GIF pictures in homepage banners, full banners, side ads and in-post ads stay
# animated: the browser no longer turns them into a still picture, and the server keeps them as GIFs.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-gifads.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-gifads.php "$APP/app/ops/zz-gifads.php"
SWAPS=("ads-tweaks.2.js ads-tweaks.3.js" "ads-images.1.js ads-images.2.js" "full-banners.1.js full-banners.2.js")
for s in "${SWAPS[@]}"; do
  set -- $s; OLD=$1; NEW=$2
  install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" "public/assets/$NEW" "$APP/public/assets/$NEW"
  if grep -q "/assets/$NEW" "$SHELL_HTML"; then continue; fi
  if grep -q "/assets/$OLD" "$SHELL_HTML"; then sed -i "s#/assets/${OLD//./\\.}#/assets/$NEW#" "$SHELL_HTML"
  else echo "Note: $OLD isn't on this site, so $NEW wasn't switched on."; fi
done
command -v restorecon >/dev/null 2>&1 && restorecon -R "$APP/app/ops/zz-gifads.php" "$APP/public/assets" "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
echo "Done. GIF banners and ads now stay animated. Upload the GIF again for any ad that went still."
