<?php
// Special ranks (Admin → Forum): titles such as "Donor" or "VIP" that admins create and give to chosen members.
// The list lives in the SPECIAL_RANKS setting: [{id, name, color, members: [usernames]}]. Admins create, rename,
// recolour and delete them through the normal settings save; giving or taking one goes through here so the
// member is notified and it's recorded in the audit log.
declare(strict_types=1);

op('specialrank.member', function (array $in, array $u) {
  if (!can($u, 'manageCategories')) fail('Only admins can give special ranks.', 403);
  $id = str_in($in, 'id', 40); $name = str_in($in, 'user', 40); $on = bool_in($in, 'on');
  $t = row("SELECT name, status FROM users WHERE name = ?", [$name]); if (!$t || $t['status'] === 'deleted') fail("There's no member called “{$name}”.", 404);
  $ranks = doc('SPECIAL_RANKS'); $found = null;
  foreach ($ranks as &$r) if ((string) ($r['id'] ?? '') === $id) {
    $m = array_values(array_filter((array) ($r['members'] ?? []), 'is_string'));
    if ($on && in_array($t['name'], $m, true)) fail("{$t['name']} already has “{$r['name']}”.");
    if (!$on && !in_array($t['name'], $m, true)) fail("{$t['name']} doesn't have “{$r['name']}”.");
    $r['members'] = $on ? array_values(array_merge($m, [$t['name']])) : array_values(array_diff($m, [$t['name']]));
    if (count($r['members']) > 5000) fail('That special rank has too many members.');
    $found = $r; break;
  }
  unset($r);
  if (!$found) fail('That special rank no longer exists. Reload the page.', 404);
  save_doc('SPECIAL_RANKS', $ranks);
  audit($u, 'Special rank', $t['name'], $on ? "Given “{$found['name']}”" : "Removed “{$found['name']}”", $on ? 'without' : 'with', $on ? 'with' : 'without');
  if ($on) notify($t['name'], 'moderator', "You've been given the “{$found['name']}” rank. Thank you for being part of Pitchside!", "/members/{$t['name']}", $u);
  return ['ver' => (int) val("SELECT ver FROM config WHERE k = 'SPECIAL_RANKS'")];
});
