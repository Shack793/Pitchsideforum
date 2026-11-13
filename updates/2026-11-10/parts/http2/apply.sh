#!/usr/bin/env bash
# Pitchside Forum: switch the web server to HTTP/2. Browsers then fetch the page and its ~36 scripts over one
# connection at the same time instead of a few at a time, so pages finish loading sooner, especially far away.
# Only changes the "listen 443 ssl" lines of the site's nginx settings. Checks the settings before applying and puts
# everything back if anything is wrong. Safe to run twice.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
command -v nginx >/dev/null || { echo "Couldn't find nginx. Nothing was changed."; exit 1; }
FILES=$(grep -rlE 'server_name[^;]*pitchsideforum\.com' /etc/nginx 2>/dev/null | grep -vE '\.(bak|orig)|~$' | xargs -r grep -lE '^\s*listen\s+(\[::\]:)?443\s' 2>/dev/null)
if [[ -z "$FILES" ]]; then echo "Couldn't find the site's secure (https) settings in /etc/nginx. Nothing was changed."; exit 1; fi
if ! grep -qE '^\s*listen\s+(\[::\]:)?443\s+ssl\b(\s+[a-z_=0-9]+)*\s*;' $FILES; then echo "The https lines look different from expected. Nothing was changed."; exit 1; fi
if grep -qE '^\s*listen\s+(\[::\]:)?443\s.*\bhttp2\b|^\s*http2\s+on\s*;' $FILES; then echo "Done. (HTTP/2 is already on.)"; exit 0; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/nginx-$STAMP-$$"; mkdir -p "$BK"
for f in $FILES; do cp -a "$f" "$BK/$(echo "$f" | tr / _)" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }; done
restore() { for f in $FILES; do cp -a "$BK/$(echo "$f" | tr / _)" "$f"; done; }
for f in $FILES; do sed -i -E 's/^(\s*listen\s+(\[::\]:)?443\s+ssl)\b/\1 http2/' "$f"; done
if ! nginx -t >/dev/null 2>&1; then restore; echo "The web server didn't accept the change, so it was put back. Nothing was changed."; nginx -t 2>&1 | tail -3; exit 1; fi
if ! systemctl reload nginx; then restore; nginx -t >/dev/null 2>&1 && systemctl reload nginx; echo "Couldn't reload the web server, so the change was put back."; exit 1; fi
sleep 1
if command -v curl >/dev/null; then
  V=$(curl -s -o /dev/null --http2 -w '%{http_version}' https://pitchsideforum.com/ 2>/dev/null || true)
  [[ -n "$V" ]] && echo "Check: the site now answers with HTTP/$V."
fi
echo "Done. HTTP/2 is on. (Backup of the old settings: $BK)"
