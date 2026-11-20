<?php
// Tennis in one place: one "Tennis" board with sub-boards for ATP Tour, WTA Tour, ITF, Grand Slams and
// Davis Cup & Billie Jean King Cup, and one "Tennis" entry on the Sports page instead of separate ATP and WTA ones.
// Old /leagues/atp and /leagues/wta addresses forward to /leagues/tennis (LEAGUE_MOVED). Topics, follows and match
// links move with them. Nothing is deleted.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$B = doc('BOARDS'); $idx = []; foreach ($B as $i => $b) $idx[$b['slug']] = $i;
$main = $idx['tennis'] ?? null;
if ($main === null) { echo "TENNIS no tennis board found, nothing changed\n"; exit; }
$B[$main]['name'] = 'Tennis'; $B[$main]['desc'] = 'ATP, WTA, ITF, Grand Slams and team events'; $B[$main]['parent'] = null;
$tpl = $B[$main];
$subs = [['atp', 'ATP Tour', "Men's tour: ATP 250 to Masters 1000 and the Finals"], ['wta', 'WTA Tour', "Women's tour: WTA 250 to 1000 and the Finals"],
  ['grand-slams', 'Grand Slams', 'Australian Open, Roland-Garros, Wimbledon and the US Open'], ['itf', 'ITF', 'ITF World Tennis Tour, juniors and Challengers'],
  ['davis-bjk-cup', 'Davis Cup & Billie Jean King Cup', 'Nations team events']];
$added = [];
foreach ($subs as $o => [$slug, $name, $desc]) {
  if (isset($idx[$slug])) { $i = $idx[$slug]; if (($B[$i]['cat'] ?? '') !== 'sports') continue; $B[$i]['parent'] = 'tennis'; $B[$i]['name'] = $name; $B[$i]['desc'] = $desc; $B[$i]['order'] = $o + 1; continue; }
  $B[] = ['slug' => $slug, 'name' => $name, 'desc' => $desc, 'cat' => 'sports', 'parent' => 'tennis', 'icon' => strtoupper($name[0]), 'mods' => [],
    'readRoles' => $tpl['readRoles'] ?? [], 'postRoles' => $tpl['postRoles'] ?? [], 'order' => $o + 1];
  $added[] = $name;
}
// keep the sub-boards in this order, straight after the Tennis board
$order = array_column($subs, 0); $pick = []; $rest = [];
foreach ($B as $b) { if (($b['parent'] ?? null) === 'tennis' && in_array($b['slug'], $order, true)) $pick[$b['slug']] = $b; else $rest[] = $b; }
$B = [];
foreach ($rest as $b) { $B[] = $b; if ($b['slug'] === 'tennis') foreach ($order as $s) if (isset($pick[$s])) $B[] = $pick[$s]; }
save_doc('BOARDS', $B);
// One league entry for tennis
$L = doc('LEAGUES'); $out = []; $old = []; $placed = false; $season = '2026';
foreach ($L as $l) {
  if (($l['sport'] ?? '') === 'tennis' && ($l['slug'] ?? '') !== 'tennis') { $old[] = $l['slug']; $season = $l['season'] ?? $season;
    if (!$placed) { $out[] = ['slug' => 'tennis', 'name' => 'Tennis', 'sport' => 'tennis', 'region' => $l['region'] ?? 'International', 'country' => $l['country'] ?? 'World',
      'type' => 'tour', 'season' => $season, 'board' => 'tennis', 'logo' => null]; $placed = true; }
    continue; }
  if (($l['slug'] ?? '') === 'tennis') { $l['board'] = 'tennis'; $placed = true; }
  $out[] = $l;
}
if ($old) {
  save_doc('LEAGUES', $out);
  q("UPDATE topics SET league = 'tennis' WHERE league IN (" . in_list($old) . ")", $old);
  foreach ($old as $s) { foreach (rows("SELECT user FROM follows WHERE k = ?", ["league:$s"]) as $r) insert_ignore('follows', ['user' => $r['user'], 'k' => 'league:tennis']); q("DELETE FROM follows WHERE k = ?", ["league:$s"]); }
  $E = doc('EVENTS'); $ch = false; foreach ($E as &$e) if (in_array($e['league'] ?? '', $old, true)) { $e['league'] = 'tennis'; $ch = true; } unset($e); if ($ch) save_doc('EVENTS', $E);
  $T = doc('TEAMS'); $ch = false; foreach ($T as &$t) if (in_array($t['league'] ?? '', $old, true)) { $t['league'] = 'tennis'; $ch = true; } unset($t); if ($ch) save_doc('TEAMS', $T);
  $M = doc('LEAGUE_MOVED'); if (!is_array($M)) $M = []; foreach ($old as $s) $M[$s] = 'tennis'; save_doc('LEAGUE_MOVED', $M);
}
if (function_exists('audit')) audit(null, 'Boards', 'Tennis', 'One tennis board with sub-boards', implode(', ', $old) ?: '—', 'tennis');
echo "TENNIS merged " . (implode(', ', $old) ?: 'nothing') . "; new sub-boards: " . (implode(', ', $added) ?: 'none') . "\n";
