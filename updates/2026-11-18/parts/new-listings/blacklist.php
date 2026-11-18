<?php
// Not blacklisted yet: BiggerZ, Bets.io, Gamba and BetPanda get a chance to explain first.
// If an earlier version of this update already blacklisted them, that blacklisting is undone here
// (only the entries this update wrote, recognised by their summary, are touched).
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$undone = [];
foreach (['biggerz', 'bets-io', 'gamba', 'betpanda'] as $slug) {
  $r = row("SELECT data FROM operators WHERE slug = ?", [$slug]); if (!$r) continue;
  $o = jdec((string) $r['data'], []); $o['slug'] = $slug;
  $bl = $o['blacklist'] ?? null;
  if (!is_array($bl) || !str_starts_with((string) ($bl['note'] ?? ''), 'Blacklisted by Pitchside.') || !str_ends_with((string) ($bl['note'] ?? ''), 'Avoid depositing.')) continue;
  $o['blacklist'] = null; op_save($o);
  audit(null, 'Operator removed from blacklist', $o['name'] ?? $slug, 'Giving the operator a chance to explain first', 'blacklisted', 'listed');
  $undone[] = $o['name'] ?? $slug;
}
echo "BLACKLISTED -\nALREADY -\nUNDONE " . (implode(', ', $undone) ?: '-') . "\n";
