#!/usr/bin/env bash
# Pitchside Forum: ad pictures stay hidden until they have fully downloaded, so the browser's "broken picture" icon
# and the lone "Sponsored" label no longer show in an empty box while a banner loads. The plain dark box shows
# instead, then the banner fades in. Adds a few style lines and a tiny script to app/shell.html only.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" ]] || ! grep -q '</head>' "$SHELL_HTML"; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if grep -q 'id="ps-ad-ld"' "$SHELL_HTML"; then echo "Done. (Already installed.)"; exit 0; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
CSS='<style id="ps-ad-ld">picture.fb-pic{display:block;background:#13202c}picture.fb-pic img{opacity:0;transition:opacity .3s}picture.fb-pic img.fb-in{opacity:1}picture.fb-pic:not(:has(img.fb-in))+.fb-label{visibility:hidden}</style><script id="ps-ad-ld-js">(function(){function m(i){if(!i||i.tagName!=="IMG"||!i.closest||!i.closest("picture.fb-pic"))return;if(i.getAttribute("src")?i.complete?i.naturalWidth:0:0)i.classList.add("fb-in")}document.addEventListener("load",function(e){m(e.target)},true);setInterval(function(){document.querySelectorAll("picture.fb-pic img:not(.fb-in)").forEach(m)},700)})();</script>'
awk -v c="$CSS" '!d && index($0,"</head>"){sub(/<\/head>/, c "\n</head>"); d=1} {print}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
if [[ $(grep -c 'id="ps-ad-ld"' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't add the style lines. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
echo "Done. Ad banners stay as a plain dark box until they have loaded, then fade in."
