#!/usr/bin/env bash
# Pitchside Forum: moves the $1,000 raffle draw to 31 December 2026 (midnight, Los Angeles time).
# Works whether the draw is currently 1 December or 24 December. No files are changed.
#   sudo bash apply.sh
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp move-draw.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/move-draw.php" "$APP" 2>&1); RC=$?
rm -rf "$WORK"
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
if [[ $RC -eq 2 ]]; then echo "The raffle isn't installed on this site yet, so there was nothing to move. Install the latest pitchside-update.zip first."; exit 1; fi
if grep -q '^ALREADY' <<<"$OUT"; then echo "Done already: the draw is set for 31 December."; exit 0; fi
if [[ $RC -eq 3 ]]; then echo "Couldn't find a raffle drawing on 1 or 24 December, so nothing was changed. Send me a screenshot of the raffle page and I'll sort it."; exit 1; fi
if [[ $RC -ne 0 ]]; then echo "The draw date wasn't changed:"; echo "$OUT" | tail -5; exit 1; fi
N=$(awk '/^MOVED/{print $3; exit}' <<<"$OUT"); T=$(awk '/^TEXTS/{print $2}' <<<"$OUT")
echo
echo "Done. The raffle now draws on 31 December 2026 at midnight (Los Angeles time)."
[[ "$N" =~ ^[0-9]+$ ]] && echo "Entries so far: $N."
[[ "${T:-0}" -gt 0 ]] && echo "The date was also updated in $T place(s) of site text that mention the raffle."
echo "Reload the raffle page with Ctrl+F5 (Cmd+Shift+R on a Mac) to see it."
