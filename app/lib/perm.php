<?php
// Permissions: the same rules the browser shows, enforced again here for every request.
declare(strict_types=1);

const STAFF_ROLES = ['moderator', 'senior_moderator', 'admin', 'super_admin'];
const ADMIN_ROLES = ['admin', 'super_admin'];
const ALL_ROLES = ['guest','new_member','member','trusted','verified_reviewer','verified_seller','business','moderator','senior_moderator','admin','super_admin'];
const ALL_MOD_KEYS = ['topic.pin','topic.lock','topic.move','topic.merge','topic.archive','topic.tags','topic.delete','topic.matchThread','post.edit','post.hide',
  'user.view','user.warn','user.suspend','user.ban','user.restore','user.appeals','queue.reports','queue.spam','queue.scam','queue.complaints','queue.review_disputes',
  'queue.abuse','queue.market','queue.claims','queue.appeals','review.moderate','complaint.manage','operator.warning','business.verify','queue.listings',
  'listing.remove','escrow.arbitrate','seller.verify','dm.anyone','dm.notice'];

function role_of(?array $u): string { return $u ? $u['role'] : 'guest'; }
function perm_val(string $cap, string $role) { $p = doc('PERMS'); return $p[$cap][$role] ?? 0; }
function mail_ready(): bool { return (bool) cfg('smtp_host'); }
function needs_verify(array $u): bool { return !$u['email_verified'] && mail_ready() && cfg('require_email_verify', true); }
function can(?array $u, string $cap): bool {
  $v = perm_val($cap, role_of($u)); if (!$v) return false;
  if ($u && $u['status'] !== 'active' && $cap !== 'read') return false;
  if ($u && $cap !== 'read' && needs_verify($u) && !in_array($u['role'], STAFF_ROLES, true)) return false;
  return true;
}
function restricted(?array $u, string $cap): bool { return perm_val($cap, role_of($u)) === 'r'; }
function is_staff(?array $u): bool { return $u && in_array($u['role'], STAFF_ROLES, true) && can($u, 'moderate'); }
function is_admin(?array $u): bool { return $u && in_array($u['role'], ADMIN_ROLES, true); }
function role_by_name(string $name): ?string { $r = val("SELECT role FROM users WHERE name = ?", [$name]); return $r === null ? null : (string) $r; }
function is_staff_name(string $name): bool { return in_array(role_by_name($name), STAFF_ROLES, true); }

/* ---------- Moderator permissions (templates + personal changes) ---------- */
function mod_profile(string $name, string $role): array {
  $p = doc('MOD_PROFILES')[$name] ?? null;
  return $p ?: ['template' => $role === 'senior_moderator' ? 'senior' : 'board', 'allow' => ['$set' => []], 'deny' => ['$set' => []], 'suspendMaxDays' => 7];
}
function mod_template(string $name, string $role): array {
  $p = mod_profile($name, $role);
  foreach (doc('MOD_TEMPLATES') as $t) if (($t['id'] ?? '') === $p['template']) return $t;
  return doc('MOD_TEMPLATES')[0] ?? ['id' => 'board', 'perms' => ['$set' => []], 'allBoards' => false];
}
function mod_perms(array $u): array {
  if (is_admin($u)) return ALL_MOD_KEYS;
  if (!in_array($u['role'], STAFF_ROLES, true)) return [];
  $p = mod_profile($u['name'], $u['role']); $t = mod_template($u['name'], $u['role']);
  $s = array_flip(set_list($t['perms'] ?? []));
  foreach (set_list($p['allow'] ?? []) as $k) $s[$k] = 1;
  foreach (set_list($p['deny'] ?? []) as $k) unset($s[$k]);
  return array_keys($s);
}
function mod_all_boards(array $u): bool { return is_admin($u) || (in_array($u['role'], STAFF_ROLES, true) && !empty(mod_template($u['name'], $u['role'])['allBoards'])); }
function board_doc(?string $slug): ?array { if (!$slug) return null; foreach (doc('BOARDS') as $b) if (($b['slug'] ?? '') === $slug) return $b; return null; }
function can_mod_board(?array $u, ?string $slug): bool {
  if (!$u || !can($u, 'moderate')) return false;
  if (mod_all_boards($u)) return true;
  $b = board_doc($slug); if (!$b) return false;
  $parent = !empty($b['parent']) ? board_doc($b['parent']) : null;
  return in_array($u['name'], $b['mods'] ?? [], true) || ($parent && in_array($u['name'], $parent['mods'] ?? [], true));
}
// mp(key): may this staff member do this? mp(key, board): …on this board?
function mp(?array $u, string $key, ?string $board = null): bool {
  if (!$u || !can($u, 'moderate')) return false;
  if (!in_array($key, mod_perms($u), true)) return false;
  return $board ? can_mod_board($u, $board) : true;
}
function need_mp(?array $u, string $key, ?string $board = null): void { if (!mp($u, $key, $board)) fail("Your moderator permissions don't include this action.", 403); }
function suspend_days(array $u): int { return is_admin($u) ? 30 : (int) (mod_profile($u['name'], $u['role'])['suspendMaxDays'] ?? 7); }

/* ---------- Boards ---------- */
function can_read_board(?array $u, ?array $b): bool { return $b && in_array(role_of($u), $b['readRoles'] ?? ALL_ROLES, true); }
function can_post_board(?array $u, ?array $b): bool { return $b && can($u, 'topic') && in_array(role_of($u), $b['postRoles'] ?? [], true) && empty($b['kind']); }

/* ---------- Content checks shared by topics, replies and messages ---------- */
function content_problem(?array $u, string $text): ?string {
  if (trim($text) === '') return 'Write something first.';
  if (preg_match('#(https?://|www\.)\S+#i', $text) && restricted($u, 'links')) {
    return "New members can't post links yet. Links unlock after " . (doc('LIMITS')['newMemberPostsToGraduate'] ?? 10) . ' posts.';
  }
  foreach (setting('bannedDomains', []) as $d) if ($d !== '' && stripos($text, $d) !== false) return "Links to $d are blocked on Pitchside.";
  return null;
}
function need_ok(?string $problem): void { if ($problem) fail($problem); }

/* ---------- Daily counters for New Member limits ---------- */
function daily_count(string $user, string $what): int {
  $since = now_ms() - DAY_MS;
  if ($what === 'topic') return (int) val("SELECT COUNT(*) FROM topics WHERE author = ? AND at > ? AND auto = 0", [$user, $since]);
  // Direct messages to members (not staff) started today
  return (int) val("SELECT COUNT(DISTINCT m.conv_id) FROM msgs m JOIN conv_members cm ON cm.conv_id = m.conv_id AND cm.user <> ? JOIN users u ON u.name = cm.user
    WHERE m.from_user = ? AND m.at > ? AND u.role NOT IN ('moderator','senior_moderator','admin','super_admin')", [$user, $user, $since]);
}
