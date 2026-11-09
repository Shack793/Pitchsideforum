<?php
// Posts the "Casino & Sportsbook Review Guidelines" in Casino Reviews and Sportsbook Reviews and pins them.
// Run by apply.sh:  php post-policy.php /var/www/pitchside
// Safe to run twice: it won't post a second copy.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';

$BOARDS = ['casino-reviews' => 'Casino Reviews'];   // one post; it's also shown on the casino and sportsbook pages
$TITLE = 'Casino & Sportsbook Review Guidelines';
$body = trim((string) file_get_contents(__DIR__ . '/policy.txt'));
if ($body === '') { fwrite(STDERR, "The policy text is missing.\n"); exit(1); }
// Posted by the site owner (the first Super Admin account)
$u = row("SELECT * FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY id LIMIT 1")
  ?: row("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1");
if (!$u) { fwrite(STDERR, "Couldn't find an admin account to post from.\n"); exit(1); }

$found = 0;
foreach ($BOARDS as $BOARD => $label) {
  if (!board_doc($BOARD)) { echo "MISSING $label\n"; continue; }
  $found++;
  $FLAG = "post:review-guidelines-2026-11:$BOARD";
  $done = meta_get($FLAG);
  if ($done && row("SELECT id FROM topics WHERE id = ? AND deleted = 0", [(int) $done])) {
    q("UPDATE topics SET pinned = 1, updated = ? WHERE id = ?", [now_ms(), (int) $done]); echo "ALREADY $done $label\n"; continue;
  }
  $same = row("SELECT id FROM topics WHERE board = ? AND title = ? AND deleted = 0 ORDER BY id LIMIT 1", [$BOARD, $TITLE]);
  if ($same) {
    q("UPDATE topics SET pinned = 1, updated = ? WHERE id = ?", [now_ms(), (int) $same['id']]);
    meta_set($FLAG, (string) $same['id']); echo "ALREADY {$same['id']} $label\n"; continue;
  }
  $now = now_ms();
  $id = tx(function () use ($BOARD, $TITLE, $u, $now, $body) {
    $id = insert('topics', ['board' => $BOARD, 'title' => $TITLE, 'author' => $u['name'], 'at' => $now, 'last_at' => $now,
      'tags' => '[]', 'teams' => '[]', 'league' => null, 'poll' => null, 'pinned' => 1, 'updated' => $now]);
    insert('posts', ['topic_id' => $id, 'author' => $u['name'], 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    count_post($u, true);
    return $id;
  });
  meta_set($FLAG, (string) $id);
  audit($u, 'Pin topic', "topic $id", 'Posted and pinned the review guidelines', 'Not pinned', 'Pinned');
  echo "POSTED $id $label\n";
}
if (!$found) { fwrite(STDERR, "Couldn't find the Casino Reviews or Sportsbook Reviews boards.\n"); exit(1); }
