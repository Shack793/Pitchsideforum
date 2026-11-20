<?php
// Crypto section: three boards instead of one per coin.
//   Cryptocurrency Discussion (new, slug crypto-discussion): every coin board's topics move here
//   Crypto Casinos & Sportsbooks (the old "Crypto Gambling" board, same address)
//   Crypto Trading & Investments (new, slug crypto-trading)
// Old coin board addresses keep working: they forward to Cryptocurrency Discussion (saved in BOARD_MOVED).
// Topics, follows and reports move with their board. Nothing is deleted except the empty old board entries.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$B = doc('BOARDS');
$DISC = 'crypto-discussion'; $GAMB = 'crypto-gambling'; $TRADE = 'crypto-trading';
$isCrypto = fn($b) => ($b['cat'] ?? '') === 'crypto';
$tpl = null; foreach ($B as $b) if ($isCrypto($b) && ($b['slug'] ?? '') === $GAMB) $tpl = $b;
if (!$tpl) foreach ($B as $b) if ($isCrypto($b)) { $tpl = $b; break; }
if (!$tpl) { echo "CRYPTO no crypto boards found, nothing changed\n"; exit; }
$want = [
  $DISC  => ['Cryptocurrency Discussion', 'Bitcoin, Ethereum, altcoins, blockchain, market news and general crypto discussion', 'C', 1],
  $GAMB  => ['Crypto Casinos & Sportsbooks', 'Crypto gambling sites, sportsbook discussions, bonuses, experiences and operator reviews', 'C', 2],
  $TRADE => ['Crypto Trading & Investments', 'Trading strategies, market analysis, DeFi, investment discussions and opportunities', 'T', 3],
];
$old = []; $mods = [];
foreach ($B as $b) if ($isCrypto($b) && !isset($want[$b['slug']])) { $old[] = $b['slug']; $mods = array_merge($mods, (array) ($b['mods'] ?? [])); }
$out = []; $have = [];
foreach ($B as $b) {
  if ($isCrypto($b) && in_array($b['slug'], $old, true)) continue;
  if ($isCrypto($b) && isset($want[$b['slug']])) {
    [$n, $d, $i, $o] = $want[$b['slug']];
    $b['name'] = $n; $b['desc'] = $d; $b['order'] = $o; $b['parent'] = null; unset($b['coin']);
    if ($b['slug'] === $DISC && $mods) $b['mods'] = array_values(array_unique(array_merge((array) ($b['mods'] ?? []), $mods)));
    $have[$b['slug']] = true;
  }
  $out[] = $b;
}
foreach ($want as $slug => [$n, $d, $i, $o]) if (empty($have[$slug])) {
  $nb = ['slug' => $slug, 'name' => $n, 'desc' => $d, 'cat' => 'crypto', 'parent' => null, 'icon' => $i,
    'mods' => $slug === $DISC ? array_values(array_unique($mods)) : [], 'readRoles' => $tpl['readRoles'] ?? [], 'postRoles' => $tpl['postRoles'] ?? [], 'order' => $o];
  $out[] = $nb;
}
$moved = 0;
if ($old) {
  $moved = q("UPDATE topics SET board = ? WHERE board IN (" . in_list($old) . ")", array_merge([$DISC], $old))->rowCount();
  try { q("UPDATE reports SET board = ? WHERE board IN (" . in_list($old) . ")", array_merge([$DISC], $old)); } catch (Throwable $e) {}
  foreach ($old as $s) {
    foreach (rows("SELECT user FROM follows WHERE k = ?", ["board:$s"]) as $r) insert_ignore('follows', ['user' => $r['user'], 'k' => "board:$DISC"]);
    q("DELETE FROM follows WHERE k = ?", ["board:$s"]);
  }
}
save_doc('BOARDS', $out);
$M = doc('BOARD_MOVED'); if (!is_array($M)) $M = [];
foreach ($old as $s) $M[$s] = $DISC;
foreach ($M as $k => $v) if (in_array($v, $old, true)) $M[$k] = $DISC;
if ($old) save_doc('BOARD_MOVED', $M);
// The ticker line "a board for every major coin" is no longer true
$T = doc('TICKER');
if (!empty($T['items']) && is_array($T['items'])) {
  $n0 = count($T['items']);
  $T['items'] = array_values(array_filter($T['items'], fn($x) => stripos((string) ($x['text'] ?? ''), 'board for every major coin') === false));
  if (count($T['items']) !== $n0) save_doc('TICKER', $T);
}
if (function_exists('audit') && $old) audit(null, 'Boards', 'Crypto', 'Merged coin boards', implode(', ', $old), $DISC);
// AI accounts are not changed. Count any that were set to post only on a merged board, so the owner knows.
$ai = 0;
try { foreach (rows("SELECT profile_json FROM ai_characters WHERE active = 1") as $r) { $p = jdec((string) $r['profile_json'], []);
  if (array_intersect((array) ($p['behaviour']['allowed_boards'] ?? []), $old)) $ai++; } } catch (Throwable $e) {}
echo "CRYPTO merged " . count($old) . " boards, moved $moved topics\nAI $ai\n";
