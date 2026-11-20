<?php
// Sets the recommended casinos the first time only (Crypto.Games, then 1xBet). Later changes in Admin are kept.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
if (array_key_exists('recommended', rec_layout())) { echo "REC unchanged (" . implode(', ', (array) rec_layout()['recommended']) . ")\n"; exit; }
$norm = fn(string $s) => preg_replace('/[^a-z0-9]/', '', strtolower($s));
$find = function (array $keys) use ($norm) {
  foreach (rows("SELECT slug, data FROM operators") as $r) { $d = jdec((string) $r['data'], []);
    $c = [$norm($r['slug']), $norm((string) ($d['name'] ?? '')), $norm((string) ($d['website'] ?? ''))];
    foreach ($keys as $k) if (in_array($norm($k), $c, true)) return $r['slug']; }
  return null;
};
$want = array_values(array_filter([$find(['crypto-games', 'Crypto.Games', 'crypto.games']), $find(['1xbet', '1xBet', '1xbet.com'])]));
$saved = rec_save($want, null);
echo "REC " . implode(', ', $saved) . "\n";
