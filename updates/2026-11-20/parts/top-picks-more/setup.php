<?php
// Adds SportyBet, then sets the Top picks once: the admins' current top 6 stay as 1-6, SportyBet is 7th, then every
// bookmaker from the November 2026 list in that order. Runs only once (so later changes in Admin → Top picks stay).
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$norm = fn(string $s) => preg_replace('/[^a-z0-9]/', '', strtolower($s));
$all = fn() => array_map(fn($r) => ['slug' => $r['slug'], 'd' => jdec((string) $r['data'], [])], rows("SELECT slug, data FROM operators"));
$find = function (array $keys) use ($all, $norm) {
  foreach ($all() as $x) {
    $c = [$norm($x['slug']), $norm((string) ($x['d']['name'] ?? '')), $norm((string) ($x['d']['website'] ?? ''))];
    foreach ($keys as $k) if (in_array($norm($k), $c, true)) return $x['slug'];
  }
  return null;
};
$added = [];
if (!$find(['sportybet', 'sportybet.com'])) {
  op_save(['slug' => 'sportybet', 'name' => 'SportyBet', 'type' => 'sportsbook', 'casino' => true, 'sportsbook' => true, 'website' => 'sportybet.com', 'color' => '#E41827',
    'owner' => 'Sporty Group', 'license' => 'National licences in its African markets, including Ghana (Gaming Commission of Ghana), Nigeria and Kenya.', 'regulator' => 'africa',
    'size' => 'large', 'crypto' => false, 'fiat' => true, 'poker' => false, 'withdrawals' => ['Mobile money', 'Bank transfer'],
    'games' => 'Sportsbook with live betting, plus casino games', 'pros' => ['Licensed in its African markets', 'Mobile money deposits and withdrawals'], 'cons' => [], 'unfairTerms' => [],
    'reps' => [], 'claimed' => false, 'verified' => false, 'featured' => false, 'affiliate' => false, 'warning' => null, 'blacklist' => null, 'pendingClaim' => null, 'countries' => [], 'logo' => null, 'images' => []]);
  $added[] = 'SportyBet';
}
if (val("SELECT v FROM meta WHERE k = 'tp-bookmakers-2026-11'")) { echo "ADDED " . (implode(', ', $added) ?: '-') . "\nPICKS unchanged (already set once)\n"; exit; }
$cur = (array) (tp_layout()['topPicks'] ?? []);
$picks = array_slice($cur, 0, 6);
$want = [['SportyBet'], ['Betway'], ['Bovada'], ['bwin'], ['ComeOn'], ['Coral'], ['Dafabet'], ['Expekt'], ['Fonbet'], ['everygame', 'Intertops'], ['Interwetten'], ['ladbrokes.com'],
  ['Marathonbet'], ['Matchbook'], ['mybet.com'], ['NetBet'], ['NordicBet'], ['Paddy Power'], ['Pinnacle'], ['SBOBET'], ['Sportingbet'], ['sportsbet.com.au'], ['Superbet'], ['Tipico'],
  ['Unibet'], ['William Hill'], ['Winline'], ['10Bet'], ['188BET'], ['1xBet'], ['888sport'], ['bet-at-home'], ['bet365'], ['Betano'], ['BetCRIS'], ['Betfair'], ['Betfred'],
  ['BetOnline'], ['Betsafe'], ['Betsson'], ['BetVictor']];
$missing = [];
foreach ($want as $keys) { $s = $find($keys); if ($s) { if (!in_array($s, $picks, true)) $picks[] = $s; } else $missing[] = $keys[0]; }
$saved = tp_save($picks, null);
meta_set('tp-bookmakers-2026-11', (string) now_ms());
echo "ADDED " . (implode(', ', $added) ?: '-') . "\nPICKS " . count($saved) . " (top 6 kept: " . implode(', ', array_slice($saved, 0, 6)) . "; 7th: " . ($saved[6] ?? '-') . ")\nMISSING " . (implode(', ', $missing) ?: '-') . "\n";
