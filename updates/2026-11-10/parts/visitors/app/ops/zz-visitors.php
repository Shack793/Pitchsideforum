<?php
// Pitchside Forum: visitor counts by country (Admin → Visitors).
// Counts unique visitors per day, week, month and year, and which country they came from.
// No IP address is stored: the country is looked up the moment a page is requested and only the two-letter code is kept.
// Each browser gets an anonymous random ID in a first-party cookie ("ps_v"); only a scrambled form of it is stored.
// Country data: DB-IP "IP to Country Lite" (CC BY 4.0), downloaded to app/storage/geo and refreshed monthly by cron.
// If the site is behind Cloudflare, Cloudflare's country header is used instead. Bots and crawlers aren't counted.
declare(strict_types=1);

const VIS_COOKIE = 'ps_v';

function vis_install_tables(): void {
  if (cfg('db_driver') === 'sqlite') {
    q("CREATE TABLE IF NOT EXISTS visits_daily (day TEXT NOT NULL, vid TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'XX', hits INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (day, vid))");
    q("CREATE INDEX IF NOT EXISTS visits_daily_vid ON visits_daily (vid)");
  } else {
    q("CREATE TABLE IF NOT EXISTS visits_daily (day CHAR(10) NOT NULL, vid CHAR(16) NOT NULL, country CHAR(2) NOT NULL DEFAULT 'XX', hits INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (day, vid), KEY k_day_country (day, country)) ENGINE=InnoDB DEFAULT CHARSET=ascii");
  }
}
function vis_ready(): bool { static $ok = null; if ($ok === null) { try { val("SELECT 1 FROM visits_daily LIMIT 1"); $ok = true; } catch (Throwable $e) { $ok = false; } } return $ok; }

/* ---------- Country lookup (no IP is ever written anywhere) ---------- */
function vis_geo_dir(): string { return APP_DIR . '/storage/geo'; }
function vis_lookup(string $ip): string {
  $bin = @inet_pton($ip); if ($bin === false) return 'XX';
  $v4 = strlen($bin) === 4; $file = vis_geo_dir() . ($v4 ? '/v4.bin' : '/v6.bin'); $w = $v4 ? 4 : 16; $rec = $w * 2 + 2;
  $fh = @fopen($file, 'rb'); if (!$fh) return 'XX';
  $n = intdiv((int) filesize($file), $rec); $lo = 0; $hi = $n - 1; $found = -1;
  while ($lo <= $hi) {                       // last range starting at or before the address
    $mid = ($lo + $hi) >> 1; fseek($fh, $mid * $rec); $start = fread($fh, $w);
    if (strcmp($start, $bin) <= 0) { $found = $mid; $lo = $mid + 1; } else $hi = $mid - 1;
  }
  $cc = 'XX';
  if ($found >= 0) { fseek($fh, $found * $rec + $w); $end = fread($fh, $w); $c = fread($fh, 2); if (strcmp($bin, $end) <= 0 && preg_match('/^[A-Z]{2}$/', (string) $c)) $cc = $c; }
  fclose($fh);
  return $cc;
}
function vis_country(): string {
  $cf = strtoupper((string) ($_SERVER['HTTP_CF_IPCOUNTRY'] ?? ''));
  if (preg_match('/^[A-Z]{2}$/', $cf) && $cf !== 'XX' && $cf !== 'T1') return $cf;
  $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
  // behind a proxy on the same machine, the visitor's address is in X-Forwarded-For / X-Real-IP
  if ($ip !== '' && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
    $fw = trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['HTTP_X_REAL_IP'] ?? ''))[0]);
    if (filter_var($fw, FILTER_VALIDATE_IP)) $ip = $fw;
  }
  return $ip !== '' ? vis_lookup($ip) : 'XX';
}
// Build the lookup files from DB-IP's CSV (gzipped). Returns [v4 ranges, v6 ranges].
function vis_build_geo(string $gz): array {
  @ini_set('memory_limit', '512M');   // the full file has about 600,000 ranges
  $in = @gzopen($gz, 'rb'); if (!$in) throw new RuntimeException("Can't open $gz");
  $v4 = []; $v6 = [];
  while (($line = gzgets($in)) !== false) {
    $p = str_getcsv(trim($line)); if (count($p) < 3) continue;
    $a = @inet_pton($p[0]); $b = @inet_pton($p[1]); $cc = strtoupper(trim($p[2]));
    if ($a === false || $b === false || strlen($a) !== strlen($b) || !preg_match('/^[A-Z]{2}$/', $cc)) continue;
    if (strlen($a) === 4) $v4[] = $a . $b . $cc; else $v6[] = $a . $b . $cc;
  }
  gzclose($in);
  if (count($v4) < 1000) throw new RuntimeException('The country file looks incomplete.');
  sort($v4, SORT_STRING); sort($v6, SORT_STRING);
  $dir = vis_geo_dir(); if (!is_dir($dir)) mkdir($dir, 0755, true);
  foreach (['v4' => $v4, 'v6' => $v6] as $k => $rows) { file_put_contents("$dir/$k.bin.tmp", implode('', $rows)); rename("$dir/$k.bin.tmp", "$dir/$k.bin"); }
  file_put_contents("$dir/source.txt", basename($gz) . "\n" . gmdate('c') . "\n");
  return [count($v4), count($v6)];
}
function vis_download_geo(): string {
  $dir = vis_geo_dir(); if (!is_dir($dir)) mkdir($dir, 0755, true);
  foreach ([gmdate('Y-m'), gmdate('Y-m', strtotime('first day of last month'))] as $m) {
    $url = "https://download.db-ip.com/free/dbip-country-lite-$m.csv.gz"; $tmp = "$dir/dbip-country-lite-$m.csv.gz";
    $fh = fopen($tmp, 'wb'); $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 300, CURLOPT_USERAGENT => 'PitchsideForum/1.0']);
    $ok = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); fclose($fh);
    if ($ok && $code === 200 && filesize($tmp) > 100000) { try { [$a, $b] = vis_build_geo($tmp); @unlink($tmp); return "dbip-country-lite-$m: $a IPv4 and $b IPv6 ranges"; } catch (Throwable $e) {} }
    @unlink($tmp);
  }
  throw new RuntimeException("Couldn't download the country database from DB-IP.");
}
function vis_geo_info(): array {
  $f = vis_geo_dir() . '/v4.bin';
  if (!is_file($f)) return ['installed' => false];
  $src = @file(vis_geo_dir() . '/source.txt', FILE_IGNORE_NEW_LINES) ?: [];
  return ['installed' => true, 'source' => preg_replace('/\.csv\.gz$/', '', (string) ($src[0] ?? '')), 'at' => (int) filemtime($f) * 1000];
}

/* ---------- Counting a visit ---------- */
function vis_is_bot(string $ua): bool {
  return $ua === '' || (bool) preg_match('/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|monitor|uptime|pingdom|lighthouse|headless|phantom|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|scrapy|httpclient|feedfetcher|validator|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider|bytespider|gptbot|claudebot|ccbot|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview/i', $ua);
}
function vis_track(): void {
  if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') return;
  $path = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/');
  if (preg_match('~^/(api|go|assets|uploads)/|^/(robots\.txt|sitemap[^/]*|favicon\.ico|manifest\.json)$~', $path)) return;
  if (vis_is_bot((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''))) return;
  $purpose = strtolower((string) ($_SERVER['HTTP_SEC_PURPOSE'] ?? $_SERVER['HTTP_PURPOSE'] ?? $_SERVER['HTTP_X_MOZ'] ?? ''));
  if (str_contains($purpose, 'prefetch') || str_contains($purpose, 'prerender')) return;
  $accept = (string) ($_SERVER['HTTP_ACCEPT'] ?? ''); if ($accept !== '' && !str_contains($accept, 'text/html') && !str_contains($accept, '*/*')) return;
  if (strtoupper((string) ($_SERVER['HTTP_DNT'] ?? '')) === '1' && setting('visitorsHonourDnt', false)) return;
  $id = (string) ($_COOKIE[VIS_COOKIE] ?? '');
  if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
    $id = bin2hex(random_bytes(16));
    if (!headers_sent()) setcookie(VIS_COOKIE, $id, ['expires' => time() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
  }
  $vid = substr(hash('sha256', 'pitchside-visitor|' . $id), 0, 16);
  register_shutdown_function(function () use ($vid) {
    try {
      if (!vis_ready()) return;
      $day = gmdate('Y-m-d');
      if (!insert_ignore('visits_daily', ['day' => $day, 'vid' => $vid, 'country' => vis_country(), 'hits' => 1]))
        q("UPDATE visits_daily SET hits = hits + 1 WHERE day = ? AND vid = ?", [$day, $vid]);
    } catch (Throwable $e) { error_log('[visitors] ' . $e->getMessage()); }
  });
}
if (PHP_SAPI !== 'cli' && basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'index.php') { try { vis_track(); } catch (Throwable $e) { error_log('[visitors] ' . $e->getMessage()); } }

/* ---------- Cron: refresh the country file monthly, keep three years of counts ---------- */
if (PHP_SAPI === 'cli' && basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'cron.php') {
  register_shutdown_function(function () {
    try {
      $g = vis_geo_info();
      $stale = !$g['installed'] || ($g['source'] ?? '') !== 'dbip-country-lite-' . gmdate('Y-m');
      if ($stale && (int) meta_get('visitors:geo:tried', '0') < now_ms() - DAY_MS && (int) gmdate('j') >= 3) {
        meta_set('visitors:geo:tried', (string) now_ms());
        try { log_line('cron.log', 'visitors: ' . vis_download_geo()); } catch (Throwable $e) { log_line('cron.log', 'visitors: ' . $e->getMessage()); }
      }
      if (vis_ready() && (int) meta_get('visitors:pruned', '0') < now_ms() - DAY_MS) {
        meta_set('visitors:pruned', (string) now_ms());
        q("DELETE FROM visits_daily WHERE day < ?", [gmdate('Y-m-d', time() - 3 * 366 * 86400)]);
      }
    } catch (Throwable $e) { error_log('[visitors cron] ' . $e->getMessage()); }
  });
}

/* ---------- Admin → Visitors ---------- */
function vis_range(string $unit, int $back): array {
  $t = new DateTimeImmutable('today', new DateTimeZone('UTC'));
  if ($unit === 'week') { $s = $t->modify('monday this week')->modify("-$back week"); $e = $s->modify('+6 days'); $label = 'Week of ' . $s->format('j M Y'); }
  elseif ($unit === 'month') { $s = $t->modify('first day of this month')->modify("-$back month"); $e = $s->modify('last day of this month'); $label = $s->format('F Y'); }
  elseif ($unit === 'year') { $s = $t->setDate((int) $t->format('Y') - $back, 1, 1); $e = $s->setDate((int) $s->format('Y'), 12, 31); $label = $s->format('Y'); }
  else { $s = $t->modify("-$back day"); $e = $s; $label = $back === 0 ? 'Today' : ($back === 1 ? 'Yesterday' : $s->format('D j M Y')); }
  return [$s->format('Y-m-d'), $e->format('Y-m-d'), $label];
}
function vis_count(string $a, string $b): array {
  $r = row("SELECT COUNT(DISTINCT vid) v, COALESCE(SUM(hits), 0) h FROM visits_daily WHERE day BETWEEN ? AND ?", [$a, $b]);
  return ['visitors' => (int) ($r['v'] ?? 0), 'loads' => (int) ($r['h'] ?? 0)];
}
op('visitors.stats', function (array $in, array $u) {
  if (!is_admin($u)) fail('Only admins can see visitor numbers.', 403);
  if (!vis_ready()) fail('The visitor tables are missing. Run the installer again.');
  $unit = in_array($in['unit'] ?? '', ['day', 'week', 'month', 'year'], true) ? $in['unit'] : 'day';
  $back = max(0, min(400, int_in($in, 'back')));
  $tiles = [];
  foreach (['day' => 'Today', 'week' => 'This week', 'month' => 'This month', 'year' => 'This year'] as $k => $l) { [$a, $b] = vis_range($k, 0); $tiles[] = ['unit' => $k, 'label' => $l] + vis_count($a, $b); }
  [$a, $b, $label] = vis_range($unit, $back); [$pa, $pb] = vis_range($unit, $back + 1);
  $countries = array_map(fn($r) => ['cc' => $r['country'], 'visitors' => (int) $r['v'], 'loads' => (int) $r['h']],
    rows("SELECT country, COUNT(DISTINCT vid) v, SUM(hits) h FROM visits_daily WHERE day BETWEEN ? AND ? GROUP BY country ORDER BY v DESC, country", [$a, $b]));
  $n = ['day' => 30, 'week' => 12, 'month' => 12, 'year' => 5][$unit]; $trend = [];
  for ($i = $n - 1; $i >= 0; $i--) { [$x, $y, $l] = vis_range($unit, $back + $i); $trend[] = ['from' => $x, 'to' => $y, 'label' => $l] + vis_count($x, $y); }
  return ['unit' => $unit, 'back' => $back, 'label' => $label, 'from' => $a, 'to' => $b, 'now' => vis_count($a, $b), 'prev' => vis_count($pa, $pb),
    'tiles' => $tiles, 'countries' => $countries, 'trend' => $trend, 'geo' => vis_geo_info(), 'first' => (string) (val("SELECT MIN(day) FROM visits_daily") ?? '')];
});
