<?php
// Pitchside Forum: Top picks. The site's own Top picks section shows the "featured" listings, so saving the list
// marks exactly those listings as featured and un-features every other one. The list (in order) is also kept in
// the LAYOUT settings document as "topPicks" for Admin → Top picks.
declare(strict_types=1);

function tp_layout(): array { $v = val("SELECT v FROM config WHERE k = 'LAYOUT'"); $d = $v === null ? doc('LAYOUT') : jdec((string) $v, []); return is_array($d) && !isset($d[0]) ? $d : []; }
function tp_save(array $slugs, ?array $u): array {
  $ok = [];
  foreach ($slugs as $s) { $s = (string) $s; if ($s !== '' && !in_array($s, $ok, true) && val("SELECT 1 FROM operators WHERE slug = ?", [$s])) $ok[] = $s; }
  $ok = array_slice($ok, 0, 12);
  $lay = tp_layout(); $prev = $lay['topPicks'] ?? [];
  $lay['topPicks'] = $ok; save_doc('LAYOUT', $lay, $u['name'] ?? 'installer');
  $now = now_ms();
  foreach (rows("SELECT slug, data FROM operators") as $r) {
    $d = jdec((string) $r['data'], []); if (!is_array($d)) continue;
    $want = in_array($r['slug'], $ok, true);
    if (!empty($d['featured']) !== $want) { $d['featured'] = $want; q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [jenc($d), $now, $r['slug']]); }
  }
  audit($u, 'Top picks', 'Casinos & Sportsbooks page', 'Changed the top picks', implode(', ', (array) $prev) ?: 'none', implode(', ', $ok) ?: 'none');
  return $ok;
}
op('toppicks.save', function (array $in, array $u) {
  if (!is_admin($u)) fail('Only admins can change the top picks.', 403);
  return ['picks' => tp_save(array_values(array_filter((array) ($in['picks'] ?? []), 'is_string')), $u)];
});
