<?php
// Pitchside Forum: penalty points. Admins can take points straight off a casino's or sportsbook's Safety Index
// (0 to 10 points, in half points), with a short reason that's shown to visitors under "What lowers it".
// Set in Admin → Reviews → Penalty points. Page side: public/assets/penalty.1.js.
declare(strict_types=1);

op('oppenalty.set', function (array $in, array $u) {
  if (!is_admin($u)) fail('Only admins can set penalty points.', 403);
  $slug = str_in($in, 'slug', 64);
  $r = row("SELECT data FROM operators WHERE slug = ?", [$slug]); if (!$r) fail('That casino or sportsbook no longer exists.');
  $d = jdec((string) $r['data'], []); if (!is_array($d)) fail('That listing looks damaged.');
  $prev = isset($d['penalty']) ? (float) $d['penalty'] : 0.0;
  $raw = $in['points'] ?? null;
  if ($raw === null || $raw === '' || (is_numeric($raw) && (float) $raw == 0.0)) { unset($d['penalty'], $d['penaltyReason']); $new = 0.0; $why = ''; }
  else {
    if (!is_numeric($raw)) fail('Enter points from 0 to 10.');
    $new = round((float) $raw * 2) / 2; if ($new < 0 || $new > 10) fail('Enter points from 0 to 10.');
    $why = trim(preg_replace('/\s+/u', ' ', (string) ($in['reason'] ?? '')) ?? '');
    if ($why === '') fail('Add a short reason. Visitors see it under "What lowers it".');
    if (mb_strlen($why) > 160) fail('Keep the reason under 160 characters.');
    $d['penalty'] = $new; $d['penaltyReason'] = $why;
  }
  q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [jenc($d), now_ms(), $slug]);
  audit($u, 'Penalty points', $d['name'] ?? $slug, $why !== '' ? $why : 'Penalty removed', $prev ? "-$prev" : 'none', $new ? "-$new" : 'none');
  return ['slug' => $slug, 'points' => $new, 'reason' => $why];
});
