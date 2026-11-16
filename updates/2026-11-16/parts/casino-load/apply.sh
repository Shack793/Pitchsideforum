#!/usr/bin/env bash
# Pitchside Forum: Casinos & Sportsbooks pages open cleanly. On a slow connection these pages used to show half-built
# versions while the add-on scripts loaded (old list, "Hybrid" filter, "NaN" scores). Now:
#  - Casinos, Sportsbooks, Gambling, Complaints and Blacklist pages keep the grey loading placeholder until everything
#    has loaded, then show the finished page.
#  - A Safety Index can never show as "NaN" anywhere on the site, even for a moment.
# Changes app/shell.html only (two small scripts and a few style lines).
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
if grep -q 'id="ps-hold"' "$SHELL_HTML"; then echo "Done. (Already installed.)"; exit 0; fi
APPJS=$(grep -oE '<script src="/assets/app\.[0-9a-f]+\.js"></script>' "$SHELL_HTML" | head -1)
if [[ -z "$APPJS" ]] || ! grep -q '</body>' "$SHELL_HTML" || ! grep -q '</style>' "$SHELL_HTML"; then echo "Couldn't find the right places in shell.html. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
CSS=$(cat hold.css); HOLD=$(cat hold.html); REL='<script id="ps-hold-release">document.documentElement.classList.remove("ps-hold");</script>'
# after the early-ready line if there is one, otherwise right after the app script
if grep -q 'id="ps-early-ready"' "$SHELL_HTML"; then AFTER='id="ps-early-ready"'; else AFTER="$APPJS"; fi
awk -v a="$AFTER" -v h="$HOLD" -v c="$CSS" -v r="$REL" '
  !cs && index($0,"</style>"){sub(/<\/style>/, c "\n</style>"); cs=1}
  index($0,"</body>") && !rl {sub(/<\/body>/, r "\n</body>"); rl=1}
  {print}
  !hd && index($0,a){print h; hd=1}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
if [[ $(grep -c 'id="ps-hold"' "$SHELL_HTML") -ne 1 || $(grep -c 'id="ps-hold-release"' "$SHELL_HTML") -ne 1 || $(grep -c 'ps-hold #view' "$SHELL_HTML") -lt 1 ]]; then
  cp -a "$BK/app/shell.html" "$SHELL_HTML"; echo "Couldn't add the lines. Nothing was changed."; exit 1; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
echo "Done. Casinos & Sportsbooks pages now open fully built, with no NaN scores."
