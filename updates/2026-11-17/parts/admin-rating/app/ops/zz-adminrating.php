<?php
// Pitchside Forum: Site admin rating. Admins give each casino or sportsbook their own score from 0 to 10.
// It counts as one part of the Safety Index ("Site admin rating", 20% by default) and is shown as such
// on every operator page and on the "How we rate" page. Casinos without one count as 5 out of 10.
declare(strict_types=1);

op('opscore.set', function (array $in, array $u) {
  if (!is_admin($u)) fail('Only admins can set the site admin rating.', 403);
  $slug = str_in($in, 'slug', 64);
  $r = row("SELECT data FROM operators WHERE slug = ?", [$slug]); if (!$r) fail('That casino or sportsbook no longer exists.');
  $d = jdec((string) $r['data'], []); if (!is_array($d)) fail('That listing looks damaged.');
  $prev = $d['adminScore'] ?? null;
  $raw = $in['score'] ?? null;
  if ($raw === null || $raw === '') { unset($d['adminScore']); $new = null; }
  else {
    if (!is_numeric($raw)) fail('Enter a score from 0 to 10.');
    $new = round((float) $raw * 2) / 2; if ($new < 0 || $new > 10) fail('Enter a score from 0 to 10.');
    $d['adminScore'] = $new;
  }
  q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [jenc($d), now_ms(), $slug]);
  audit($u, 'Site admin rating', $d['name'] ?? $slug, 'Admin rating changed', $prev === null ? 'not set' : "$prev/10", $new === null ? 'not set' : "$new/10");
  return ['slug' => $slug, 'score' => $new];
});
