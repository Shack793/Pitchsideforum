<?php
// Private messages, group chats, contacting staff, blocking, notifications.
declare(strict_types=1);

function conv_of(int $id, array $u): array {
  $c = row("SELECT c.* FROM convs c JOIN conv_members m ON m.conv_id = c.id AND m.user = ? WHERE c.id = ?", [$u['name'], $id]);
  if (!$c) fail("That conversation isn't yours.", 404);
  $c['members'] = array_map(fn($r) => $r['user'], rows("SELECT user FROM conv_members WHERE conv_id = ? ORDER BY pos", [$id]));
  return $c;
}
function blocked(string $blocker, string $blocked): bool { return (bool) val("SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?", [$blocker, $blocked]); }
// Same rules the browser shows: who may message whom.
function dm_problem(array $u, string $target): ?string {
  if ($target === $u['name']) return "That's you.";
  $t = user_by_name($target); if (!$t || $t['status'] === 'deleted') return "There's no member called $target.";
  $toStaff = in_array($t['role'], STAFF_ROLES, true); $fromStaff = is_staff($u);
  if (!can($u, 'pm') && !$toStaff) return $u['status'] !== 'active' ? "Your account is {$u['status']}. You can still message moderators and admins." : (needs_verify($u) ? 'Confirm your email address before messaging members. You can still message moderators and admins.' : "Your account can't message other members yet. You can still message moderators and admins.");
  if (blocked($u['name'], $target)) return "You blocked $target. Unblock them to send messages.";
  if (blocked($target, $u['name']) && !$fromStaff) return "$target isn't accepting messages from you.";
  $dms = $t['profile']['privacy']['dms'] ?? 'members';
  if (!$fromStaff && !$toStaff) {
    if ($dms === 'nobody') return "$target has turned off private messages.";
    if ($dms === 'staff') return "$target only accepts messages from moderators and admins.";
    if ($t['status'] !== 'active') return "$target's account is {$t['status']}.";
  }
  if ($fromStaff && !$toStaff && $dms !== 'members' && !mp($u, 'dm.anyone')) return "$target has DMs off, and your moderator permissions don't include messaging members with DMs off.";
  return null;
}
function pm_limit_check(array $u, array $others): void {
  $toMembers = array_filter($others, fn($m) => !is_staff_name($m));
  $limit = (int) (doc('LIMITS')['newPmsPerDay'] ?? 5);
  if ($toMembers && restricted($u, 'pm') && daily_count($u['name'], 'pm') >= $limit) fail("New members can message $limit members a day. Messages to moderators and admins don't count.");
}
function att_in(array $in, array $u): array {
  $out = [];
  foreach (array_slice(arr_in($in, 'att'), 0, 10) as $a) {
    $id = (int) ($a['id'] ?? 0); $f = row("SELECT * FROM uploads WHERE id = ? AND user = ?", [$id, $u['name']]);
    if ($f) $out[] = ['id' => (int) $f['id'], 'name' => $f['name'], 'size' => $f['bytes'] > 1e6 ? round($f['bytes'] / 1e6, 1) . ' MB' : max(1, (int) round($f['bytes'] / 1e3)) . ' KB', 'url' => '/api/file/' . $f['id']];
  }
  return $out;
}
function add_msg(array $c, array $u, string $body, array $att, bool $notice = false): int {
  $now = now_ms();
  $id = insert('msgs', ['conv_id' => $c['id'], 'from_user' => $u['name'], 'body' => $body, 'at' => $now, 'att' => jenc($att), 'notice' => $notice ? 1 : 0, 'reported' => 0]);
  $n = (int) val("SELECT COUNT(*) FROM msgs WHERE conv_id = ?", [$c['id']]);
  q("UPDATE conv_members SET read_n = ? WHERE conv_id = ? AND user = ?", [$n, $c['id'], $u['name']]);
  q("UPDATE convs SET updated = ? WHERE id = ?", [$now, $c['id']]);
  $group = count($c['members']) > 2 || $c['title'];
  foreach ($c['members'] as $m) if ($m !== $u['name'])
    notify($m, $notice ? 'moderator' : 'message', $notice ? "Official moderator notice from {$u['name']}" : "{$u['name']} sent you a message" . ($group ? ' in “' . ($c['title'] ?: 'a group chat') . '”' : ''), "/messages/{$c['id']}", $u);
  if ($notice) audit($u, 'Moderator notice', 'to ' . implode(', ', array_diff($c['members'], [$u['name']])), mb_substr($body, 0, 80), '—', 'sent');
  return $id;
}
function new_conv(array $members, ?string $title, ?string $kind): array {
  $now = now_ms();
  $id = insert('convs', ['title' => $title, 'kind' => $kind, 'created' => $now, 'updated' => $now]);
  foreach (array_values($members) as $i => $m) insert('conv_members', ['conv_id' => $id, 'user' => $m, 'read_n' => 0, 'pos' => $i]);
  return ['id' => $id, 'title' => $title, 'kind' => $kind, 'members' => array_values($members)];
}
function find_direct(string $a, string $b): ?array {
  $id = val("SELECT c.id FROM convs c JOIN conv_members x ON x.conv_id = c.id AND x.user = ? JOIN conv_members y ON y.conv_id = c.id AND y.user = ?
    WHERE c.title IS NULL AND (SELECT COUNT(*) FROM conv_members z WHERE z.conv_id = c.id) = 2 ORDER BY c.updated DESC LIMIT 1", [$a, $b]);
  return $id ? ['id' => (int) $id, 'title' => null, 'kind' => null, 'members' => [$a, $b]] : null;
}

// New message: one member (direct), several (group), or staff (kind "staff").
op('conv.create', function (array $in, array $u) {
  rate_limit('conv:' . $u['name'], 30, 3600, "You've started a lot of conversations this hour. Try again later.");
  $names = array_values(array_unique(array_filter(array_map(fn($n) => ltrim(trim((string) $n), '@'), arr_in($in, 'to')))));
  $others = array_values(array_filter($names, fn($n) => $n !== $u['name']));
  if (!$others) fail('Add at least one member to send to.');
  if (count($others) > 30) fail('Group chats can have up to 30 people.');
  $staff = str_in($in, 'kind', 10) === 'staff';
  foreach ($others as $o) {
    if ($staff) { if (!is_staff_name($o)) fail("$o isn't a member of staff."); if (blocked($u['name'], $o)) fail("You blocked $o."); }
    elseif ($pr = dm_problem($u, $o)) fail($pr);
  }
  $body = str_in($in, 'body', 10000); $att = att_in($in, $u); $title = str_in($in, 'title', 120) ?: null;
  if ($body === '' && !$att && !$staff) fail('Write a message or attach a file.');
  if ($body !== '') need_ok(content_problem($u, $body));
  if (!$staff) pm_limit_check($u, $others);
  $c = null;
  if (count($others) === 1 && !$title) $c = find_direct($u['name'], $others[0]);
  if (!$c && $staff && $title) {
    $id = val("SELECT c.id FROM convs c JOIN conv_members m ON m.conv_id = c.id AND m.user = ? WHERE c.kind = 'staff' AND c.title = ? ORDER BY c.updated DESC LIMIT 1", [$u['name'], $title]);
    if ($id) { $c = conv_of((int) $id, $u); foreach ($others as $o) if (!in_array($o, $c['members'], true)) { insert('conv_members', ['conv_id' => $c['id'], 'user' => $o, 'read_n' => 0, 'pos' => count($c['members'])]); $c['members'][] = $o; } }
  }
  if (!$c) $c = new_conv(array_merge([$u['name']], $others), count($others) > 1 || $title ? $title : null, $staff || !array_filter($others, fn($o) => !is_staff_name($o)) ? 'staff' : null);
  if ($body !== '' || $att) add_msg($c, $u, $body, $att);
  return ['id' => $c['id']];
});

op('msg.send', function (array $in, array $u) {
  $c = conv_of(int_in($in, 'conv'), $u);
  rate_limit('msg:' . $u['name'], 40, 60, 'Slow down a little: you can send more in a minute.');
  $body = str_in($in, 'body', 10000); $att = att_in($in, $u);
  if ($body === '' && !$att) fail('Write a message or attach a file.');
  $others = array_values(array_diff($c['members'], [$u['name']]));
  $group = count($c['members']) > 2 || $c['title'];
  $hasStaff = (bool) array_filter($others, 'is_staff_name');
  if ($group) { if (!can($u, 'pm') && !$hasStaff) fail($u['status'] !== 'active' ? "Your account is {$u['status']}. You can still message moderators and admins." : "Your account can't message other members."); }
  else { if (!$others) fail('Everyone else has left this conversation.'); if ($pr = dm_problem($u, $others[0])) fail($pr); }
  pm_limit_check($u, $others);
  if ($body !== '') need_ok(content_problem($u, $body));
  $notice = bool_in($in, 'notice') && mp($u, 'dm.notice');
  return ['id' => add_msg($c, $u, $body, $att, $notice)];
});

op('conv.add', function (array $in, array $u) {
  $c = conv_of(int_in($in, 'conv'), $u);
  $names = array_values(array_unique(array_filter(array_map(fn($n) => ltrim(trim((string) $n), '@'), arr_in($in, 'users')))));
  if (!$names) fail('Add at least one username.');
  if (count($c['members']) + count($names) > 31) fail('Group chats can have up to 30 people.');
  foreach ($names as $n) if ($n !== $u['name'] && !in_array($n, $c['members'], true) && ($pr = dm_problem($u, $n))) fail($pr);
  $pos = count($c['members']);
  foreach ($names as $n) if (!in_array($n, $c['members'], true)) { insert('conv_members', ['conv_id' => $c['id'], 'user' => $n, 'read_n' => 0, 'pos' => $pos++]);
    notify($n, 'message', "{$u['name']} added you to “" . ($c['title'] ?: 'Group chat') . '”', "/messages/{$c['id']}", $u); }
  q("UPDATE convs SET title = COALESCE(title, 'Group chat'), updated = ? WHERE id = ?", [now_ms(), $c['id']]);
  return [];
});

op('conv.rename', function (array $in, array $u) {
  $c = conv_of(int_in($in, 'conv'), $u); $t = str_in($in, 'title', 120);
  if ($t === '') return [];
  q("UPDATE convs SET title = ?, updated = ? WHERE id = ?", [$t, now_ms(), $c['id']]);
  return [];
});

op('conv.leave', function (array $in, array $u) {
  $c = conv_of(int_in($in, 'conv'), $u);
  q("DELETE FROM conv_members WHERE conv_id = ? AND user = ?", [$c['id'], $u['name']]);
  if (!val("SELECT 1 FROM conv_members WHERE conv_id = ?", [$c['id']])) { q("DELETE FROM msgs WHERE conv_id = ?", [$c['id']]); q("DELETE FROM convs WHERE id = ?", [$c['id']]); }
  else q("UPDATE convs SET updated = ? WHERE id = ?", [now_ms(), $c['id']]);
  return [];
});

op('msg.delete', function (array $in, array $u) {
  $c = conv_of(int_in($in, 'conv'), $u);
  $m = row("SELECT * FROM msgs WHERE id = ? AND conv_id = ?", [int_in($in, 'msg'), $c['id']]);
  if (!$m) return [];
  if ($m['from_user'] !== $u['name']) fail('You can only delete your own messages.', 403);
  $idx = (int) val("SELECT COUNT(*) FROM msgs WHERE conv_id = ? AND id < ?", [$c['id'], $m['id']]);
  q("DELETE FROM msgs WHERE id = ?", [$m['id']]);
  q("UPDATE conv_members SET read_n = read_n - 1 WHERE conv_id = ? AND read_n > ?", [$c['id'], $idx]);
  q("UPDATE convs SET updated = ? WHERE id = ?", [now_ms(), $c['id']]);
  return [];
});

op('conv.read', function (array $in, array $u) {
  $c = conv_of(int_in($in, 'conv'), $u);
  $n = (int) val("SELECT COUNT(*) FROM msgs WHERE conv_id = ?", [$c['id']]);
  if (q("UPDATE conv_members SET read_n = ? WHERE conv_id = ? AND user = ? AND read_n <> ?", [$n, $c['id'], $u['name'], $n])->rowCount()) q("UPDATE convs SET updated = ? WHERE id = ?", [now_ms(), $c['id']]);
  return [];
});

op('block.toggle', function (array $in, array $u) {
  $t = str_in($in, 'user', 40);
  if ($t === $u['name']) fail("You can't block yourself.");
  if (!val("SELECT 1 FROM users WHERE name = ?", [$t])) fail("There's no member called $t.");
  if (q("DELETE FROM blocks WHERE blocker = ? AND blocked = ?", [$u['name'], $t])->rowCount()) return ['on' => false];
  insert_ignore('blocks', ['blocker' => $u['name'], 'blocked' => $t]); touch_user($t);
  return ['on' => true];
});

op('notif.readAll', function (array $in, array $u) { q("UPDATE notifs SET is_read = 1, updated = ? WHERE to_user = ? AND is_read = 0", [now_ms(), $u['name']]); return []; });
op('notif.read', function (array $in, array $u) { q("UPDATE notifs SET is_read = 1, updated = ? WHERE to_user = ? AND id = ?", [now_ms(), $u['name'], int_in($in, 'id')]); return []; });
