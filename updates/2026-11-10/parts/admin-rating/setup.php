<?php
// Adds "Site admin rating" to the Safety Index (20%, taking 4% from each of the other five parts),
// then raises it to 26%, taking the extra 6% from complaints.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$v = val("SELECT v FROM config WHERE k = 'SAFETY_W'");
$w = $v === null ? [] : jdec((string) $v, []);
if (!is_array($w) || !$w) $w = ['licence' => 15, 'complaints' => 35, 'fairness' => 15, 'size' => 10, 'feedback' => 25];
if (!isset($w['admin'])) {
  $prev = $w; $others = array_keys($w); $take = intdiv(20, count($others)); $left = 20 - $take * count($others);
  foreach ($others as $k) $w[$k] = max(0, (int) $w[$k] - $take);
  if ($left) { arsort($w); $w[array_key_first($w)] -= $left; }
  $w['admin'] = 20;
  save_doc('SAFETY_W', $w);
  audit(null, 'Safety Index weights', 'Admin → Reviews', 'Added Site admin rating at 20%', jenc($prev), jenc($w));
}
if ((int) $w['admin'] !== 26 && isset($w['complaints'])) {
  $prev = $w; $diff = 26 - (int) $w['admin'];
  if ((int) $w['complaints'] - $diff >= 0) {
    $w['admin'] = 26; $w['complaints'] = (int) $w['complaints'] - $diff;
    save_doc('SAFETY_W', $w);
    audit(null, 'Safety Index weights', 'Admin → Reviews', 'Site admin rating 26%, complaints lowered to match', jenc($prev), jenc($w));
  }
}
echo "WEIGHTS " . implode(', ', array_map(fn($k, $x) => ($k === 'admin' ? 'site admin rating' : $k) . " $x%", array_keys($w), $w)) . "\n";
