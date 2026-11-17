#!/usr/bin/env bash
# Pitchside Forum: Crypto.Games animated banners in the right-hand side slot and under the first post, next to 1xBet.
# Link: https://crypto.games/ . Change it any time in Admin → Ads & affiliates.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp -r setup.php images "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" "$WORK/images" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "The banners couldn't be added: $(echo "$OUT" | tail -1)"; exit 1; }
command -v restorecon >/dev/null 2>&1 && restorecon -R "$APP/public/uploads/media" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. Crypto.Games banners: $(awk '/^ADS/{sub(/^ADS /,""); print}' <<<"$OUT")."
