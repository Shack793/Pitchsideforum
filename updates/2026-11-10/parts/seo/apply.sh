#!/usr/bin/env bash
# Pitchside Forum: search engine boost (reviews first). Opens the site to search engines, lets crawlers past the 18+
# check, adds rating and forum data to pages, and reports new reviews and topics to Bing and Yandex (IndexNow).
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; IDX="$APP/public/index.php"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$IDX" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-seo.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/public" "$BK/app" && cp -a "$IDX" "$BK/public/index.php" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
undo() { cp -a "$BK/public/index.php" "$IDX"; cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-seo.php" "$APP/public/assets/seo.1.js"; echo "$1 Everything was put back; nothing was changed."; exit 1; }

TMP=$(mktemp); RES=$(php patch-index.php "$IDX" "$TMP"); RC=$?
if [[ $RC -eq 2 ]]; then rm -f "$TMP"; echo "Your page code isn't laid out as expected, so nothing was changed. Send me public/index.php and I'll fit it."; exit 1; fi
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-seo.php "$APP/app/ops/zz-seo.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/seo.1.js "$APP/public/assets/seo.1.js"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/share.1.png "$APP/public/assets/share.1.png"
mkdir -p "$APP/app/fonts" && for f in app/fonts/*; do install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" "$f" "$APP/app/fonts/$(basename "$f")"; done
# preview pictures need PHP's image module (GD); add it if it's missing (the standard picture is used meanwhile)
if ! php -m 2>/dev/null | grep -qi '^gd$'; then (command -v dnf >/dev/null && dnf -y -q install php-gd >/dev/null 2>&1) || (command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get -y -qq install php-gd >/dev/null 2>&1) || true; fi
if [[ "$RES" == PATCHED* ]]; then php -l "$TMP" >/dev/null 2>&1 || { rm -f "$TMP"; undo "The updated page code didn't pass a check."; }; cat "$TMP" > "$IDX"; fi
rm -f "$TMP"
TAG='<script src="/assets/seo.1.js"></script>'
if ! grep -q 'seo.1.js' "$SHELL_HTML"; then sed -i "s#</body>#$TAG\n</body>#" "$SHELL_HTML"; fi
[[ $(grep -c 'seo.1.js' "$SHELL_HTML") -eq 1 ]] || undo "The page script couldn't be added."

# Open the site to search engines, and set up the IndexNow key file
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
KEY=$(cd "$APP" && "${RUN[@]}" -r 'require "app/lib/api.php";
  $s = doc("SETTINGS"); $was = !empty($s["siteIndexing"]); if (!$was) { $s["siteIndexing"] = true; save_doc("SETTINGS", $s); audit(null, "Search engine indexing", "site", "Switched on by the SEO update", "off", "on"); }
  $k = (string) (meta_get("seo:indexnow", "") ?? ""); if (!preg_match("/^[a-f0-9]{32}$/", $k)) { $k = bin2hex(random_bytes(16)); meta_set("seo:indexnow", $k); }
  echo ($was ? "WAS " : "NOW "), $k;' 2>&1 | tail -1)
K=${KEY#* }
if [[ "$K" =~ ^[a-f0-9]{32}$ ]]; then printf '%s' "$K" > "$APP/public/$K.txt"; chown "${OWNA%%:*}:${OWNA##*:}" "$APP/public/$K.txt"; chmod 644 "$APP/public/$K.txt"; fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-seo.php" "$APP/public/assets/seo.1.js" "$IDX" "$SHELL_HTML" "$APP/public/"*.txt "$APP/public/assets/share.1.png" 2>/dev/null; command -v restorecon >/dev/null 2>&1 && restorecon -R "$APP/app/fonts" 2>/dev/null || true

# the standard picture with your own web address on it
(cd "$APP" && "${RUN[@]}" -r 'require "app/lib/api.php"; if (seo_share_ok()) { seo_share_draw(null, APP_DIR . "/storage/cache/share-default.png"); }' >/dev/null 2>&1) && [[ -f "$APP/app/storage/cache/share-default.png" ]] && cp "$APP/app/storage/cache/share-default.png" "$APP/public/assets/share.1.png" && chown "${OWNA%%:*}:${OWNA##*:}" "$APP/public/assets/share.1.png" || true
CHECK=$(cd "$APP/public" && REQUEST_URI=/casinos php index.php 2>/dev/null | head -c 300000 || true)
grep -q "We'll be right back" <<<"$CHECK" && undo "A test page didn't load."
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
[[ "$KEY" == NOW* ]] && echo "Search engines were blocked from the whole site; they're now allowed in."
echo "Done. Search engine boost installed."
