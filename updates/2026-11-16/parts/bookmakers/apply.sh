#!/usr/bin/env bash
# Pitchside Forum: adds well-known bookmakers to the directory (facts checked November 2026). Any that are already
# listed (same short name, name or website) are left exactly as they are.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php listings.json "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" "$WORK/listings.json" 2>&1); RC=$?
rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "The bookmakers couldn't be saved: $(echo "$OUT" | tail -1)"; exit 1; }
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
A=$(awk '/^ADDED/{sub(/^ADDED /,""); print}' <<<"$OUT"); S=$(awk '/^SKIPPED/{sub(/^SKIPPED /,""); print}' <<<"$OUT")
echo "Done. Added: $A.$([[ "$S" != "-" ]] && echo " Already listed, left unchanged: $S.")"
