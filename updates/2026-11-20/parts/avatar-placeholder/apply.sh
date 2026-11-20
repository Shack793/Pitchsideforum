#!/usr/bin/env bash
# Pitchside Forum: no more empty circle while a member's picture loads. The avatar circle shows a soft person outline
# straight away, until the picture arrives. Adds a few style lines to app/shell.html only.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" ]] || ! grep -q '</head>' "$SHELL_HTML"; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if grep -q 'id="ps-avatar-ph"' "$SHELL_HTML"; then echo "Done. (Already installed.)"; exit 0; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
CSS='<style id="ps-avatar-ph">img.avatar{background:#DCE7F2 url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Ccircle cx=%2712%27 cy=%279%27 r=%274.2%27 fill=%27%2398AEC4%27/%3E%3Cpath d=%27M3.5 21.5c1.4-4.2 4.6-6.3 8.5-6.3s7.1 2.1 8.5 6.3%27 fill=%27%2398AEC4%27/%3E%3C/svg%3E") center/70% no-repeat;color:transparent}</style>'
awk -v c="$CSS" '!d && index($0,"</head>"){sub(/<\/head>/, c "\n</head>"); d=1} {print}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
if [[ $(grep -c 'id="ps-avatar-ph"' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't add the style lines. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
echo "Done. Avatars show an outline while the picture loads."
