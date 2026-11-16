<?php
// Safety Index weights: Licence 15%, User feedback (member reviews) 25%; the other parts stay as they are.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$v = val("SELECT v FROM config WHERE k = 'SAFETY_W'");
$w = $v === null ? [] : jdec((string) $v, []);
if (!is_array($w) || !$w) $w = ['licence' => 25, 'complaints' => 35, 'fairness' => 15, 'size' => 10, 'feedback' => 15];
$prev = $w;
$w['licence'] = 15; $w['feedback'] = 25;
$sum = array_sum(array_map('intval', $w));
if ($sum !== 100) { echo "SUM $sum " . jenc($w) . "\n"; exit(3); }
if ($w != $prev) {
  save_doc('SAFETY_W', $w);
  audit(null, 'Safety Index weights', 'Admin → Reviews', 'Licence 15%, member reviews 25%', jenc($prev), jenc($w));
}
echo "WEIGHTS " . implode(', ', array_map(fn($k, $x) => "$k $x%", array_keys($w), $w)) . "\n";
