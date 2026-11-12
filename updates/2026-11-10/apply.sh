#!/usr/bin/env bash
# Pitchside Forum: installs every update from 5–10 November in one go.
#   sudo bash apply.sh
# Safe to run again: anything already installed is left as it is.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
export PITCHSIDE_DIR="${PITCHSIDE_DIR:-/var/www/pitchside}"
if [[ ! -f "$PITCHSIDE_DIR/app/lib/api.php" ]]; then echo "Couldn't find the site in $PITCHSIDE_DIR. Nothing was changed."; exit 1; fi
LOG="/var/backups/pitchside/install-$(date +%Y%m%d-%H%M%S).log"; mkdir -p "$(dirname "$LOG")"
PARTS=(
  "pin-order|Pinned topics: Up/Down order"
  "complaints-policy|Complaints policy, pinned in Complaint Discussions"
  "review-guidelines|Review guidelines (one post)"
  "marketplace-rules|Marketplace rules, pinned in Marketplace Talk"
  "duplicates|Duplicate-post detection"
  "casino-seo|Casino pages for search engines"
  "seo|Search engines: site opened to Google, review star ratings, team and league pages, link-preview pictures"
  "automod|AI moderator (Admin → AI moderation)"
  "visitors|Visitor counts by country (Admin → Visitors)"
  "bugs|Bug Reports board with statuses"
  "links|Section links: page trails, Forum page headings and a Tags page"
  "top-picks|Top picks: your six casinos, section moved to the top (Admin → Top picks)"
  "policy-placement|Complaints policy on the Complaints page, review guidelines on the casino and sportsbook pages"
  "raffle-dec31|Raffle draw on 31 December"
  "ads-fix|Ads: homepage banner and side ads always show while on and live"
  "weights|Safety Index weights: licence 15%, member reviews 25%"
  "gif-ads|Animated GIF banners and ads"
  "casino-tiles|Casino tiles: Play and Read review buttons line up"
  "admin-rating|Site admin rating: 26% of the Safety Index, set in Admin → Reviews"
  "member-privacy|Member list and staff list kept out of Google (profiles still findable)"
  "aff-quiet|Affiliate badges and commission notes removed (18+ stays)"
  "no-promotions|Promotions & bonuses page removed"
  "new-listings|New casinos: BiggerZ and Bets.io (not blacklisted)"
  "fast-start|Loading placeholder clears as soon as the page shows"
  "admin-tabs|Admin tabs in alphabetical order"
)
ok=0; bad=0; echo
for p in "${PARTS[@]}"; do
  dir=${p%%|*}; label=${p#*|}
  printf '%s\n===== %s =====\n' "" "$label" >> "$LOG"
  out=$(bash "parts/$dir/apply.sh" 2>&1); rc=$?
  echo "$out" >> "$LOG"
  if [[ $rc -eq 0 ]]; then echo "  ✓ $label"; ok=$((ok+1))
  else echo "  ✗ $label: $(echo "$out" | grep -v '^==>' | grep -v '^\s*$' | tail -1)"; bad=$((bad+1)); fi
done
rm -f "$PITCHSIDE_DIR"/app/storage/cache/*.json 2>/dev/null || true
FPM=$(systemctl list-units --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^php.*fpm' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM" 2>/dev/null || true
MK=$(cd "$PITCHSIDE_DIR" && php -r 'require "app/lib/api.php"; echo feature_on("marketplace") ? "on" : "off";' 2>/dev/null || true)
echo
if [[ $bad -eq 0 ]]; then echo "All done: $ok of $ok installed."; else echo "$ok installed, $bad didn't. Send me the file $LOG and I'll fix it."; fi
[[ "$MK" == "off" ]] && echo "Note: your marketplace is switched off, so Marketplace Talk and its rules stay hidden until you turn it on (Admin → System)."
echo "Reload the site with Ctrl+F5 (Cmd+Shift+R on a Mac) to see everything."
