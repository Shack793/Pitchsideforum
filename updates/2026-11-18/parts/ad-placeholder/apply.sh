#!/usr/bin/env bash
# Pitchside Forum: ad pictures keep their space while they load. The side ad, the homepage banner and the ad under
# the first post reserve the banner's full size straight away (a plain dark box), so nothing jumps and the side
# slot's rotation dots stay under the banner. Adds a few style lines to app/shell.html only.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" ]] || ! grep -q '</head>' "$SHELL_HTML"; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if grep -q 'id="ps-ad-ph"' "$SHELL_HTML"; then echo "Done. (Already installed.)"; exit 0; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
CSS='<style id="ps-ad-ph">picture.fb-pic img{background:#13202c}picture.fb-pic.fb-side img{aspect-ratio:auto 1/3}picture.fb-pic.fb-post img{aspect-ratio:auto 16/1}picture.fb-pic.fb-home img{aspect-ratio:auto 2340/164}@media (max-width:640px){picture.fb-pic.fb-post img{aspect-ratio:auto 32/5}picture.fb-pic.fb-home img{aspect-ratio:auto 716/252}}</style>'
awk -v c="$CSS" '!d && index($0,"</head>"){sub(/<\/head>/, c "\n</head>"); d=1} {print}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
if [[ $(grep -c 'id="ps-ad-ph"' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't add the style lines. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
echo "Done. Ad pictures keep their space while they load."
