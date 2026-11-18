#!/usr/bin/env bash
# Pitchside Forum: casino logos. Adds the trimmed, centred logos in logos/ to their casinos' listings.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
mkdir -p "$APP/public/uploads/media" && chown "$(stat -c '%U:%G' "$APP/public/uploads")" "$APP/public/uploads/media" 2>/dev/null || true
WORK=$(mktemp -d); cp -r setup.php logos names.json "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" "$WORK/logos" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "The logos couldn't be added: $(echo "$OUT" | tail -1)"; exit 1; }
command -v restorecon >/dev/null 2>&1 && restorecon -R "$APP/public/uploads/media" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
L=$(awk '/^LOGOS/{sub(/^LOGOS /,""); print}' <<<"$OUT"); M=$(awk '/^MISSING/{sub(/^MISSING /,""); print}' <<<"$OUT")
R=$(awk '/^RENAMED/{sub(/^RENAMED /,""); print}' <<<"$OUT")
echo "Done. New logos: $L.$([[ "$R" != "-" ]] && echo " Renamed: $R.")$([[ "$M" != "-" ]] && echo " Not in the directory, skipped: $M.")"
