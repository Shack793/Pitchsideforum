<?php
// Posts the "Casino Complaints & Dispute Resolution Policy" in Complaint Discussions and pins it.
// Run by apply.sh:  php post-policy.php /var/www/pitchside
// Safe to run twice: it won't post a second copy.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';

$BOARD = 'complaint-talk';
$TITLE = 'Casino Complaints & Dispute Resolution Policy';
$FLAG = 'post:complaints-policy-2026-11';

$body = trim((string) file_get_contents(__DIR__ . '/policy.txt'));
if ($body === '') { fwrite(STDERR, "The policy text is missing.\n"); exit(1); }
if (!board_doc($BOARD)) { fwrite(STDERR, "Couldn't find the Complaint Discussions board.\n"); exit(1); }

$done = meta_get($FLAG);
if ($done && row("SELECT id FROM topics WHERE id = ? AND deleted = 0", [(int) $done])) {
  q("UPDATE topics SET pinned = 1, updated = ? WHERE id = ?", [now_ms(), (int) $done]);
  echo "ALREADY $done\n"; exit(0);
}
$same = row("SELECT id FROM topics WHERE board = ? AND title = ? AND deleted = 0 ORDER BY id LIMIT 1", [$BOARD, $TITLE]);
if ($same) {
  q("UPDATE topics SET pinned = 1, updated = ? WHERE id = ?", [now_ms(), (int) $same['id']]);
  meta_set($FLAG, (string) $same['id']); echo "ALREADY {$same['id']}\n"; exit(0);
}

// Posted by the site owner (the first Super Admin account)
$u = row("SELECT * FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY id LIMIT 1")
  ?: row("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1");
if (!$u) { fwrite(STDERR, "Couldn't find an admin account to post from.\n"); exit(1); }

$now = now_ms();
$id = tx(function () use ($BOARD, $TITLE, $u, $now, $body) {
  $id = insert('topics', ['board' => $BOARD, 'title' => $TITLE, 'author' => $u['name'], 'at' => $now, 'last_at' => $now,
    'tags' => '[]', 'teams' => '[]', 'league' => null, 'poll' => null, 'pinned' => 1, 'updated' => $now]);
  insert('posts', ['topic_id' => $id, 'author' => $u['name'], 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
  count_post($u, true);
  return $id;
});
meta_set($FLAG, (string) $id);
audit($u, 'Pin topic', "topic $id", 'Posted and pinned the complaints policy', 'Not pinned', 'Pinned');
echo "POSTED $id {$u['name']}\n";
