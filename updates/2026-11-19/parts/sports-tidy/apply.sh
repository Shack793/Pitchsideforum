#!/usr/bin/env bash
# Pitchside Forum: simpler Sports section.
#  - "FIFA World Cup" becomes "International" (league and board; same address)
#  - league pages lose the Teams and Betting tabs; team pages lose Betting; match pages lose the Betting box
#  - football has no team pages: one section per league (old club links go to the league)
#  - the prediction leaderboard no longer shows sample member names
#  Files: public/assets/sports-tidy.1.js, app/ops/zz-sports-tidy.php (new); app/shell.html loads the script;
#  public/sitemap.php leaves football clubs out.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"; SMAP="$APP/public/sitemap.php"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]] || ! grep -q '</body>' "$SHELL_HTML"; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-sports-tidy.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" "$BK/public" && cp -a "$SHELL_HTML" "$BK/app/shell.html" && { [[ ! -f "$SMAP" ]] || cp -a "$SMAP" "$BK/public/sitemap.php"; } || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
undo() { cp -a "$BK/app/shell.html" "$SHELL_HTML"; [[ -f "$BK/public/sitemap.php" ]] && cp -a "$BK/public/sitemap.php" "$SMAP"; rm -f "$APP/app/ops/zz-sports-tidy.php" "$APP/public/assets/sports-tidy.1.js"; }
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-sports-tidy.php "$APP/app/ops/zz-sports-tidy.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/sports-tidy.1.js "$APP/public/assets/sports-tidy.1.js"
grep -q 'sports-tidy.1.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/sports-tidy.1.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'sports-tidy.1.js' "$SHELL_HTML") -ne 1 ]]; then undo; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
if [[ -f "$SMAP" ]] && ! grep -q 'sports_team_listed' "$SMAP"; then
  sed -i "s#foreach (doc('TEAMS') as \$t) echo#foreach (doc('TEAMS') as \$t) if (!function_exists('sports_team_listed') || sports_team_listed(\$t)) echo#" "$SMAP"
  php -l "$SMAP" >/dev/null 2>&1 || { undo; echo "Couldn't update the sitemap. Nothing was changed."; exit 1; }
fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { undo; echo "Couldn't rename the World Cup section: $(echo "$OUT" | tail -1). Nothing was changed."; exit 1; }
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-sports-tidy.php" "$APP/public/assets/sports-tidy.1.js" "$SHELL_HTML" "$SMAP" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. Sports section simplified: International instead of FIFA World Cup, no betting tabs, football by league only."
