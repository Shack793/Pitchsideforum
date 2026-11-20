<?php
// Adds the Crypto.Games animated banners: one in the right-hand side slot, one under the first post (computer and
// phone versions). Link: https://crypto.games/ (replace with your affiliate link in Admin → Ads & affiliates).
// Gambling ads: 18+ notice, hidden from guests who haven't confirmed their age, like 1xBet. Safe to run again.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/'); $img = $argv[2];
require $app . '/app/lib/api.php';
$folder = PUBLIC_DIR . '/uploads/media'; if (!is_dir($folder)) mkdir($folder, 0755, true);
$put = function (string $f) use ($folder, $img) {
  $bin = (string) file_get_contents("$img/$f"); if (substr($bin, 0, 4) !== 'RIFF' || substr($bin, 8, 4) !== 'WEBP') throw new RuntimeException("$f isn't a WebP picture");
  $name = 'cryptogames-' . substr(hash('sha256', $bin), 0, 12) . '.webp';   // animated WebP: same animation, about a third of the GIF's size
  if (!is_file("$folder/$name")) file_put_contents("$folder/$name", $bin);
  return "/uploads/media/$name";
};
$side = $put('cryptogames-side-320x960.webp'); $pc = $put('cryptogames-inpost-computer-1120x70.webp'); $ph = $put('cryptogames-inpost-phone-320x50.webp');
$now = now_ms(); $done = [];
$base = ['advertiser' => 'Crypto.Games', 'headline' => 'Crypto.Games: Bitcoin and altcoin casino', 'text' => 'Fast withdrawals, provably fair games, low house edge.',
  'cta' => 'Play now', 'dest' => 'https://crypto.games/', 'aff' => null, 'bg' => '#1D252A', 'fg' => '#FFFFFF', 'accent' => '#F7931A', 'gambling' => true];

$S = (array) doc('SIDE_ADS'); $i = null;
foreach ($S as $k => $a) if (($a['advertiser'] ?? '') === 'Crypto.Games') $i = $k;
$slot = 'right'; foreach ($S as $a) if (stripos((string) ($a['advertiser'] ?? ''), '1xbet') !== false && !empty($a['slot'])) $slot = $a['slot'];
if ($i === null) { $S[] = $base + ['id' => (int) max(array_merge([0], array_map(fn($a) => (int) ($a['id'] ?? 0), $S))) + 1, 'slot' => $slot, 'house' => false, 'paused' => false,
  'img' => null, 'full' => $side, 'start' => $now, 'end' => null]; $done[] = 'side slot'; }
else { $S[$i]['full'] = $side; $done[] = 'side slot (picture refreshed)'; }
save_doc('SIDE_ADS', array_values($S));

$P = (array) doc('POST_ADS'); $i = null;
foreach ($P as $k => $a) if (($a['advertiser'] ?? '') === 'Crypto.Games') $i = $k;
$sec = ['all']; foreach ($P as $a) if (stripos((string) ($a['advertiser'] ?? ''), '1xbet') !== false && !empty($a['sections'])) $sec = $a['sections'];
if ($i === null) { array_unshift($P, $base + ['id' => (int) max(array_merge([0], array_map(fn($a) => (int) ($a['id'] ?? 0), $P))) + 1, 'on' => true, 'house' => false,
  'sections' => $sec, 'img' => null, 'full' => $pc, 'fullM' => $ph, 'start' => $now, 'end' => null]); $done[] = 'under the first post'; }
else { $P[$i]['full'] = $pc; $P[$i]['fullM'] = $ph; $done[] = 'under the first post (pictures refreshed)'; }
save_doc('POST_ADS', array_values($P));
audit(null, 'Advertising change', 'Crypto.Games', 'Animated banners added by update', 'none', implode(', ', $done));
echo "ADS " . implode(', ', $done) . "\n";
