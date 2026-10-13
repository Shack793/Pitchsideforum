<?php
// Tracked redirects.
//   /go/{affiliate-link}?p={placement}  logs the click, then forwards to the partner with {placement} filled in.
//   /go/ad/{banner|side|post}/{id}      counts an ad click, then forwards to the ad's destination.
declare(strict_types=1);
require dirname(__DIR__) . '/app/lib/api.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
$path = trim(preg_replace('#^/go#', '', parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/'), '/');
function bounce(string $url): never { header('Location: ' . $url, true, 302); exit; }
function visitor_id(): string {
  $v = $_COOKIE['ps_v'] ?? '';
  if (!preg_match('/^v[a-z0-9]{8,16}$/', $v)) { $v = 'v' . substr(rand_token(6), 0, 10); setcookie('ps_v', $v, ['expires' => time() + 365 * 86400, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']); }
  return $v;
}
try {
  load_session(); $u = viewer();
  if (preg_match('#^ad/(banner|side|post)/(\d+)$#', $path, $m)) {
    $docKey = ['banner' => 'BANNERS', 'side' => 'SIDE_ADS', 'post' => 'POST_ADS'][$m[1]];
    $ad = null; foreach (doc($docKey) as $a) if ((int) ($a['id'] ?? 0) === (int) $m[2]) $ad = $a;
    if (!$ad) bounce('/');
    rate_limit('adgo:' . client_ip(), 60, 60);
    count_ad_click($m[1], (int) $m[2]);
    $dest = (string) ($ad['dest'] ?? '/');
    // An ad pointed at an affiliate link goes through the affiliate redirect so both are counted
    if (!empty($ad['aff'])) foreach (doc('AFF_LINKS') as $l) if ((int) $l['id'] === (int) $ad['aff']) bounce('/go/' . rawurlencode($l['slug']) . '?p=' . ($m[1] === 'banner' ? 'banner' : ($m[1] === 'side' ? 'side-slot' : 'post-ad')));
    bounce(preg_match('#^(https?://|/)#', $dest) ? $dest : '/');
  }
  if (preg_match('#^([a-z0-9-]{1,64})$#', $path, $m)) {
    $link = null; foreach (doc('AFF_LINKS') as $l) if (($l['slug'] ?? '') === $m[1]) $link = $l;
    if (!$link || ($link['status'] ?? '') !== 'active') bounce('/gambling');
    $places = ['casino-list', 'operator-page', 'post-ad', 'side-slot', 'banner', 'ticker', 'direct'];
    $p = in_array($_GET['p'] ?? '', $places, true) ? $_GET['p'] : 'direct';
    $ref = parse_url($_SERVER['HTTP_REFERER'] ?? '', PHP_URL_PATH) ?: '';
    rate_limit('affgo:' . client_ip(), 60, 60);
    insert('aff_clicks', ['link' => (int) $link['id'], 'placement' => $p, 'at' => now_ms(), 'visitor' => $u ? $u['name'] : visitor_id(), 'user' => $u ? $u['name'] : null, 'page' => mb_substr($ref, 0, 255)]);
    bounce(str_replace('{placement}', rawurlencode($p), (string) $link['url']));
  }
  bounce('/');
} catch (Throwable $e) {
  error_log('[pitchside go] ' . $e->getMessage());
  bounce('/');
}
