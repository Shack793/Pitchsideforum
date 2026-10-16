<?php
// Topics, replies, likes, polls, follows, bookmarks, predictions and match threads.
declare(strict_types=1);

function topic_row(int $id): array { $t = row("SELECT * FROM topics WHERE id = ?", [$id]); if (!$t) fail('That topic no longer exists.', 404); return $t; }
function readable_topic(int $id, ?array $u): array { $t = topic_row($id); if (!topic_visible($t, $u)) fail("You can't see that topic.", 403); return $t; }
function post_row(int $topicId, int $postId): array { $p = row("SELECT * FROM posts WHERE id = ? AND topic_id = ?", [$postId, $topicId]); if (!$p) fail('That post no longer exists.', 404); return $p; }
function team_doc(string $slug): ?array { foreach (doc('TEAMS') as $t) if (($t['slug'] ?? '') === $slug) return $t; return null; }
function flood_check(array $u): void {
  if (is_staff($u)) return;
  rate_limit('post:' . $u['name'], 6, 60, 'Slow down a little: you can post again in a minute.');
  rate_limit('post-hour:' . $u['name'], 60, 3600, "You've posted a lot this hour. Take a short break and try again.");
}
// Post counts, plus moving New Members up once they've posted enough.
function count_post(array $u, bool $topic = false): void {
  q("UPDATE users SET posts = posts + 1" . ($topic ? ", topics = topics + 1" : "") . ", updated = ? WHERE id = ?", [now_ms(), $u['id']]);
  $grad = (int) (doc('LIMITS')['newMemberPostsToGraduate'] ?? 10);
  if ($u['role'] === 'new_member' && $u['posts'] + 1 >= $grad && $u['joined'] < now_ms() - DAY_MS)
    q("UPDATE users SET role = 'member', updated = ? WHERE id = ? AND role = 'new_member'", [now_ms(), $u['id']]);
}
function mentions(string $body): array { preg_match_all('/@([a-z0-9_]{3,24})/i', $body, $m); return array_slice(array_values(array_unique(array_map('strtolower', $m[1]))), 0, 10); }   // at most 10 people notified per post
function notify_followers(string $key, string $text, string $go, array $actor, array $skip = []): void {
  foreach (rows("SELECT user FROM follows WHERE k = ?", [$key]) as $r) if (!in_array($r['user'], $skip, true)) notify($r['user'], 'follow', $text, $go, $actor);
}
function poll_from(array $in): ?array {
  $q = str_in($in, 'q', 200); $opts = array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 120), arr_in($in, 'options')), fn($x) => $x !== ''));
  if ($q === '' && !$opts) return null;
  if ($q === '' || count($opts) < 2) fail('A poll needs a question and at least two options.');
  if (count($opts) > 20) fail('Polls can have up to 20 options.');
  $days = max(1, min(90, int_in($in, 'days', 3)));
  return ['q' => $q, 'multi' => bool_in($in, 'multi'), 'publicResults' => bool_in($in, 'publicResults'), 'closes' => now_ms() + $days * DAY_MS, 'options' => array_map(fn($t) => ['t' => $t], $opts)];
}

op('topic.create', function (array $in, array $u) {
  if (!can($u, 'topic')) fail(needs_verify($u) ? 'Confirm your email address before posting. Check your inbox for the link.' : "Your account can't start topics right now.", 403);
  $b = board_doc(str_in($in, 'board', 64));
  if (!$b || !can_read_board($u, $b) || !can_post_board($u, $b)) fail("You can't start topics on that board.", 403);
  $limit = (int) (doc('LIMITS')['newTopicsPerDay'] ?? 2);
  if (restricted($u, 'topic') && daily_count($u['name'], 'topic') >= $limit) fail("New members can start $limit topics a day.");
  $title = str_in($in, 'title', 140); $body = str_in($in, 'body', 30000);
  if (mb_strlen($title) < 8) fail('Give the topic a title of at least 8 characters.');
  need_ok(content_problem($u, $body) ?? content_problem($u, "$title ."));
  flood_check($u);
  $tags = array_values(array_intersect(array_map('strval', arr_in($in, 'tags')), array_column(doc('TAGS'), 'slug')));
  $tm = str_in($in, 'team', 64); $team = $tm ? team_doc($tm) : null; if ($tm && !$team) $tm = '';
  $league = null;
  foreach (doc('LEAGUES') as $l) if (($l['board'] ?? '') === $b['slug'] || ($b['parent'] && ($l['board'] ?? '') === $b['parent'])) { $league = $l['slug']; break; }
  if (!$league && $team) $league = $team['league'] ?? null;
  $poll = poll_from(arr_in($in, 'poll'));
  $now = now_ms();
  $id = tx(function () use ($b, $title, $u, $now, $tags, $tm, $league, $poll, $body) {
    $id = insert('topics', ['board' => $b['slug'], 'title' => $title, 'author' => $u['name'], 'at' => $now, 'last_at' => $now, 'tags' => jenc($tags),
      'teams' => jenc($tm ? [$tm] : []), 'league' => $league, 'poll' => $poll ? jenc($poll) : null, 'updated' => $now]);
    insert('posts', ['topic_id' => $id, 'author' => $u['name'], 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    count_post($u, true);
    return $id;
  });
  foreach (mentions($body) as $m) notify($m, 'mention', "{$u['name']} mentioned you in “{$title}”", "/topic/$id", $u);
  if ($tm) notify_followers("team:$tm", "New topic for {$team['name']}: “{$title}”", "/topic/$id", $u);
  return ['id' => $id];
});

op('post.reply', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'topic'), $u);
  if (!can($u, 'topic')) fail(needs_verify($u) ? 'Confirm your email address before posting.' : "Your account can't post right now.", 403);
  $mod = can_mod_board($u, $t['board']);
  if (((int) $t['locked'] || (int) $t['archived'] || (int) $t['deleted']) && !$mod) fail('This topic is closed to new replies.', 403);
  $body = str_in($in, 'body', 30000); need_ok(content_problem($u, $body));
  flood_check($u);
  $now = now_ms();
  $pid = tx(function () use ($t, $u, $body, $now) {
    $pid = insert('posts', ['topic_id' => $t['id'], 'author' => $u['name'], 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    q("UPDATE topics SET last_at = ?, updated = ? WHERE id = ?", [$now, $now, $t['id']]);
    count_post($u);
    return $pid;
  });
  $go = "/topic/{$t['id']}"; $title = $t['title']; $told = [$u['name']];
  if (preg_match('/\[quote=([\w-]+)\]/', $body, $m)) { notify($m[1], 'quote', "{$u['name']} quoted you in “{$title}”", $go, $u); $told[] = $m[1]; }
  foreach (mentions($body) as $m) if (!in_array($m, $told, true)) { notify($m, 'mention', "{$u['name']} mentioned you in “{$title}”", $go, $u); $told[] = $m; }
  if (!in_array($t['author'], $told, true)) { notify($t['author'], 'reply', "{$u['name']} replied in “{$title}”", $go, $u); $told[] = $t['author']; }
  foreach (rows("SELECT user FROM follows WHERE k = ?", ["topic:{$t['id']}"]) as $r) if (!in_array($r['user'], $told, true)) notify($r['user'], 'reply', "New reply in “{$title}”", $go, $u);
  return ['id' => $pid];
});

op('post.edit', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'topic'), $u); $p = post_row((int) $t['id'], int_in($in, 'post'));
  $own = $p['author'] === $u['name'];
  if ($own ? !can($u, 'read') || $u['status'] !== 'active' : !mp($u, 'post.edit', $t['board'])) fail("You can't edit this post.", 403);
  if ($own && (int) $t['locked'] && !can_mod_board($u, $t['board'])) fail('This topic is locked.', 403);
  $body = str_in($in, 'body', 30000); need_ok(content_problem($u, $body));
  if ($body === $p['body']) return [];
  $rev = jdec($p['revisions'], []); $rev[] = ['at' => now_ms(), 'body' => $p['body'], 'by' => $u['name']];
  q("UPDATE posts SET body = ?, revisions = ? WHERE id = ?", [$body, jenc($rev), $p['id']]);
  // The first post of a review topic is the review itself
  if (!empty($t['review_id']) && (int) val("SELECT MIN(id) FROM posts WHERE topic_id = ?", [$t['id']]) === (int) $p['id']) {
    $r = row("SELECT * FROM reviews WHERE id = ?", [(int) $t['review_id']]);
    if ($r) { $h = jdec($r['history'], []); $h[] = ['at' => now_ms(), 'stars' => (int) $r['stars'], 'body' => $r['body']];
      q("UPDATE reviews SET body = ?, history = ?, updated = ? WHERE id = ?", [$body, jenc($h), now_ms(), $r['id']]); }
  }
  touch_topic((int) $t['id']);
  if (!$own) audit($u, 'Edited content', "post #{$p['id']} in topic #{$t['id']}", 'Moderator edit', 'previous revision', 'edited');
  return [];
});

op('post.like', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'topic'), $u); $p = post_row((int) $t['id'], int_in($in, 'post'));
  if ($u['status'] !== 'active') fail("Your account can't like posts right now.", 403);
  rate_limit('like:' . $u['name'], 120, 3600);
  if (insert_ignore('post_likes', ['post_id' => $p['id'], 'user' => $u['name']])) {
    if ($p['author'] !== $u['name']) { q("UPDATE users SET likes = likes + 1, updated = ? WHERE name = ?", [now_ms(), $p['author']]); notify($p['author'], 'like', "{$u['name']} liked your post in “{$t['title']}”", "/topic/{$t['id']}", $u); }
    $liked = true;
  } else {
    q("DELETE FROM post_likes WHERE post_id = ? AND user = ?", [$p['id'], $u['name']]);
    if ($p['author'] !== $u['name']) q("UPDATE users SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END, updated = ? WHERE name = ?", [now_ms(), $p['author']]);
    $liked = false;
  }
  touch_topic((int) $t['id']);
  return ['liked' => $liked];
});

op('post.hide', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'topic'), $u); $p = post_row((int) $t['id'], int_in($in, 'post'));
  need_mp($u, 'post.hide', $t['board']);
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $hide = !(int) $p['hidden'];
  q("UPDATE posts SET hidden = ? WHERE id = ?", [$hide ? 1 : 0, $p['id']]); touch_topic((int) $t['id']);
  audit($u, $hide ? 'Hide post' : 'Unhide post', "post #{$p['id']} in topic #{$t['id']}", $reason, $hide ? 'visible' : 'hidden', $hide ? 'hidden' : 'visible');
  if ($hide) notify($p['author'], 'moderator', "A moderator hid your post in “{$t['title']}”: $reason", "/topic/{$t['id']}", $u);
  return ['hidden' => $hide];
});

op('topic.mod', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'id'), $u); $op = str_in($in, 'do', 16);
  $perm = ['pin' => 'topic.pin', 'lock' => 'topic.lock', 'archive' => 'topic.archive', 'move' => 'topic.move', 'merge' => 'topic.merge', 'tags' => 'topic.tags', 'delete' => 'topic.delete'][$op] ?? null;
  if (!$perm) fail('Unknown action.');
  need_mp($u, $perm, $t['board']);
  $reason = str_in($in, 'reason', 1000);
  if ($op !== 'tags' && mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $id = (int) $t['id']; $now = now_ms(); $obj = "topic #$id";
  if (in_array($op, ['pin', 'lock', 'archive'], true)) {
    $col = ['pin' => 'pinned', 'lock' => 'locked', 'archive' => 'archived'][$op]; $on = !(int) $t[$col];
    q("UPDATE topics SET $col = ?, updated = ? WHERE id = ?", [$on ? 1 : 0, $now, $id]);
    audit($u, ($on ? '' : 'Un') . ($on ? ucfirst($op) : $op) . ' topic', $obj, $reason, $on ? "not $col" : $col, $on ? $col : "not $col");
    return [$col => $on];
  }
  if ($op === 'move') {
    $to = board_doc(str_in($in, 'to', 64)); if (!$to) fail('Pick a board to move it to.');
    q("UPDATE topics SET board = ?, updated = ? WHERE id = ?", [$to['slug'], $now, $id]);
    audit($u, 'Move topic', $obj, $reason, $t['board'], $to['slug']);
    return [];
  }
  if ($op === 'merge') {
    $dst = readable_topic(int_in($in, 'to'), $u); if ((int) $dst['id'] === $id) fail('Pick a different topic.');
    tx(function () use ($id, $dst, $now) {
      q("UPDATE posts SET topic_id = ? WHERE topic_id = ?", [$dst['id'], $id]);
      $last = (int) val("SELECT MAX(at) FROM posts WHERE topic_id = ?", [$dst['id']]);
      q("UPDATE topics SET last_at = ?, updated = ? WHERE id = ?", [$last, $now, $dst['id']]);
      q("UPDATE topics SET deleted = 1, merged_into = ?, updated = ? WHERE id = ?", [$dst['id'], $now, $id]);
    });
    audit($u, 'Merge topics', "topic #$id → #{$dst['id']}", $reason, 'separate', 'merged');
    return ['into' => (int) $dst['id']];
  }
  if ($op === 'tags') {
    $tags = array_values(array_intersect(array_map('strval', arr_in($in, 'tags')), array_column(doc('TAGS'), 'slug')));
    q("UPDATE topics SET tags = ?, updated = ? WHERE id = ?", [jenc($tags), $now, $id]);
    audit($u, 'Edit tags', $obj, 'Tag update', implode(',', jdec($t['tags'], [])) ?: 'none', implode(',', $tags) ?: 'none');
    return [];
  }
  // delete
  q("UPDATE topics SET deleted = 1, updated = ? WHERE id = ?", [$now, $id]);
  audit($u, 'Deleted topic', "topic #$id “{$t['title']}”", $reason, 'visible', 'deleted');
  return [];
});

op('topic.split', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'topic'), $u); need_mp($u, 'topic.merge', $t['board']);
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $posts = rows("SELECT id, author, at FROM posts WHERE topic_id = ? ORDER BY at, id", [$t['id']]);
  $i = array_search(int_in($in, 'post'), array_map(fn($p) => (int) $p['id'], $posts), true);
  if ($i === false || $i === 0) fail("The first post can't be split off. Pick a reply.");
  $moved = array_slice($posts, $i); $title = str_in($in, 'title', 140) ?: "Split: {$t['title']}";
  $now = now_ms();
  $nid = tx(function () use ($t, $moved, $title, $now) {
    $nid = insert('topics', ['board' => $t['board'], 'title' => $title, 'author' => $moved[0]['author'], 'at' => (int) $moved[0]['at'], 'last_at' => (int) end($moved)['at'],
      'tags' => '[]', 'teams' => $t['teams'], 'league' => $t['league'], 'updated' => $now]);
    $ids = array_map(fn($p) => (int) $p['id'], $moved);
    q("UPDATE posts SET topic_id = ? WHERE id IN (" . in_list($ids) . ")", array_merge([$nid], $ids));
    $last = (int) val("SELECT MAX(at) FROM posts WHERE topic_id = ?", [$t['id']]);
    q("UPDATE topics SET last_at = ?, updated = ? WHERE id = ?", [$last, $now, $t['id']]);
    return $nid;
  });
  audit($u, 'Split topic', "topic #{$t['id']}", $reason, count($posts) . ' posts', "#{$t['id']}: $i, #$nid: " . count($moved));
  return ['id' => $nid];
});

op('poll.add', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'id'), $u);
  if ($t['author'] !== $u['name'] && !can_mod_board($u, $t['board'])) fail('Only the person who started the topic can add a poll.', 403);
  if ($t['poll']) fail('This topic already has a poll.');
  $poll = poll_from($in); if (!$poll) fail('Add a question and at least two options.');
  q("UPDATE topics SET poll = ?, updated = ? WHERE id = ?", [jenc($poll), now_ms(), $t['id']]);
  return [];
});

op('poll.vote', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'id'), $u); $poll = jdec($t['poll'], null);
  if (!$poll) fail('This topic has no poll.');
  if ($poll['closes'] < now_ms()) fail('This poll has closed.');
  if ($u['status'] !== 'active') fail("Your account can't vote right now.", 403);
  $picked = array_values(array_unique(array_filter(array_map('intval', arr_in($in, 'opts')), fn($i) => $i >= 0 && $i < count($poll['options']))));
  if (!$picked) fail('Pick an option.');
  if (!$poll['multi'] && count($picked) > 1) $picked = [$picked[0]];
  tx(function () use ($t, $u, $picked) {
    q("DELETE FROM poll_votes WHERE topic_id = ? AND user = ?", [$t['id'], $u['name']]);
    foreach ($picked as $i) insert('poll_votes', ['topic_id' => $t['id'], 'user' => $u['name'], 'opt' => $i]);
  });
  touch_topic((int) $t['id']);
  return [];
});

// Counts a view (once per visitor per hour) and remembers how far a member has read.
op('topic.view', function (array $in, ?array $u) {
  $id = int_in($in, 'id'); $t = row("SELECT id, board, deleted FROM topics WHERE id = ?", [$id]);
  if (!$t || !topic_visible($t + ['title' => ''], $u)) return [];
  $key = 'view:' . $id . ':' . ($u ? $u['name'] : client_ip());
  $win = intdiv(time(), 3600) * 3600;
  if (insert_ignore('rate_hits', ['k' => $key, 'win' => $win, 'n' => 1])) q("UPDATE topics SET views = views + 1 WHERE id = ?", [$id]);
  if ($u) {
    $n = max(0, int_in($in, 'n'));
    if (q("UPDATE topic_reads SET n = ? WHERE user = ? AND topic_id = ? AND n < ?", [$n, $u['name'], $id, $n])->rowCount() === 0) insert_ignore('topic_reads', ['user' => $u['name'], 'topic_id' => $id, 'n' => $n]);
  }
  return [];
}, false);

op('follow.toggle', function (array $in, array $u) {
  $k = str_in($in, 'key', 160);
  if (!preg_match('/^(topic|team|league|board|user|tag):[A-Za-z0-9_.-]+$/', $k)) fail("That can't be followed.");
  if (q("DELETE FROM follows WHERE user = ? AND k = ?", [$u['name'], $k])->rowCount()) return ['on' => false];
  if ((int) val("SELECT COUNT(*) FROM follows WHERE user = ?", [$u['name']]) >= 2000) fail("You're following the maximum number of things.");
  insert_ignore('follows', ['user' => $u['name'], 'k' => $k]);
  return ['on' => true];
});

op('bookmark.toggle', function (array $in, array $u) {
  $id = int_in($in, 'id'); readable_topic($id, $u);
  if (q("DELETE FROM bookmarks WHERE user = ? AND topic_id = ?", [$u['name'], $id])->rowCount()) return ['on' => false];
  insert_ignore('bookmarks', ['user' => $u['name'], 'topic_id' => $id]);
  return ['on' => true];
});

op('predict', function (array $in, array $u) {
  $slug = str_in($in, 'slug', 128); $v = str_in($in, 'v', 1);
  if (!in_array($v, ['H', 'D', 'A'], true)) fail('Pick home, draw or away.');
  $e = null; foreach (doc('EVENTS') as $x) if (($x['slug'] ?? '') === $slug) $e = $x;
  if (!$e) fail('That match no longer exists.', 404);
  if (($e['at'] ?? 0) < now_ms() || ($e['status'] ?? 'upcoming') !== 'upcoming') fail('Predictions close at kick-off.');
  q("DELETE FROM predictions WHERE event = ? AND user = ?", [$slug, $u['name']]);
  insert('predictions', ['event' => $slug, 'user' => $u['name'], 'v' => $v, 'at' => now_ms()]);
  return [];
});

// Shared by moderators (button on the match page) and the cron job (2 hours before kick-off).
function create_match_thread(array $e, ?array $actor): ?int {
  $events = doc('EVENTS'); $idx = null;
  foreach ($events as $i => $x) if (($x['slug'] ?? '') === $e['slug']) $idx = $i;
  if ($idx === null || !empty($events[$idx]['thread'])) return null;
  $h = team_doc($e['home'] ?? '') ?: ['name' => $e['homeName'] ?? $e['home'] ?? 'Home', 'slug' => $e['home'] ?? ''];
  $a = team_doc($e['away'] ?? '') ?: ['name' => $e['awayName'] ?? $e['away'] ?? 'Away', 'slug' => $e['away'] ?? ''];
  $l = null; foreach (doc('LEAGUES') as $x) if (($x['slug'] ?? '') === ($e['league'] ?? '')) $l = $x;
  $boardSlug = $l['board'] ?? 'general'; if (!board_doc($boardSlug)) $boardSlug = 'general';
  $author = $actor ? $actor['name'] : (val("SELECT name FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1") ?: 'system');
  $now = now_ms(); $when = gmdate('j M H:i', (int) (($e['at'] ?? $now) / 1000)) . ' UTC';
  $body = "Match thread. {$h['name']} vs {$a['name']} · " . ($l['name'] ?? '') . " · $when.\nKeep it civil, keep it about the game.";
  $id = tx(function () use ($boardSlug, $h, $a, $author, $now, $e, $l, $body) {
    $id = insert('topics', ['board' => $boardSlug, 'title' => "{$h['name']} vs {$a['name']}: match thread", 'author' => $author, 'at' => $now, 'last_at' => $now, 'pinned' => 1, 'auto' => 1,
      'tags' => jenc(['match-thread']), 'teams' => jenc(array_values(array_filter([$e['home'] ?? null, $e['away'] ?? null]))), 'league' => $l['slug'] ?? null, 'event' => $e['slug'], 'updated' => $now]);
    insert('posts', ['topic_id' => $id, 'author' => $author, 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    return $id;
  });
  $events[$idx]['thread'] = $id; save_doc('EVENTS', $events);
  audit($actor, 'Create match thread', "event {$e['slug']}", $actor ? 'Manual creation' : 'Automatic, before kick-off', 'none', "topic #$id");
  $told = [];
  foreach ([$e['home'] ?? '', $e['away'] ?? ''] as $tm) if ($tm) foreach (rows("SELECT user FROM follows WHERE k = ?", ["team:$tm"]) as $r)
    if (!in_array($r['user'], $told, true)) { notify($r['user'], 'follow', "Match thread is up: {$h['name']} vs {$a['name']}", "/topic/$id", $actor); $told[] = $r['user']; }
  return $id;
}
op('matchThread.create', function (array $in, array $u) {
  $slug = str_in($in, 'slug', 128); $e = null;
  foreach (doc('EVENTS') as $x) if (($x['slug'] ?? '') === $slug) $e = $x;
  if (!$e) fail('That match no longer exists.', 404);
  $l = null; foreach (doc('LEAGUES') as $x) if (($x['slug'] ?? '') === ($e['league'] ?? '')) $l = $x;
  need_mp($u, 'topic.matchThread', $l['board'] ?? null);
  if (!empty($e['thread'])) fail('A match thread already exists for this event.');
  return ['id' => create_match_thread($e, $u)];
});
