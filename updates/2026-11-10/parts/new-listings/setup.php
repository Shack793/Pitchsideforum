<?php
// Adds BiggerZ and Bets.io to the casino directory (facts checked November 2026). Listings that already exist
// (matched by short name, name or website) are left exactly as they are, so running it again changes nothing.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
$file = $argv[2] ?? __DIR__ . '/listings.json';
require $app . '/app/lib/api.php';
$have = [];
foreach (rows("SELECT slug, data FROM operators") as $r) { $d = jdec((string) $r['data'], []); $have[] = $r['slug']; $have[] = strtolower((string) ($d['name'] ?? '')); $have[] = strtolower(preg_replace('#^www\.#', '', (string) ($d['website'] ?? ''))); }
$added = []; $skipped = [];
foreach (json_decode((string) file_get_contents($file), true) ?: [] as $x) {
  if (array_intersect([$x['slug'], strtolower($x['name']), strtolower($x['website'])], $have)) { $skipped[] = $x['name']; continue; }
  $kind = $x['kind'] ?? 'both';
  op_save(array_merge(['reps' => [], 'claimed' => false, 'verified' => false, 'featured' => false, 'affiliate' => false, 'warning' => null, 'blacklist' => null, 'pendingClaim' => null,
    'countries' => [], 'logo' => null, 'images' => []], $x, ['type' => $kind === 'sportsbook' ? 'sportsbook' : 'casino', 'casino' => $kind !== 'sportsbook', 'sportsbook' => $kind !== 'casino']));
  $added[] = $x['name'];
}
if ($added) audit(null, 'Operator added', implode(', ', $added), 'Added to the casino directory', 'none', 'saved');
echo "ADDED " . (implode(', ', $added) ?: '-') . "\nSKIPPED " . (implode(', ', $skipped) ?: '-') . "\n";
