#!/usr/bin/env bash
# Pitchside Forum: lighter pages, so every page opens faster. Each page used to carry the full text of every post from
# the last six months, and every detail of all 281 casinos, before it could show anything. Now:
#  - long posts arrive as a short preview; a topic's full posts load when it's opened
#  - pages outside the gambling section get casinos without their long details; those load in the background, and the
#    gambling pages wait for them. Counts, likes, names, logos and scores stay complete. Staff still get everything.
# Files:
#  - app/ops/zz-boot-trim.php, public/assets/lighter-pages.2.js (replaces lighter-pages.1.js if it's there)
#  - public/index.php: two lines (one calls the trim, one makes sure an opened topic is always sent in full)
#  - app/shell.html: loads lighter-pages.2.js, plus a one-line script just before the app that fills in the casino
#    details' empty places until they arrive
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"; IDX="$APP/public/index.php"
if [[ ! -f "$SHELL_HTML" || ! -f "$IDX" || ! -d "$APP/app/ops" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
command -v php >/dev/null || { echo "PHP isn't available on the command line. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" "$BK/public" && cp -a "$SHELL_HTML" "$BK/app/shell.html" && cp -a "$IDX" "$BK/public/index.php" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
undo() { cp -a "$BK/app/shell.html" "$SHELL_HTML"; cp -a "$BK/public/index.php" "$IDX"; rm -f "$APP/app/ops/zz-boot-trim.php"; echo "$1 Nothing was changed."; exit 1; }
R=$(php patch-index.php "$IDX"); [[ "$R" == OK || "$R" == ALREADY ]] || undo "Couldn't find the right place in index.php."
php -l "$IDX" >/dev/null 2>&1 || undo "index.php check failed."
OWNA=$(stat -c '%U:%G' "$APP/public/assets"); OWNO=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWNO%%:*}" -g "${OWNO##*:}" app/ops/zz-boot-trim.php "$APP/app/ops/zz-boot-trim.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/lighter-pages.2.js "$APP/public/assets/lighter-pages.2.js"
sed -i 's#/assets/lighter-pages\.1\.js#/assets/lighter-pages.2.js#' "$SHELL_HTML"
if ! grep -q 'lighter-pages.2.js' "$SHELL_HTML"; then
  LAST=$(grep -oE '<script src="/assets/[^"]+"></script>' "$SHELL_HTML" | tail -1)
  [[ -n "$LAST" ]] || undo "Couldn't find the page scripts in shell.html."
  awk -v a="$LAST" '{print} !d && index($0,a){print "<script src=\"/assets/lighter-pages.2.js\"></script>"; d=1}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
  [[ $(grep -c 'lighter-pages.2.js' "$SHELL_HTML") -eq 1 ]] || undo "Couldn't add the page script."
fi
if ! grep -q 'id="ps-op-fill"' "$SHELL_HTML"; then
  APPJS=$(grep -oE '<script src="/assets/app\.[0-9a-f]+\.js"></script>' "$SHELL_HTML" | head -1)
  [[ -n "$APPJS" ]] || undo "Couldn't find the app script in shell.html."
  FILL=$(cat op-fill.html)
  awk -v a="$APPJS" -v f="$FILL" '!d && index($0,a){print f; d=1} {print}' "$SHELL_HTML" > "$SHELL_HTML.new" && cat "$SHELL_HTML.new" > "$SHELL_HTML" && rm -f "$SHELL_HTML.new"
  [[ $(grep -c 'id="ps-op-fill"' "$SHELL_HTML") -eq 1 ]] || undo "Couldn't add the casino fill-in line."
fi
rm -f "$APP/app/storage/cache/boot-guest.json" 2>/dev/null || true
command -v restorecon >/dev/null 2>&1 && restorecon "$IDX" "$SHELL_HTML" "$APP/app/ops/zz-boot-trim.php" "$APP/public/assets/lighter-pages.2.js" 2>/dev/null || true
echo "Done. Pages are lighter and open faster."
