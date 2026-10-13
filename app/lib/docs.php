<?php
// Site configuration documents: boards, categories, navigation, ads, ticker, sports, permissions…
// Each is one JSON document in the `config` table, edited from the Admin dashboard.
declare(strict_types=1);

const DOC_KEYS = ['CATEGORIES','BOARDS','TAGS','NAV','SEO','SETTINGS','LAYOUT','BANNERS','SIDE_SLOTS','SIDE_ADS','TICKER','POST_ADS','AFF_LINKS',
  'SPORTS','LEAGUES','TEAMS','SPORT_BOARD','PERMS','LIMITS','RANKS','MOD_TEMPLATES','MOD_PROFILES','EVENTS'];
// Which capability may change each document. SETTINGS keys in SYSTEM_SETTINGS also need the "system" capability.
const DOC_WRITE = ['PERMS' => 'managePermissions', 'LIMITS' => 'managePermissions', 'MOD_TEMPLATES' => 'managePermissions', 'MOD_PROFILES' => 'managePermissions'];
const SYSTEM_SETTINGS = ['scoresUrl', 'scoresUtm', 'ageGate', 'provider', 'providerOk', 'cacheTtl', 'fixturesFeed', 'siteIndexing', 'features', 'bannedDomains'];
// Documents only staff receive
const DOC_STAFF_ONLY = ['MOD_PROFILES'];
// Ad stats live in ad_stats; they're merged in when sent and stripped when saved.
const AD_DOCS = ['BANNERS' => 'banner', 'SIDE_ADS' => 'side', 'POST_ADS' => 'post'];

function doc(string $k) {
  static $cache = [];
  if (array_key_exists($k, $cache)) return $cache[$k];
  $r = row("SELECT v FROM config WHERE k = ?", [$k]);
  return $cache[$k] = $r ? jdec($r['v'], []) : [];
}
function doc_forget(): void { /* static cache lives per request; nothing to do across requests */ }
function doc_row(string $k): ?array { return row("SELECT k, v, ver, updated FROM config WHERE k = ?", [$k]); }

function setting(string $k, $def = null) { $s = doc('SETTINGS'); return $s[$k] ?? $def; }
function feature_on(string $k): bool { $f = setting('features', []); return !empty($f[$k]); }

/* Sets travel as {"$set":[...]} so the browser can rebuild them. */
function set_list($v): array { return is_array($v) && isset($v['$set']) && is_array($v['$set']) ? $v['$set'] : (is_array($v) ? array_values($v) : []); }

function save_doc(string $k, $v, string $actor = 'system'): void {
  $json = jenc($v); $now = now_ms();
  $n = q("UPDATE config SET v = ?, ver = ver + 1, updated = ? WHERE k = ?", [$json, $now, $k])->rowCount();
  if (!$n && !insert_ignore('config', ['k' => $k, 'v' => $json, 'ver' => 1, 'updated' => $now])) q("UPDATE config SET v = ?, ver = ver + 1, updated = ? WHERE k = ?", [$json, $now, $k]);
}

/* ---------- Cleaning admin input ---------- */
// Colours, image addresses and links are checked so a saved value can never break out of the page's HTML.
function clean_doc($v, string $key = '', int $depth = 0) {
  if ($depth > 12) fail('That setting is nested too deeply.');
  if (is_array($v)) { $o = []; foreach ($v as $k => $x) { if (in_array($k, ['imps', 'clicks'], true)) continue; $o[$k] = clean_doc($x, (string) $k, $depth + 1); } return $o; }
  if (is_string($v)) {
    if (str_starts_with($v, 'data:')) return store_data_image($v);
    if (preg_match('/^(color|bg|fg|accent|avatarColor)$/i', $key)) return preg_match('/^#[0-9a-f]{3,8}$/i', $v) ? $v : '#A9D6F5';
    if (preg_match('/^(img|logo|avatar|image)$/i', $key)) return $v === '' ? null : (preg_match('#^(/uploads/[A-Za-z0-9/_.-]+|https://[^\s"\'<>]+)$#', $v) ? $v : null);
    if (preg_match('/^(dest|url|path|canonical|scoresUrl|fixturesFeed|go)$/i', $key) && $v !== '') {
      if (preg_match('/^\s*(javascript|data|vbscript):/i', $v) || preg_match('/["\'<>\s]/', $v)) fail("“{$v}” isn't a valid link. Use https://… or a path starting with /.");
    }
    if (mb_strlen($v) > 20000) fail('One of the values is too long.');
  }
  return $v;
}

// Turns an uploaded data: image into a file under /uploads/media and returns its address.
function store_data_image(string $data, int $maxBytes = 2500000, ?int $maxSide = 1200): string {
  if (!preg_match('#^data:image/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$#', $data, $m)) fail('Images must be PNG, JPG, GIF or WebP.');
  $bin = base64_decode(preg_replace('/\s+/', '', $m[2]), true);
  if ($bin === false || strlen($bin) > $maxBytes) fail('Images must be under 2 MB.');
  return save_image_bytes($bin, 'media', $maxSide);
}
// Re-encodes an image with GD (drops metadata such as photo location, defuses anything hidden in the file).
function save_image_bytes(string $bin, string $dir, ?int $maxSide = 1200, ?int $square = null): string {
  $info = @getimagesizefromstring($bin);
  if (!$info || !in_array($info[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG, IMAGETYPE_GIF, IMAGETYPE_WEBP], true)) fail("That file isn't a supported image.");
  if ($info[0] * $info[1] > 40000000) fail('That image is too large.');
  $src = @imagecreatefromstring($bin); if (!$src) fail("That image couldn't be read.");
  $w = imagesx($src); $h = imagesy($src);
  if ($square) { $side = min($w, $h); $sx = intdiv($w - $side, 2); $sy = intdiv($h - $side, 2); $tw = $th = min($square, $side); }
  else { $sx = $sy = 0; $scale = $maxSide ? min(1, $maxSide / max($w, $h)) : 1; $tw = max(1, (int) round($w * $scale)); $th = max(1, (int) round($h * $scale)); }
  $dst = imagecreatetruecolor($tw, $th);
  imagealphablending($dst, false); imagesavealpha($dst, true);
  imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
  imagecopyresampled($dst, $src, 0, 0, $sx, $sy, $tw, $th, $square ? $side : $w, $square ? $side : $h);
  $alpha = in_array($info[2], [IMAGETYPE_PNG, IMAGETYPE_GIF, IMAGETYPE_WEBP], true);
  ob_start();
  if (function_exists('imagewebp')) { imagewebp($dst, null, 85); $ext = 'webp'; }
  elseif ($alpha) { imagepng($dst, null, 6); $ext = 'png'; }
  else { imagejpeg($dst, null, 85); $ext = 'jpg'; }
  $out = ob_get_clean();
  imagedestroy($src); imagedestroy($dst);
  $name = substr(hash('sha256', $out), 0, 24) . '.' . $ext;
  $folder = PUBLIC_DIR . "/uploads/$dir";
  if (!is_dir($folder)) mkdir($folder, 0755, true);
  if (!is_file("$folder/$name")) file_put_contents("$folder/$name", $out);
  return "/uploads/$dir/$name";
}

/* ---------- Sending documents to the browser ---------- */
function ad_stat_totals(string $kind): array {
  $o = [];
  foreach (rows("SELECT ad_id, SUM(imps) i, SUM(clicks) c FROM ad_stats WHERE kind = ? GROUP BY ad_id", [$kind]) as $r) $o[(int) $r['ad_id']] = [(int) $r['i'], (int) $r['c']];
  return $o;
}
function doc_out(string $k, ?array $viewer) {
  $v = doc($k);
  if (isset(AD_DOCS[$k])) {
    $st = ad_stat_totals(AD_DOCS[$k]);
    foreach ($v as &$a) { $s = $st[(int) ($a['id'] ?? 0)] ?? [0, 0]; $a['imps'] = $s[0]; $a['clicks'] = $s[1]; } unset($a);
  }
  if ($k === 'AFF_LINKS' && !($viewer && can($viewer, 'manageCategories'))) {
    // Members don't need deal terms or conversion records, only where the link goes.
    $v = array_map(fn($l) => array_intersect_key($l, array_flip(['id', 'slug', 'name', 'op', 'url', 'offer', 'status'])), $v);
  }
  return $v;
}
function docs_out(?array $viewer, int $since = 0): array {
  $o = []; $vers = [];
  foreach (rows("SELECT k, ver, updated FROM config") as $r) {
    if (!in_array($r['k'], DOC_KEYS, true)) continue;
    if (in_array($r['k'], DOC_STAFF_ONLY, true) && !($viewer && is_staff($viewer))) continue;
    $stats = isset(AD_DOCS[$r['k']]) && $since && $viewer && can($viewer, 'manageCategories');
    if ($since && (int) $r['updated'] <= $since && !$stats) continue;
    $o[$r['k']] = doc_out($r['k'], $viewer); $vers[$r['k']] = (int) $r['ver'];
  }
  return [$o, $vers];
}
