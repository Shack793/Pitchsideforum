#!/usr/bin/env bash
# Pitchside Forum: posts "Marketplace Rules & Trading Safety" in Marketplace Talk and pins it, adds a link to it at the
# top of the Marketplace page and every marketplace section, and drops "Pitchside Forum – " from pinned topic titles.
#   sudo bash apply.sh
# Running it again won't post a second copy.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi

# 1. Post and pin the rules (as the account that owns the site's storage)
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
WORK=$(mktemp -d); cp post-policy.php policy.txt "$WORK/"; chmod 755 "$WORK"; chmod 644 "$WORK"/*
if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then
  OUT=$(runuser -u "$OWNER" -- php "$WORK/post-policy.php" "$APP" 2>&1); RC=$?
else
  OUT=$(php "$WORK/post-policy.php" "$APP" 2>&1); RC=$?
fi
rm -rf "$WORK"
if [[ $RC -ne 0 ]]; then echo "The rules weren't posted:"; echo "$OUT"; exit 1; fi

# 2. The link on marketplace pages
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "The rules are posted, but a backup couldn't be made, so the marketplace link wasn't added."; exit 1; }
OWN=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" public/assets/market-rules.1.js "$APP/public/assets/market-rules.1.js"
TAG='<script src="/assets/market-rules.1.js"></script>'
if ! grep -q 'market-rules.1.js' "$SHELL_HTML"; then
  if grep -q '/assets/pin-order.1.js' "$SHELL_HTML"; then sed -i "\#/assets/pin-order.1.js#a $TAG" "$SHELL_HTML"
  elif grep -q '/assets/pins-scoped.1.js' "$SHELL_HTML"; then sed -i "\#/assets/pins-scoped.1.js#a $TAG" "$SHELL_HTML"
  else sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; fi
fi
if [[ $(grep -c 'market-rules.1.js' "$SHELL_HTML") -ne 1 ]]; then
  cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/public/assets/market-rules.1.js"
  echo "The rules are posted, but the marketplace link couldn't be added, so that part was put back."; exit 1
fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/market-rules.1.js" "$SHELL_HTML" 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

echo
echo "Done."
echo "$OUT" | awk '/^(POSTED|ALREADY)/{id=$2; $1=""; $2=""; sub(/^ +/,""); print "  Marketplace rules pinned in " $0 ": /topic/" id}'
echo "  The Marketplace page and every marketplace section now link to the rules."
R=$(echo "$OUT" | grep -c '^RENAMED' || true)
if [[ "$R" -gt 0 ]]; then echo "$OUT" | awk '/^RENAMED/{$1=""; $2=""; sub(/^ +/,""); print "  Renamed: " $0}'; else echo "  No pinned titles started with \"Pitchside Forum –\", so none needed renaming."; fi
