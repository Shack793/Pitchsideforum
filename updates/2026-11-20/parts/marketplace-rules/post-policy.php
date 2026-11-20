<?php
// Posts "Marketplace Rules & Trading Safety" in Marketplace Talk and pins it.
// Also removes a leading "Pitchside Forum – " from the titles of pinned topics.
// Run by apply.sh:  php post-policy.php /var/www/pitchside
// Safe to run twice: it won't post a second copy.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';

$BOARDS = ['marketplace-talk' => 'Marketplace Talk'];
$TITLE = 'Marketplace Rules & Trading Safety';
$body = trim((string) file_get_contents(__DIR__ . '/policy.txt'));
if ($body === '') { fwrite(STDERR, "The policy text is missing.\n"); exit(1); }
// Titles of pinned topics: drop a leading "Pitchside Forum – " (dash, en dash or em dash)
foreach (rows("SELECT id, title FROM topics WHERE pinned = 1 AND deleted = 0 AND title LIKE 'Pitchside Forum%'") as $t) {
  $new = preg_replace('/^\s*Pitchside\s+Forum\s*[-–—:|]\s*/u', '', (string) $t['title']);
  if ($new !== $t['title'] && mb_strlen(trim($new)) >= 8) { q("UPDATE topics SET title = ?, updated = ? WHERE id = ?", [trim($new), now_ms(), (int) $t['id']]); echo "RENAMED {$t['id']} " . trim($new) . "\n"; }
}

// Posted by the site owner (the first Super Admin account)
$u = row("SELECT * FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY id LIMIT 1")
  ?: row("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1");
if (!$u) { fwrite(STDERR, "Couldn't find an admin account to post from.\n"); exit(1); }

$found = 0;
foreach ($BOARDS as $BOARD => $label) {
  if (!board_doc($BOARD)) { echo "MISSING $label\n"; continue; }
  $found++;
  $FLAG = "post:marketplace-rules-2026-11:$BOARD";
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
  audit($u, 'Pin topic', "topic $id", 'Posted and pinned the marketplace rules', 'Not pinned', 'Pinned');
  echo "POSTED $id $label\n";
}
if (!$found) { fwrite(STDERR, "Couldn't find the Marketplace Talk board.\n"); exit(1); }
