<?php
// Pitchside Forum: "Recommended by Pitchside" box on every casino and sportsbook page. Admins choose which listings
// it shows (Admin → Reviews → Recommended on every listing). Stored in LAYOUT.recommended. Page: recommended.1.js.
declare(strict_types=1);

function rec_layout(): array { $v = val("SELECT v FROM config WHERE k = 'LAYOUT'"); $d = $v === null ? doc('LAYOUT') : jdec((string) $v, []); return is_array($d) && !isset($d[0]) ? $d : []; }
function rec_save(array $slugs, ?array $u): array {
  $ok = [];
  foreach ($slugs as $s) { $s = (string) $s; if ($s !== '' && !in_array($s, $ok, true) && val("SELECT 1 FROM operators WHERE slug = ?", [$s])) $ok[] = $s; }
  $ok = array_slice($ok, 0, 6);
  $lay = rec_layout(); $prev = $lay['recommended'] ?? [];
  $lay['recommended'] = $ok; save_doc('LAYOUT', $lay, $u['name'] ?? 'installer');
  audit($u, 'Recommended casinos', 'Every listing', 'Recommended box updated', implode(', ', (array) $prev) ?: 'none', implode(', ', $ok) ?: 'none');
  return $ok;
}
op('recommended.set', function (array $in, array $u) {
  if (!is_admin($u)) fail('Only admins can change the recommended casinos.', 403);
  $list = $in['slugs'] ?? []; if (!is_array($list)) fail('Choose up to 6 casinos or sportsbooks.');
  return ['slugs' => rec_save(array_map('strval', $list), $u)];
});
