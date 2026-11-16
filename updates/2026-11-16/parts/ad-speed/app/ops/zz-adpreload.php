<?php
// Pitchside Forum: ads appear without a delay. The page head tells the browser about the homepage banner picture
// (homepage only) and the side ad pictures (big screens only), so it starts downloading them straight away instead of
// waiting for the page scripts. Changes nothing else; remove this file and pages work as before.
declare(strict_types=1);

(function () {
  if (PHP_SAPI === 'cli' || ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') return;
  $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  if (preg_match('#^/(api|go|assets|uploads)(/|$)|\.[a-z0-9]{2,5}$#i', $path)) return;
  try {
    $lay = doc('LAYOUT'); if (!empty($lay['clean'])) return;
    $now = now_ms();
    $live = fn($a) => is_array($a) && empty($a['paused']) && (empty($a['start']) || $a['start'] <= $now) && (empty($a['end']) || $a['end'] > $now);
    $ok = fn($u) => is_string($u) && $u !== '' && preg_match('#^(/uploads/|https://)#', $u);
    $e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $out = '';
    if ($path === '/' && !empty($lay['homeBanner'])) {
      $list = array_values(array_filter((array) doc('BANNERS'), $live));
      usort($list, fn($a, $b) => (int) !empty($a['house']) <=> (int) !empty($b['house']));   // same order as the site: house ad last
      $b = $list[0] ?? null;
      if ($b && $ok($b['full'] ?? null)) {
        if ($ok($b['fullM'] ?? null)) $out .= '<link rel="preload" as="image" href="' . $e($b['fullM']) . '" media="(max-width: 640px)" fetchpriority="high">'
          . '<link rel="preload" as="image" href="' . $e($b['full']) . '" media="(min-width: 641px)" fetchpriority="high">';
        else $out .= '<link rel="preload" as="image" href="' . $e($b['full']) . '" fetchpriority="high">';
      }
    }
    if (!empty($lay['sideAds'])) {
      $slots = [];
      foreach ((array) doc('SIDE_SLOTS') as $sl) if (!empty($sl['on'])) $slots[(string) ($sl['id'] ?? '')] = true;
      $seen = [];
      foreach ((array) doc('SIDE_ADS') as $a) {
        $sl = (string) ($a['slot'] ?? '');
        if (!isset($slots[$sl]) || isset($seen[$sl]) || !$live($a) || !$ok($a['full'] ?? null)) continue;
        $seen[$sl] = true;   // the first ad in each slot is the one shown first
        $out .= '<link rel="preload" as="image" href="' . $e($a['full']) . '" media="(min-width: 1280px)">';
      }
    }
    if ($out !== '') $GLOBALS['PS_EXTRA_HEAD'] = ($GLOBALS['PS_EXTRA_HEAD'] ?? '') . $out . "\n";
  } catch (Throwable $t) { /* never block the page */ }
})();
