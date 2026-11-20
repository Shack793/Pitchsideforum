#!/usr/bin/env bash
# Pitchside Forum: posts the Casino & Sportsbook Review Guidelines in Casino Reviews and Sportsbook Reviews and pins them.
#   sudo bash apply.sh
# No site files are changed. Running it again won't post a second copy.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi

# Run as the account that owns the site's storage, like the site itself
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
WORK=$(mktemp -d); cp post-policy.php policy.txt "$WORK/"; chmod 755 "$WORK"; chmod 644 "$WORK"/*
if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then
  OUT=$(runuser -u "$OWNER" -- php "$WORK/post-policy.php" "$APP" 2>&1); RC=$?
else
  OUT=$(php "$WORK/post-policy.php" "$APP" 2>&1); RC=$?
fi
rm -rf "$WORK"
if [[ $RC -ne 0 ]]; then echo "The guidelines weren't posted:"; echo "$OUT"; exit 1; fi
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true

echo
echo "Done. The review guidelines are pinned:"
echo "$OUT" | awk '/^(POSTED|ALREADY)/{id=$2; $1=""; $2=""; sub(/^ +/,""); print "  " $0 ": /topic/" id}'
echo "$OUT" | awk '/^MISSING/{$1=""; sub(/^ +/,""); print "  (" $0 " board not found, skipped)"}'
