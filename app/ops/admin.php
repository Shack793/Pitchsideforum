<?php
// Admin settings, ad statistics and search.
declare(strict_types=1);

// Saves one settings document from the Admin dashboard. "ver" guards against two admins overwriting each other.
op('config.save', function (array $in, array $u) {
  $k = str_in($in, 'k', 32);
  if (!in_array($k, DOC_KEYS, true)) fail('Unknown setting.');
  $cap = DOC_WRITE[$k] ?? 'manageCategories';
  if (!can($u, $cap)) fail("You don't have permission to change this.", 403);
  $v = $in['v'] ?? null; if (!is_array($v)) fail('That setting is empty.');
  $cur = doc_row($k);
  if ($cur && isset($in['ver']) && (int) $in['ver'] !== (int) $cur['ver']) fail('Someone else changed this setting at the same time. Your view has been refreshed; make your change again.', 409);
  if ($k === 'SETTINGS' && !can($u, 'system')) {
    $old = jdec($cur['v'] ?? null, []);
    foreach (SYSTEM_SETTINGS as $s) if (jenc($old[$s] ?? null) !== jenc($v[$s] ?? null)) fail('Only a Super Admin can change system settings.', 403);
  }
  if ($k === 'PERMS' && !can($u, 'system')) {
    // Only a Super Admin can change who has system controls, or anything about the Super Admin role
    $old = jdec($cur['v'] ?? null, []);
    if (jenc($old['system'] ?? null) !== jenc($v['system'] ?? null)) fail('Only a Super Admin can change system access.', 403);
    foreach ($v as $cap => $roles) if (jenc($old[$cap]['super_admin'] ?? null) !== jenc($roles['super_admin'] ?? null)) fail('Only a Super Admin can change the Super Admin role.', 403);
  }
  if ($k === 'PERMS') {
    // Nobody can lock the Super Admin out of the controls they need to fix things
    foreach (['read', 'moderate', 'manageCategories', 'managePermissions', 'system'] as $c) if (empty($v[$c]['super_admin'])) fail("The Super Admin role must keep “{$c}”.");
  }
  $v = clean_doc($v, $k);
  $json = jenc($v); if (strlen($json) > 4000000) fail('That setting is too large. Use smaller images.');
  save_doc($k, $v);
  audit($u, 'Settings change', $k, 'Admin dashboard', 'previous', 'updated');
  return ['ver' => (int) val("SELECT ver FROM config WHERE k = ?", [$k])];
});

// Ad impressions are sent in small batches by each browser: {kind: {adId: count}}
op('ad.imps', function (array $in, ?array $u) {
  rate_limit('imps:' . client_ip(), 120, 60);
  $day = gmdate('Y-m-d');
  foreach (['banner', 'side', 'post'] as $kind) foreach (arr_in($in, $kind) as $id => $n) {
    $id = (int) $id; $n = max(0, min(50, (int) $n)); if (!$id || !$n) continue;
    if (!q("UPDATE ad_stats SET imps = imps + ? WHERE kind = ? AND ad_id = ? AND day = ?", [$n, $kind, $id, $day])->rowCount())
      if (!insert_ignore('ad_stats', ['kind' => $kind, 'ad_id' => $id, 'day' => $day, 'imps' => $n, 'clicks' => 0])) q("UPDATE ad_stats SET imps = imps + ? WHERE kind = ? AND ad_id = ? AND day = ?", [$n, $kind, $id, $day]);
  }
  return [];
}, false);
function count_ad_click(string $kind, int $id): void {
  if (!in_array($kind, ['banner', 'side', 'post'], true) || !$id) return;
  $day = gmdate('Y-m-d');
  if (!q("UPDATE ad_stats SET clicks = clicks + 1 WHERE kind = ? AND ad_id = ? AND day = ?", [$kind, $id, $day])->rowCount())
    if (!insert_ignore('ad_stats', ['kind' => $kind, 'ad_id' => $id, 'day' => $day, 'imps' => 0, 'clicks' => 1])) q("UPDATE ad_stats SET clicks = clicks + 1 WHERE kind = ? AND ad_id = ? AND day = ?", [$kind, $id, $day]);
}
op('ad.click', function (array $in, ?array $u) {
  rate_limit('adclick:' . client_ip(), 60, 60);
  count_ad_click(str_in($in, 'kind', 10), int_in($in, 'id'));
  return [];
}, false);

// Search across topic titles and posts the visitor can read.
op('search', function (array $in, ?array $u) {
  rate_limit('search:' . client_ip(), 60, 60, 'Too many searches. Wait a moment.');
  $qs = str_in($in, 'q', 120); $author = str_in($in, 'author', 40); $boardF = str_in($in, 'board', 64);
  if (mb_strlen($qs) < 2 && $author === '') return ['ids' => [], 'topics' => []];
  $where = ['t.deleted = 0']; $args = [];
  if ($qs !== '') { $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $qs) . '%'; $where[] = "(t.title LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM posts p WHERE p.topic_id = t.id AND p.hidden = 0 AND p.body LIKE ? ESCAPE '!'))"; $args[] = $like; $args[] = $like; }
  if ($author !== '') { $where[] = 't.author = ?'; $args[] = $author; }
  if ($boardF !== '' && $boardF !== 'all') { $where[] = 't.board = ?'; $args[] = $boardF; }
  $trows = rows("SELECT t.* FROM topics t WHERE " . implode(' AND ', $where) . " ORDER BY t.last_at DESC LIMIT 200", $args);
  $topics = topics_out($trows, $u);
  $names = []; foreach ($topics as $t) { $names[] = $t['author']; foreach ($t['posts'] as $p) $names[] = $p['author']; }
  $users = [];
  if ($qs !== '') foreach (rows("SELECT name FROM users WHERE name LIKE ? AND status <> 'deleted' LIMIT 20", ['%' . $qs . '%']) as $r) $names[] = $r['name'];
  return ['ids' => array_map(fn($t) => $t['id'], $topics), 'topics' => $topics, 'users' => (object) users_out($names, $u)];
}, false);

// Members directory search (the members list loads recently active people; this finds anyone).
op('members.find', function (array $in, ?array $u) {
  rate_limit('members:' . client_ip(), 60, 60);
  $qs = str_in($in, 'q', 40); if (mb_strlen($qs) < 2) return ['users' => (object) []];
  $names = array_map(fn($r) => $r['name'], rows("SELECT name FROM users WHERE name LIKE ? AND status <> 'deleted' ORDER BY posts DESC LIMIT 50", ['%' . $qs . '%']));
  return ['users' => (object) users_out($names, $u)];
}, false);
