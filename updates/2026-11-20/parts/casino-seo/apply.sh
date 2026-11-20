#!/usr/bin/env bash
# Pitchside Forum: fuller casino / sportsbook pages for search engines (ratings, reviews, operator replies,
# complaints and structured data). Adds one server file and two small hooks in public/index.php.
#   sudo bash apply.sh
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
IDX="$APP/public/index.php"
if [[ ! -f "$IDX" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if ! command -v php >/dev/null 2>&1; then echo "PHP isn't available on the command line here. Nothing was changed."; exit 1; fi
if ! php -l app/ops/zz-operator-seo.php >/dev/null 2>&1; then echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; fi

STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/public" && cp -a "$IDX" "$BK/public/index.php" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
echo "==> Backup saved in $BK"

TMP=$(mktemp)
RES=$(php patch-index.php "$IDX" "$TMP"); RC=$?
if [[ $RC -eq 2 ]]; then
  rm -f "$TMP"; echo "Your casino page code isn't laid out as expected, so nothing was changed. Send me public/index.php and I'll fit it."; exit 1
elif [[ $RC -ne 0 ]]; then rm -f "$TMP"; echo "Couldn't read public/index.php. Nothing was changed."; exit 1; fi

OWN=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-operator-seo.php "$APP/app/ops/zz-operator-seo.php"
if [[ "$RES" == PATCHED* ]]; then
  if ! php -l "$TMP" >/dev/null 2>&1; then
    rm -f "$TMP" "$APP/app/ops/zz-operator-seo.php"; echo "The updated page code didn't pass a check, so nothing was changed."; exit 1
  fi
  cat "$TMP" > "$IDX"   # keeps the file's owner, permissions and SELinux label
fi
rm -f "$TMP"
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-operator-seo.php" "$IDX" 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

# Quick check that a casino page still loads
SLUG=$(cd "$APP" && php -r 'require "app/lib/api.php"; echo (string) val("SELECT slug FROM operators ORDER BY slug LIMIT 1");' 2>/dev/null || true)
if [[ -n "$SLUG" ]]; then
  OUT=$(cd "$APP/public" && REQUEST_URI="/casinos/$SLUG" php index.php 2>/dev/null | head -c 400000 || true)
  if ! grep -q 'ld+json' <<<"$OUT" && grep -q "We'll be right back" <<<"$OUT"; then
    cp -a "$BK/public/index.php" "$IDX"; rm -f "$APP/app/ops/zz-operator-seo.php"
    [[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
    echo "A test casino page didn't load, so everything was put back. Nothing was changed."; exit 1
  fi
fi

echo
echo "Done. Casino and sportsbook pages now give search engines their ratings, reviews, operator replies and complaints."
echo "To undo: sudo cp -a $BK/public/index.php $IDX && sudo rm $APP/app/ops/zz-operator-seo.php"
