#!/usr/bin/env bash
# Pitchside Forum: Safety Index weights. Licence counts 15% and member reviews 25%; the rest stay the same.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp set-weights.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/set-weights.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
if [[ $RC -ne 0 ]]; then echo "The weights weren't changed: $(echo "$OUT" | tail -1)"; exit 1; fi
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. $(awk '/^WEIGHTS/{sub(/^WEIGHTS /,""); print}' <<<"$OUT")."
