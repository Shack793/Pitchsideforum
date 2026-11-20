#!/usr/bin/env bash
# Pitchside Forum: SEO check-up.
#  - pages that don't exist (unknown addresses, leagues, teams, tags, closed boards and sections) answer 404 + noindex
#    instead of an indexable copy of the homepage (app/ops/zz-page-status.php, new)
#  - proper search titles and descriptions for /sports, /crypto, /gambling, /community, /forum, /blacklist, the info
#    pages and the tag pages (added in Admin → SEO only where missing, so you can edit them there)
#  - one address per page: casinos/sportsbooks at the address the site links to, /teams and /leagues -> /sports,
#    /reviews -> /gambling, no trailing "/" copies (app/ops/zz-seo-urls.php, new)
#  - sports league pages no longer say "betting tips" in their description (app/ops/zz-seo.php, one phrase)
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$APP/app/lib/api.php" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-page-status.php >/dev/null 2>&1 && php -l app/ops/zz-seo-urls.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"; mkdir -p "$BK/app/ops" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
SEO="$APP/app/ops/zz-seo.php"; [[ -f "$SEO" ]] && cp -a "$SEO" "$BK/app/ops/zz-seo.php"
OWN=$(stat -c '%U:%G' "$APP/app/ops")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-page-status.php "$APP/app/ops/zz-page-status.php"
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-seo-urls.php "$APP/app/ops/zz-seo-urls.php"
if [[ -f "$SEO" ]] && grep -q 'predictions, betting tips and fan talk' "$SEO"; then
  sed -i 's/predictions, betting tips and fan talk/predictions and fan talk/' "$SEO"
  php -l "$SEO" >/dev/null 2>&1 || { cp -a "$BK/app/ops/zz-seo.php" "$SEO"; rm -f "$APP/app/ops/zz-page-status.php" "$APP/app/ops/zz-seo-urls.php"; echo "Couldn't update the SEO file. Nothing was changed."; exit 1; }
fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { echo "Installed, but the page titles couldn't be added: $(echo "$OUT" | tail -1)"; exit 1; }
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-page-status.php" "$APP/app/ops/zz-seo-urls.php" "$SEO" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
echo "Done. SEO check-up installed ($(awk '/^SEO/{sub(/^SEO /,""); print}' <<<"$OUT"))."
