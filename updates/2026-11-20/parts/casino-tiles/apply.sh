#!/usr/bin/env bash
# Pitchside Forum: casino tiles line up. On the Casinos & Sportsbooks page, the Play button on tiles with an affiliate
# link sits level with the Read review button on the other tiles, with an easy-to-read "Read review" link and
# "18+ · T&Cs apply" underneath.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" || ! -d "$APP/public/assets" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if ! grep -qE '/assets/casino-list\.[456]\.js' "$SHELL_HTML"; then echo "This site doesn't use the casino tiles, so nothing was changed."; exit 0; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/casino-list.6.js "$APP/public/assets/casino-list.6.js"
sed -i -E 's#/assets/casino-list\.[45]\.js#/assets/casino-list.6.js#' "$SHELL_HTML"
if [[ $(grep -c 'casino-list.6.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't switch the page script. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/public/assets/casino-list.6.js" "$SHELL_HTML" 2>/dev/null || true
echo "Done. Play and Read review buttons line up on the casino tiles, and Read review is easy to read."
