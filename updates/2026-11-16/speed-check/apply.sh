#!/usr/bin/env bash
# Pitchside Forum: speed check. Changes NOTHING on the site. It opens a few pages the way a visitor would and prints
# how long the server takes and how big each page is, so the slow loading can be fixed properly.
# Run:  sudo bash apply.sh   then copy everything it prints and send it back.
set -uo pipefail
SITE="${PITCHSIDE_URL:-https://pitchsideforum.com}"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"
echo "=== Pitchside speed check ($(date -u '+%Y-%m-%d %H:%M UTC')) ==="
for p in / /sports /gambling /casinos /crypto /marketplace /community /forum; do
  for z in gzip none; do
    if [[ $z == gzip ]]; then H='Accept-Encoding: gzip'; else H='Accept-Encoding: identity'; fi
    curl -s -o /dev/null -H "$H" -w "$p [$z] status=%{http_code} size=%{size_download}B server=%{time_starttransfer}s total=%{time_total}s\n" "$SITE$p"
  done
done
for f in app.895e02db9d15.js; do curl -s -o /dev/null -H 'Accept-Encoding: gzip' -w "asset $f [gzip] size=%{size_download}B total=%{time_total}s cache=%header{cache-control}\n" "$SITE/assets/$f"; done
TMP=$(mktemp); curl -s -H 'Accept-Encoding: identity' "$SITE/sports" > "$TMP"
php -r '$h=file_get_contents($argv[1]); if(!preg_match("/window\.PS_BOOT=(.*?);<\/script>/s",$h,$m)){echo "No page data found\n";exit;} $d=json_decode($m[1],true); echo "page data total: ".strlen($m[1])." bytes\n"; $s=[]; foreach($d as $k=>$v){$s[$k]=strlen(json_encode($v));} arsort($s); foreach(array_slice($s,0,8,true) as $k=>$n){echo "  $k: $n bytes".(is_array($d[$k])?" (".count($d[$k])." items)":"")."\n";} $posts=0; foreach(($d["topics"]??[]) as $t){$posts+=count($t["posts"]??[]);} echo "  topics: ".count($d["topics"]??[]).", posts inside them: $posts\n";' "$TMP"
rm -f "$TMP"
echo "server: $(nproc 2>/dev/null) CPU, load $(cut -d' ' -f1-3 /proc/loadavg), free memory $(free -m 2>/dev/null | awk '/Mem:/{print $7" MB of "$2" MB"}')"
echo "=== end ==="
