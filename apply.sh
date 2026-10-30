#!/usr/bin/env bash
# Pitchside Forum update: LiveScoreNow colours, Live Scores links and homepage button, Promotions & bonuses page,
# green favicon matching the logo, banner rotation switch, steadier side ad, smaller online counter, topic stats switches,
# no flash of the plain search-engine copy when a page opens, weekly raffle page (adds two database tables),
# Change a username (Admin → Users, Super Admins only), forum rep counts likes received,
# ranks follow visible posts only, rank editor and special ranks (e.g. Donor) in Admin → Forum,
# casino listings: Casino / Casino & Sportsbook / Sportsbook, logos and listing images,
# 10 researched casino listings (1xBet, BC.GAME, BetUS, BetWinner, Cloudbet, Duelbits, Gamdom, Jackbit, MyStake, Pinnacle),
# pictures in posts from image links (nothing stored on the server),
# header menu under your name with Settings, YouTube/Vimeo videos in posts, formatting toolbar in the post box,
# designed sign-up confirmation email, a Competition logos box in Admin → Sports, bigger casino logos (wide logos keep their shape),
# and a cleaner Casinos & Sportsbooks list: 2 Top picks first (Pinnacle and Jackbit featured to start), then tidy cards, 2 per row,
# with a "Play now" button on casinos that have an affiliate link; on phones Sign in / Join sit beside the logo, above the search bar;
# every page checked to fit all screens (phones from 280px wide, iPads, desktops to 2560px); footer always at the bottom of the screen;
# homepage banners: edits and images now save and show (on phones too), and Admin → Ads shows which banner is on the homepage;
# 41 more researched casino listings (Roobet, Stake, Bovada, SunBet and more), added once;
# casino list as small tiles: up to 6 across on big screens, rows you swipe sideways on phones;
# ads can use a full banner image that fills the homepage, side or in-post ad space;
# New topic form: pick a section first, and the board list only shows that section's boards.
# Run on the server from inside this folder:   sudo bash apply.sh
# Copies the changed files into the live site (keeping a backup), then updates the database settings.
# Your database, posts, uploads, settings file and AI chatbots are not touched.
# admins can delete a complaint (button at the bottom of each complaint page; reason goes in the Audit log and to the member).
# fixed ad pictures: side and in-post ads take any picture (shrunk automatically), upload limits and folder permissions checked,
# Write / Preview tabs on every post box, so members can see how a post or reply will look before posting.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo or as root."; exit 1; fi
cd "$(dirname "$0")"
APP=/var/www/pitchside
if [[ ! -f "$APP/app/config.php" ]]; then echo "Can't find the site at $APP (no app/config.php). Nothing was changed."; exit 1; fi
WEB=$(id -u nginx >/dev/null 2>&1 && echo nginx || echo www-data)
FILES="app/shell.html app/cron.php app/install.php app/seed/docs.json app/lib/docs.php public/go.php public/index.php public/sitemap.php public/assets/scores-links.2.js public/assets/promotions.3.js public/assets/ads-tweaks.2.js public/assets/topic-stats.2.js public/assets/raffle.2.js app/schema.sql app/ops/raffle.php app/ops/rename.php public/assets/user-rename.1.js app/ops/rep.php app/ops/forum.php app/ops/mod.php public/assets/rep.1.js public/assets/ranks.1.js public/assets/special-ranks.1.js public/assets/operators.4.js public/assets/post-images.1.js app/ops/gambling.php app/seed/operators-2026-10.json app/ops/specialrank.php public/favicon.svg public/favicon.ico public/apple-touch-icon.png public/icon-512.png app/lib/mail.php app/lib/auth.php public/assets/header.1.js public/assets/post-media.1.js public/assets/competitions.1.js public/assets/casino-list.4.js app/seed/operators-2026-10b.json public/assets/full-banners.1.js public/assets/new-topic.1.js app/ops/complaint-delete.php public/assets/complaint-delete.1.js public/assets/post-preview.1.js public/assets/ads-images.1.js"
STAMP=$(date +%Y%m%d-%H%M%S); BK=/var/backups/pitchside/update-$STAMP
for f in $FILES; do if [[ -f "$APP/$f" ]]; then mkdir -p "$BK/$(dirname $f)"; cp -a "$APP/$f" "$BK/$f"; fi; done
echo "==> Backup of the old files: $BK"
for f in $FILES; do mkdir -p "$APP/$(dirname "$f")"; install -m 644 "$f" "$APP/$f"; chown "$WEB" "$APP/$f" 2>/dev/null || true; done
command -v restorecon >/dev/null 2>&1 && restorecon -R "$APP/app" "$APP/public" >/dev/null 2>&1 || true
# Picture uploads: the site must be able to write to its uploads and storage folders (SELinux on AlmaLinux too)
mkdir -p "$APP/public/uploads/media" "$APP/app/storage"
chown -R "$WEB" "$APP/public/uploads" "$APP/app/storage" 2>/dev/null || true
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null)" != "Disabled" ]]; then
  for d in "$APP/public/uploads" "$APP/app/storage"; do
    if command -v semanage >/dev/null 2>&1; then semanage fcontext -a -t httpd_sys_rw_content_t "$d(/.*)?" 2>/dev/null || semanage fcontext -m -t httpd_sys_rw_content_t "$d(/.*)?" 2>/dev/null || true; restorecon -R "$d" >/dev/null 2>&1 || true; fi
    chcon -R -t httpd_sys_rw_content_t "$d" 2>/dev/null || true
  done
fi
# Upload size limits: ad and banner pictures can be a few MB. Only raised where they're lower.
to_mb() { local v="${1:-0}"; v="${v// /}"; case "${v: -1}" in [Gg]) echo $(( ${v%?} * 1024 ));; [Mm]) echo "${v%?}";; [Kk]) echo $(( ${v%?} / 1024 ));; *) echo $(( ${v:-0} / 1048576 ));; esac; }
FPM=$(systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -o 'php[0-9.]*-fpm\.service' | head -1 || true)
if command -v php >/dev/null 2>&1; then
  PMAX=$(php -r 'echo ini_get("post_max_size");' 2>/dev/null); UMAX=$(php -r 'echo ini_get("upload_max_filesize");' 2>/dev/null)
  if [[ $(to_mb "$PMAX") -lt 14 || $(to_mb "$UMAX") -lt 12 ]]; then
    PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
    if [[ -d /etc/php.d ]]; then INI=/etc/php.d/99-pitchside-uploads.ini; else INI=/etc/php/$PHPV/fpm/conf.d/99-pitchside-uploads.ini; fi
    if [[ -d "$(dirname "$INI")" ]]; then printf 'upload_max_filesize = 12M\npost_max_size = 14M\n' > "$INI"; echo "==> Raised PHP upload limits ($INI)"; fi
  fi
fi
if command -v nginx >/dev/null 2>&1; then
  CMB=$(nginx -T 2>/dev/null | grep -E '^\s*client_max_body_size' | awk '{gsub(";","",$2); print $2}' | sort -u || true)
  LOW=1; for v in $CMB; do [[ $(to_mb "$v") -ge 10 ]] && LOW=0; done
  for v in $CMB; do [[ $(to_mb "$v") -lt 10 ]] && LOW=1; done
  if [[ $LOW -eq 1 ]]; then
    # A lower limit written in the site's own config is raised there; otherwise one site-wide line is added
    for c in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; do
      [[ -f "$c" ]] && grep -qE '^\s*client_max_body_size' "$c" || continue
      cp -a "$c" "$BK/$(basename "$c").nginx-bak"
      sed -i -E 's/^(\s*)client_max_body_size\s+([0-9]+[kK]?|[1-9][mM]);/\1client_max_body_size 14m;/' "$c"
      if ! nginx -t >/dev/null 2>&1; then cp -a "$BK/$(basename "$c").nginx-bak" "$c"; fi
    done
    if [[ -d /etc/nginx/conf.d && ! -f /etc/nginx/conf.d/00-pitchside-uploads.conf ]]; then
      echo "client_max_body_size 14m;  # Pitchside Forum: ad and banner pictures" > /etc/nginx/conf.d/00-pitchside-uploads.conf
      nginx -t >/dev/null 2>&1 || rm -f /etc/nginx/conf.d/00-pitchside-uploads.conf
    fi
    if nginx -t >/dev/null 2>&1; then systemctl reload nginx 2>/dev/null || true; echo "==> Raised the web server upload limit to 14 MB"; fi
  fi
fi
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
echo "==> Updating the database and settings (raffle tables, menu items, Live Scores address)"
runuser -u "$WEB" -- php "$APP/app/install.php" | grep -iv "already exists" || true
rm -f "$APP"/app/storage/cache/*.json
echo "Done. Reload pitchsideforum.com: new colours, Live Scores button on the homepage, Gambling → Promotions & bonuses, Gambling → Weekly raffle, and the new favicon
(browsers keep old tab icons for a while; open the site in a private window to see the new one straight away)."
if ! grep -q "smtp_host" "$APP/app/config.php"; then echo "Note: no email server is set in app/config.php yet (smtp_host), so sign-up confirmation emails are only written to the log, not sent."; fi
echo "To undo: sudo cp -a $BK/. $APP/"
