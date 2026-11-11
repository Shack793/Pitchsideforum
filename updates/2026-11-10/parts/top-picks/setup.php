<?php
// Adds the partner listings that aren't in the directory yet (facts checked on regulator records, Nov 2026),
// then sets the Top picks order: 1xBet, Flush, BetWinner, Crypto.Games, CoinoRoyale, just.bet.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$now = now_ms();
$base = ['countries' => [], 'fiat' => false, 'poker' => false, 'kyc' => 'Not stated', 'claimed' => false, 'verified' => false, 'reps' => [], 'affiliate' => false, 'featured' => false,
  'warning' => null, 'size' => 'small', 'est' => null, 'minDeposit' => 'Not published', 'withdrawalLimit' => 'Not published', 'languages' => 'English', 'unfairTerms' => [], 'blacklist' => null, 'pendingClaim' => null];
$new = [
  ['slug' => 'flush', 'type' => 'casino', 'name' => 'Flush', 'website' => 'flush.com', 'owner' => 'Purple Dragon Ltd',
   'license' => 'Anjouan (AOFA) ALSI-202603027-FI1 (flush.io), Purple Dragon Ltd.', 'regulator' => 'anjouan', 'crypto' => true, 'sportsbook' => false, 'casino' => true,
   'withdrawals' => ['BTC', 'ETH', 'USDT'], 'color' => '#7C3AED', 'games' => 'Crypto casino',
   'pros' => ['Licence number published'], 'cons' => ['Offshore Anjouan licence with light player protection', 'Listed as unauthorised by 11 national regulators (flush.com, flush.casino)']],
  ['slug' => 'crypto-games', 'type' => 'casino', 'name' => 'Crypto.Games', 'website' => 'crypto.games', 'owner' => 'Not published',
   'license' => 'No licence found on regulator records (checked November 2026).', 'regulator' => 'none', 'crypto' => true, 'sportsbook' => false, 'casino' => true,
   'withdrawals' => ['BTC', 'ETH', 'LTC', 'USDT'], 'color' => '#0E7490', 'games' => 'Crypto casino and dice games',
   'pros' => ['Crypto-only, quick sign-up'], 'cons' => ['No licence on record', 'Listed as unauthorised by 8 national regulators']],
  ['slug' => 'coinroyale', 'type' => 'both', 'name' => 'CoinRoyale', 'website' => 'coinroyale.com', 'owner' => 'Not published',
   'license' => 'No licence shown on the site or found on regulator records (checked November 2026).', 'regulator' => 'none', 'crypto' => true, 'sportsbook' => true, 'casino' => true,
   'withdrawals' => ['BTC'], 'color' => '#B45309', 'games' => 'Bitcoin casino (blackjack, roulette, dice, slots, video poker), sports betting and prediction markets', 'est' => 2013,
   'pros' => ['Running since 2013', 'Provably fair games'], 'cons' => ['No licence on record', 'Bitcoin only', 'Listed as unauthorised by 3 national regulators']],
  ['slug' => 'justbet', 'type' => 'casino', 'name' => 'JustBet', 'website' => 'just.bet', 'owner' => 'Not published',
   'license' => 'No licence shown on the site or found on regulator records (checked November 2026).', 'regulator' => 'none', 'crypto' => true, 'sportsbook' => false, 'casino' => true,
   'withdrawals' => ['WINR (Arbitrum)'], 'color' => '#DB2777', 'games' => 'Crypto "creator casino": slots, blackjack, roulette, PvP poker and member-made games; bets in the WINR token on Arbitrum',
   'pros' => ['Provably fair, bets settled on-chain', 'Members can create and earn from games'], 'cons' => ['No licence on record', 'Operator company not published', 'Deposits and bets in its own WINR token']],
];
$norm = fn(string $s) => preg_replace('/[^a-z0-9]/', '', strtolower($s));
$all = fn() => array_map(fn($r) => ['slug' => $r['slug'], 'd' => jdec((string) $r['data'], [])], rows("SELECT slug, data FROM operators"));
$added = [];
foreach ($new as $o) {
  $have = false;
  foreach ($all() as $x) if ($x['slug'] === $o['slug'] || $norm((string) ($x['d']['name'] ?? '')) === $norm($o['name']) || $norm((string) ($x['d']['website'] ?? '')) === $norm($o['website'])) $have = true;
  if ($have) continue;
  insert('operators', ['slug' => $o['slug'], 'data' => jenc($base + $o), 'created' => $now, 'updated' => $now]);
  $added[] = $o['name'];
}
// Correction (Nov 2026): Crypto.Games shows a Curaçao Gaming Control Board licence on its site
// (MuchGaming B.V., OGL/2024/1336/1047), also listed by Casino Guru, so its listing is updated to match.
foreach ($all() as $x) {
  $n = $norm((string) ($x['d']['name'] ?? '')); $w = $norm((string) ($x['d']['website'] ?? ''));
  if ($x['slug'] !== 'crypto-games' && $n !== 'cryptogames' && $w !== 'cryptogames') continue;
  $d = $x['d'];
  if (($d['regulator'] ?? '') === 'curacao') continue;
  $d['regulator'] = 'curacao';
  $d['license'] = 'Curaçao Gaming Control Board, licence OGL/2024/1336/1047, held by MuchGaming B.V. (Willemstad, Curaçao).';
  $d['owner'] = 'MuchGaming B.V.';
  $d['cons'] = array_values(array_filter((array) ($d['cons'] ?? []), fn($c) => stripos((string) $c, 'licence') === false));
  $d['pros'] = array_values(array_unique(array_merge((array) ($d['pros'] ?? []), ['Curaçao GCB licence number published'])));
  q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [jenc($d), now_ms(), $x['slug']]);
  $added[] = 'Crypto.Games licence corrected';
}
// The top picks, in order; matched by slug, name or website
$wanted = [['1xBet', ['1xbet']], ['Flush', ['flush']], ['BetWinner', ['betwinner']], ['Crypto.Games', ['cryptogames']], ['CoinoRoyale', ['coinoroyale', 'coinsroyale', 'coinroyale']], ['just.bet', ['justbet']]];
$ops = $all(); $picks = []; $missing = [];
foreach ($wanted as [$label, $keys]) {
  $hit = null;
  foreach ($ops as $x) {
    $cands = [$norm($x['slug']), $norm((string) ($x['d']['name'] ?? '')), $norm(preg_replace('/\.(com|io|net|bet|games|casino|co)$/', '', (string) ($x['d']['website'] ?? '')))];
    if ($label === 'just.bet' && $x['slug'] !== 'justbet' && $norm((string) ($x['d']['website'] ?? '')) !== 'justbet' && stripos((string) ($x['d']['games'] ?? ''), 'WINR') === false) continue;   // not the Australian Justbet
    foreach ($keys as $k) if (in_array($k, $cands, true)) { $hit = $x['slug']; break 2; }
  }
  if ($hit) $picks[] = $hit; else $missing[] = $label;
}
$saved = tp_save($picks, null);
echo "ADDED " . (implode(', ', $added) ?: '-') . "\nPICKS " . implode(', ', $saved) . "\nMISSING " . (implode(', ', $missing) ?: '-') . "\n";
