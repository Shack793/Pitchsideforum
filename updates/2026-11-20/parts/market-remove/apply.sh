#!/usr/bin/env bash
# Pitchside Forum: removes the Marketplace (and its escrow) from the site. The menu link goes, the section shows
# nothing, nobody can post in the Marketplace boards and only admins can still see old posts there. Nothing is deleted.
# Also takes out the marketplace and escrow scripts added on 20 Nov (market-open.1.js, escrow.1.js, zz-escrow.php).
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app/ops" "$BK/public/assets" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
for f in app/ops/zz-escrow.php public/assets/market-open.1.js public/assets/escrow.1.js; do [[ -f "$APP/$f" ]] && cp -a "$APP/$f" "$BK/$f"; done
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "Couldn't remove the Marketplace: $(echo "$OUT" | tail -1). Nothing was changed."; exit 1; }
sed -i '/<script src="\/assets\/market-open\.1\.js"><\/script>/d; /<script src="\/assets\/escrow\.1\.js"><\/script>/d' "$SHELL_HTML"
rm -f "$APP/app/ops/zz-escrow.php" "$APP/public/assets/market-open.1.js" "$APP/public/assets/escrow.1.js"
# home page "Boards" box: hide a section heading that has no boards left (the Marketplace)
if ! grep -q 'id="ps-empty-sec"' "$SHELL_HTML" && grep -q '</head>' "$SHELL_HTML"; then
  CSS='<style id="ps-empty-sec">section.panel > div:has(> strong + div.meta:empty){display:none}</style>'
  awk -v c="$CSS" '!d && index($0,"</head>"){sub(/<\/head>/, c "\n</head>"); d=1} {print}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
fi
command -v restorecon >/dev/null 2>&1 && restorecon "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. The Marketplace has been removed from the site ($(awk '/^REMOVED/{sub(/^REMOVED /,""); print}' <<<"$OUT"))."
