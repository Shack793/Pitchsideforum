<?php
// Forum rep: the number of likes a member's posts have received from other members.
// Only visible posts count (not hidden posts or deleted topics), only likes from active, real members count
// (not their own likes, not AI community accounts, not suspended or banned accounts). It's worked out from the
// likes themselves, so it stays right when posts are hidden, topics deleted or likes taken back.
// The same sync keeps each member's post and topic counts (which decide their rank) to visible posts only.
declare(strict_types=1);

function forum_rep_counts(?array $names = null): array {
  $sql = "SELECT p.author AS a, COUNT(*) AS n FROM post_likes l JOIN posts p ON p.id = l.post_id JOIN topics t ON t.id = p.topic_id JOIN users lu ON lu.name = l.user
    WHERE l.user <> p.author AND p.hidden = 0 AND t.deleted = 0 AND lu.status = 'active' AND lu.email NOT LIKE '%@ai.pitchside.invalid'";
  $args = [];
  if ($names !== null) { if (!$names) return []; $sql .= " AND p.author IN (" . in_list($names) . ")"; $args = $names; }
  $ai = " AND NOT EXISTS (SELECT 1 FROM ai_characters c WHERE c.user_id = lu.id)";
  try { $rows = rows($sql . $ai . " GROUP BY p.author", $args); } catch (Throwable $e) { $rows = rows($sql . " GROUP BY p.author", $args); }
  $out = []; foreach ($rows as $r) $out[$r['a']] = (int) $r['n'];
  return $out;
}
// Visible posts and topics per member: posts that aren't hidden, in topics that aren't deleted
function visible_post_counts(?array $names = null): array {
  $w = $names === null ? '' : " AND p.author IN (" . in_list($names) . ")";
  $posts = []; foreach (rows("SELECT p.author AS a, COUNT(*) AS n FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.hidden = 0 AND t.deleted = 0$w GROUP BY p.author", $names ?? []) as $r) $posts[$r['a']] = (int) $r['n'];
  $w = $names === null ? '' : " AND author IN (" . in_list($names) . ")";
  $topics = []; foreach (rows("SELECT author AS a, COUNT(*) AS n FROM topics WHERE deleted = 0$w GROUP BY author", $names ?? []) as $r) $topics[$r['a']] = (int) $r['n'];
  return [$posts, $topics];
}
// Recalculates forum rep, post count and topic count for these members (or everyone) and saves any that changed.
// Returns how many members changed.
function forum_rep_sync(?array $names = null): int {
  if ($names !== null) { $names = array_values(array_unique(array_filter(array_map('strval', $names)))); if (!$names) return 0; }
  $counts = forum_rep_counts($names); [$posts, $topics] = visible_post_counts($names);
  $users = $names === null ? rows("SELECT id, name, profile, posts, topics FROM users WHERE status <> 'deleted'")
    : rows("SELECT id, name, profile, posts, topics FROM users WHERE name IN (" . in_list($names) . ")", $names);
  $n = 0; $now = now_ms();
  foreach ($users as $usr) {
    $p = jdec($usr['profile'], []) ?: []; $p += PROFILE_DEFAULTS; if (!is_array($p['rep'] ?? null)) $p['rep'] = PROFILE_DEFAULTS['rep'];
    $want = $counts[$usr['name']] ?? 0; $wp = $posts[$usr['name']] ?? 0; $wt = $topics[$usr['name']] ?? 0;
    if ((int) ($p['rep']['forum'] ?? 0) === $want && (int) $usr['posts'] === $wp && (int) $usr['topics'] === $wt) continue;
    $p['rep']['forum'] = $want;
    q("UPDATE users SET profile = ?, posts = ?, topics = ?, updated = ? WHERE id = ?", [jenc($p), $wp, $wt, $now, $usr['id']]); $n++;
  }
  return $n;
}
// Everyone with a post in this topic (after a topic is deleted, merged or restored)
function forum_rep_sync_topic(int $topicId): void {
  forum_rep_sync(array_column(rows("SELECT DISTINCT author FROM posts WHERE topic_id = ?", [$topicId]), 'author'));
}
