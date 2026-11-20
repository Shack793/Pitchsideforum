<?php
// Renames the FIFA World Cup league and its board to "International" (the address stays the same, so old links work).
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$done = [];
$L = doc('LEAGUES'); $ch = false;
foreach ($L as &$l) if (($l['slug'] ?? '') === 'fifa-world-cup' && ($l['name'] ?? '') !== 'International') { $l['name'] = 'International'; $ch = true; }
unset($l);
if ($ch) { save_doc('LEAGUES', $L); $done[] = 'league'; }
$B = doc('BOARDS'); $ch = false;
foreach ($B as &$b) if (($b['slug'] ?? '') === 'fifa-world-cup' && ($b['name'] ?? '') !== 'International') {
  $b['name'] = 'International';
  if (($b['desc'] ?? '') === '' || stripos((string) $b['desc'], 'world cup') !== false) $b['desc'] = 'National teams and international tournaments';
  $ch = true;
}
unset($b);
if ($ch) { save_doc('BOARDS', $B); $done[] = 'board'; }
echo "RENAMED " . ($done ? implode(' and ', $done) : 'already done') . "\n";
