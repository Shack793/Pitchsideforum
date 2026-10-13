<?php
// Reports, the moderation queue, member actions, appeals and roles.
declare(strict_types=1);

const HIDE_PERM = ['post' => 'post.hide', 'topic' => 'topic.delete', 'message' => 'queue.abuse'];

function target_user(string $name): array { $t = user_by_name($name); if (!$t || $t['status'] === 'deleted') fail("There's no member called $name.", 404); return $t; }
// Staff can't act on people above them: moderators can't act on staff, admins can't act on Super Admins.
function can_act_on(array $actor, array $target): bool {
  if ($actor['id'] === $target['id']) return false;
  if ($target['role'] === 'super_admin') return $actor['role'] === 'super_admin';
  if ($target['role'] === 'admin') return $actor['role'] === 'super_admin';
  if (in_array($target['role'], STAFF_ROLES, true)) return is_admin($actor) || ($actor['role'] === 'senior_moderator' && $target['role'] === 'moderator');
  return true;
}
function set_status(array $actor, array $t, string $action, string $reason): void {
  $prev = $t['status']; $now = now_ms();
  if ($action === 'warn') {
    q("UPDATE users SET warnings = warnings + 1, updated = ? WHERE id = ?", [$now, $t['id']]);
    audit($actor, 'Warning', $t['name'], $reason, (string) $t['warnings'] . ' warnings', ($t['warnings'] + 1) . ' warnings');
    notify($t['name'], 'moderator', "You received a warning: $reason", "/members/{$t['name']}", $actor);
  } elseif ($action === 'suspend') {
    $d = suspend_days($actor);
    q("UPDATE users SET status = 'suspended', suspended_until = ?, updated = ? WHERE id = ?", [$now + $d * DAY_MS, $now, $t['id']]);
    audit($actor, 'Suspended user', $t['name'], "$reason ($d days)", $prev, 'suspended');
    notify($t['name'], 'moderator', "Your account is suspended for $d days: $reason. You can appeal from your profile.", "/members/{$t['name']}", $actor);
  } elseif ($action === 'ban') {
    q("UPDATE users SET status = 'banned', suspended_until = NULL, updated = ? WHERE id = ?", [$now, $t['id']]);
    q("DELETE FROM sessions WHERE user_id = ? AND pending_2fa = 1", [$t['id']]);
    audit($actor, 'Banned user', $t['name'], $reason, $prev, 'banned');
    notify($t['name'], 'moderator', "Your account is banned: $reason. You can appeal from your profile.", "/members/{$t['name']}", $actor);
  } elseif ($action === 'restore') {
    q("UPDATE users SET status = 'active', suspended_until = NULL, updated = ? WHERE id = ?", [$now, $t['id']]);
    audit($actor, 'Restored user', $t['name'], $reason, $prev, 'active');
    notify($t['name'], 'moderator', 'Your account is active again.', "/members/{$t['name']}", $actor);
  } elseif ($action === 'verify') {
    q("UPDATE users SET email_verified = 1, updated = ? WHERE id = ?", [$now, $t['id']]);
    audit($actor, 'Email verified', $t['name'], $reason, 'unverified', 'verified');
  }
}

op('report.create', function (array $in, array $u) {
  rate_limit('report:' . $u['name'], 30, 3600, "You've sent a lot of reports this hour. Moderators will get to them.");
  $kind = str_in($in, 'kind', 16); $why = str_in($in, 'why', 60); $details = str_in($in, 'details', 1000);
  $reasons = ['Spam', 'Abuse or harassment', 'Scam or fraud', 'Off-topic', 'Misinformation', 'Copyright', 'Other'];
  if (!in_array($why, $reasons, true)) $why = 'Other';
  $reason = mb_substr($why . ($details !== '' ? ": $details" : ''), 0, 1000);
  $queue = $why === 'Spam' ? 'spam' : ($why === 'Scam or fraud' ? 'scam' : ($kind === 'message' || $why === 'Abuse or harassment' ? 'abuse' : 'reports'));
  $target = []; $board = null;
  if ($kind === 'post' || $kind === 'topic') {
    $t = readable_topic(int_in($in, 'topic'), $u); $board = $t['board'];
    $target = ['topic' => (int) $t['id'], 'post' => int_in($in, 'post') ?: null];
    if ($target['post']) post_row((int) $t['id'], $target['post']);
  } elseif ($kind === 'message') {
    $m = row("SELECT m.id, m.conv_id FROM msgs m JOIN conv_members c ON c.conv_id = m.conv_id AND c.user = ? WHERE m.id = ?", [$u['name'], int_in($in, 'msg')]);
    if (!$m) fail("You can only report messages in your own conversations.", 403);
    q("UPDATE msgs SET reported = 1 WHERE id = ?", [$m['id']]); q("UPDATE convs SET updated = ? WHERE id = ?", [now_ms(), $m['conv_id']]);
    $target = ['conv' => (int) $m['conv_id'], 'msg' => (int) $m['id']];
  } elseif ($kind === 'user') {
    $t = target_user(str_in($in, 'user', 40)); $target = ['user' => $t['name']];
  } else fail("That can't be reported here yet.");
  insert('reports', ['queue' => $queue, 'kind' => $kind, 'target' => jenc($target), 'board' => $board, 'reason' => $reason, 'by_user' => $u['name'], 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
  return [];
});

op('report.resolve', function (array $in, array $u) {
  $r = row("SELECT * FROM reports WHERE id = ?", [int_in($in, 'id')]);
  if (!$r || !is_staff($u) || !report_visible($r, $u)) fail("That report isn't in your queues.", 403);
  if ($r['status'] !== 'open') fail('Someone already handled this report.');
  $op = str_in($in, 'do', 20); $reason = str_in($in, 'reason', 1000);
  if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $t = jdec($r['target'], []); $author = null;
  if (in_array($r['kind'], ['post', 'topic'], true)) {
    $tp = row("SELECT * FROM topics WHERE id = ?", [(int) ($t['topic'] ?? 0)]);
    if ($tp) { $p = !empty($t['post']) ? row("SELECT * FROM posts WHERE id = ?", [(int) $t['post']]) : row("SELECT * FROM posts WHERE topic_id = ? ORDER BY " . ($r['kind'] === 'post' ? 'at DESC, id DESC' : 'at, id') . " LIMIT 1", [$tp['id']]);
      $author = $p ? $p['author'] : $tp['author']; }
  } elseif ($r['kind'] === 'message') { $author = val("SELECT from_user FROM msgs WHERE id = ?", [(int) ($t['msg'] ?? 0)]); }
  elseif ($r['kind'] === 'user' || $r['kind'] === 'appeal') { $author = $t['user'] ?? null; }
  $au = $author ? user_by_name((string) $author) : null;
  $now = now_ms();
  switch ($op) {
    case 'hide':
      need_mp($u, HIDE_PERM[$r['kind']] ?? 'post.hide', $r['board']);
      if ($r['kind'] === 'post' && !empty($tp)) { if (!empty($p)) q("UPDATE posts SET hidden = 1 WHERE id = ?", [$p['id']]); touch_topic((int) $tp['id']); }
      if ($r['kind'] === 'topic' && !empty($tp)) q("UPDATE topics SET deleted = 1, updated = ? WHERE id = ?", [$now, $tp['id']]);
      if ($r['kind'] === 'message') { q("UPDATE msgs SET body = '[Removed by a moderator]', att = '[]' WHERE id = ?", [(int) $t['msg']]); q("UPDATE convs SET updated = ? WHERE id = ?", [$now, (int) $t['conv']]); }
      audit($u, 'Hide content', "{$r['kind']} (report #{$r['id']})", $reason, 'visible', 'hidden');
      break;
    case 'warn': case 'suspend': case 'ban':
      need_mp($u, "user.$op"); if (!$au) fail('The author no longer exists.');
      if (!can_act_on($u, $au)) fail("You can't take this action on {$au['name']}.", 403);
      set_status($u, $au, $op, $reason); break;
    case 'resolveOnly': case 'dismiss':
      audit($u, $op === 'dismiss' ? 'Dismiss report' : 'Resolve report', "report #{$r['id']}", $reason, 'open', $op === 'dismiss' ? 'dismissed' : 'resolved'); break;
    case 'upholdAppeal': case 'denyAppeal':
      need_mp($u, 'queue.appeals'); if (!$au) fail('That member no longer exists.');
      if ($op === 'upholdAppeal') { q("UPDATE users SET status = 'active', suspended_until = NULL, updated = ? WHERE id = ?", [$now, $au['id']]); audit($u, 'Appeal upheld', $au['name'], $reason, $au['status'], 'active'); notify($au['name'], 'moderator', 'Your appeal was accepted. Your account is active again.', "/members/{$au['name']}", $u); }
      else { audit($u, 'Appeal denied', $au['name'], $reason, $au['status'], $au['status']); notify($au['name'], 'moderator', "Your appeal was denied: $reason", "/members/{$au['name']}", $u); }
      break;
    default: fail('Unknown action.');
  }
  $status = in_array($op, ['dismiss', 'denyAppeal'], true) ? 'dismissed' : 'resolved';
  q("UPDATE reports SET status = ?, closed_by = ?, closed_at = ?, updated = ? WHERE id = ?", [$status, $u['name'], $now, $now, $r['id']]);
  if ($r['by_user'] !== 'system' && !in_array($r['kind'], ['appeal', 'claim'], true)) notify($r['by_user'], 'moderator', "Your report was reviewed: $status", '/notifications', $u);
  return ['status' => $status];
});

op('appeal.create', function (array $in, array $u) {
  rate_limit('appeal:' . $u['name'], 3, DAY_MS / 1000, "You've already appealed today. Senior moderators will reply.");
  $text = str_in($in, 'text', 2000); if (mb_strlen($text) < 10) fail('Explain in a sentence or two.');
  insert('reports', ['queue' => 'appeals', 'kind' => 'appeal', 'target' => jenc(['user' => $u['name'], 'text' => $text]), 'board' => null,
    'reason' => "Appeal of {$u['status']}" . ($u['warnings'] ? " ({$u['warnings']} warnings)" : ''), 'by_user' => $u['name'], 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
  return [];
});

op('user.action', function (array $in, array $u) {
  $t = target_user(str_in($in, 'user', 40)); $a = str_in($in, 'a', 16); $reason = str_in($in, 'reason', 1000);
  if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  if ($a === 'verify') { if (!can($u, 'managePermissions')) fail('Only admins can mark emails verified.', 403); }
  else need_mp($u, "user.$a");
  if (!can_act_on($u, $t)) fail("You can't take this action on {$t['name']}.", 403);
  set_status($u, $t, $a, $reason);
  return [];
});

// Role changes (Admin → Users, Admin → Moderators). Board assignments and moderator templates travel as site settings.
op('user.role', function (array $in, array $u) {
  if (!can($u, 'managePermissions')) fail('Only admins can change roles.', 403);
  $t = target_user(str_in($in, 'user', 40)); $role = str_in($in, 'role', 24);
  if (!in_array($role, ALL_ROLES, true) || $role === 'guest') fail('Pick a valid role.');
  if ($t['id'] === $u['id']) fail("You can't change your own role.");
  if (($role === 'super_admin' || $t['role'] === 'super_admin') && $u['role'] !== 'super_admin') fail('Only a Super Admin can do that.', 403);
  if ($t['role'] === 'admin' && $u['role'] !== 'super_admin') fail('Only a Super Admin can change an admin.', 403);
  $p = $t['profile'];
  if (isset($in['badges']) && is_array($in['badges'])) $p['badges'] = array_values(array_slice(array_map(fn($b) => mb_substr((string) $b, 0, 40), $in['badges']), 0, 12));
  q("UPDATE users SET role = ?, profile = ?, updated = ? WHERE id = ?", [$role, jenc($p), now_ms(), $t['id']]);
  if (!in_array($role, STAFF_ROLES, true)) {
    // Stepping down from staff removes board assignments and personal moderator permissions
    $boards = doc('BOARDS'); $ch = false;
    foreach ($boards as &$b) if (in_array($t['name'], $b['mods'] ?? [], true)) { $b['mods'] = array_values(array_diff($b['mods'], [$t['name']])); $ch = true; } unset($b);
    if ($ch) save_doc('BOARDS', $boards);
    $mp = doc('MOD_PROFILES'); if (isset($mp[$t['name']])) { unset($mp[$t['name']]); save_doc('MOD_PROFILES', (object) $mp); }
  }
  audit($u, 'Permission change', $t['name'], str_in($in, 'reason', 400) ?: 'Role change', $t['role'], $role);
  notify($t['name'], 'moderator', str_in($in, 'note', 300) ?: "Your role is now " . ucwords(str_replace('_', ' ', $role)), in_array($role, STAFF_ROLES, true) ? '/mod' : "/members/{$t['name']}", $u);
  return [];
});

op('user.clear', function (array $in, array $u) {
  $t = target_user(str_in($in, 'user', 40)); need_mp($u, 'user.warn');
  if (!can_act_on($u, $t)) fail("You can't do that to {$t['name']}.", 403);
  $what = str_in($in, 'what', 10); $p = $t['profile'];
  if ($what === 'avatar') $p['avatar'] = null; elseif ($what === 'sig') $p['sig'] = ''; else fail('Unknown action.');
  save_profile($t, $p);
  audit($u, $what === 'avatar' ? 'Removed avatar' : 'Cleared signature', $t['name'], str_in($in, 'reason', 400) ?: 'Breaks the rules', 'set', 'removed');
  notify($t['name'], 'moderator', $what === 'avatar' ? 'A moderator removed your avatar because it broke the rules.' : 'A moderator cleared your signature because it broke the rules.', '/settings', $u);
  return [];
});
