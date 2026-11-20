#!/usr/bin/env bash
# Pitchside Forum: faster first view. The grey "loading" placeholder at the top of the page used to stay until every
# add-on script had loaded (a few seconds on a slow connection), sitting on top of a page that was already showing.
# Now it disappears as soon as the page itself is drawn. One small line in app/shell.html, right after the main app script.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if grep -q 'id="ps-early-ready"' "$SHELL_HTML"; then echo "Done. (Already installed.)"; exit 0; fi
APPJS=$(grep -oE '<script src="/assets/app\.[0-9a-f]+\.js"></script>' "$SHELL_HTML" | head -1)
if [[ -z "$APPJS" ]]; then echo "Couldn't find the main app script in shell.html. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
LINE='<script id="ps-early-ready">(function(){var d=document.documentElement,v=document.getElementById("view");function ok(){if(v&&!v.querySelector(".ssr-copy")&&v.children.length){d.classList.add("ps-ready");return true}return false}if(!ok()&&v&&window.MutationObserver){var m=new MutationObserver(function(){if(ok())m.disconnect()});m.observe(v,{childList:true});}})();</script>'
ESC_APPJS=$(printf '%s' "$APPJS" | sed 's/[.[\*^$/]/\\&/g')
awk -v a="$APPJS" -v l="$LINE" '{print} index($0,a){print l}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
if [[ $(grep -c 'id="ps-early-ready"' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't add the line. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
echo "Done. The loading placeholder now disappears as soon as the page is drawn."
