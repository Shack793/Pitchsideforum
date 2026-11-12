<?php
// Takes "Promotions & bonuses" out of the site menu (the Gambling menu and its tabs).
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$v = val("SELECT v FROM config WHERE k = 'NAV'");
$nav = $v === null ? [] : jdec((string) $v, []);
if (!is_array($nav) || !$nav) { echo "NAV none\n"; exit(0); }
$changed = 0;
foreach ($nav as &$n) {
  if (!is_array($n)) continue;
  if (isset($n['match']) && is_array($n['match'])) { $m = array_values(array_filter($n['match'], fn($p) => $p !== '/promotions')); if (count($m) !== count($n['match'])) { $n['match'] = $m; $changed++; } }
  if (isset($n['children']) && is_array($n['children'])) { $c = array_values(array_filter($n['children'], fn($k) => !is_array($k) || ($k['path'] ?? '') !== '/promotions')); if (count($c) !== count($n['children'])) { $n['children'] = $c; $changed++; } }
}
unset($n);
$nav = array_values(array_filter($nav, fn($n) => !is_array($n) || ($n['path'] ?? '') !== '/promotions'));
if ($changed) { save_doc('NAV', $nav); audit(null, 'Navigation', 'Gambling menu', 'Removed Promotions & bonuses', '/promotions', 'removed'); }
echo "NAV " . ($changed ? 'updated' : 'already clean') . "\n";
