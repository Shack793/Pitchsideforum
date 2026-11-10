<?php
// Pitchside Forum: duplicate-post detection (anti-spam).
// Wraps "start a topic" and "reply" (this file loads after forum.php), so the core files stay untouched.
//  1. A member can't post the same text twice within 24 hours (any topic). Short replies such as "Thanks!" are
//     only blocked when repeated in the same topic within 10 minutes (a double click or a resend).
//  2. A member can't start a second topic with the same title within 7 days; the message names the earlier topic.
//  3. When the same text (40+ characters) comes from 3 or more different accounts within 24 hours, the newest
//     post goes into the moderators' Spam queue for a look. It is still posted; nothing is removed automatically.
// Staff are never blocked.
declare(strict_types=1);

const DUP_WINDOW_MS = 86400000;            // 24 hours
const DUP_SHORT_WINDOW_MS = 600000;        // 10 minutes
const DUP_TITLE_WINDOW_MS = 7 * 86400000;  // 7 days
const DUP_MIN_LEN = 25;                    // shorter texts only count as duplicates in the same topic
const DUP_CROSS_MIN_LEN = 40;
const DUP_CROSS_ACCOUNTS = 3;

function dup_norm(string $s): string {
  $s = mb_strtolower($s);
  $s = preg_replace('/\[quote[^\]]*\][\s\S]*?\[\/quote\]/u', ' ', $s) ?? $s;  // quoted text doesn't count
  $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s) ?? $s;
  return trim($s);
}
function dup_recent(string $where, array $args, int $len): array {
  // only compare posts of a similar length, newest first, capped
  $lo = max(0, $len - 400); $hi = $len + 400;   // whole numbers, written into the query so every database compares them as numbers
  return rows("SELECT p.id, p.topic_id, p.author, p.body, p.at FROM posts p WHERE $where AND p.hidden = 0 AND LENGTH(p.body) BETWEEN $lo AND $hi ORDER BY p.id DESC LIMIT 400", $args);
}
function dup_check_own(array $u, string $body, ?int $topic): void {
  if (is_staff($u)) return;
  $n = dup_norm($body); if ($n === '') return;
  $len = strlen($body); $now = now_ms();
  if (mb_strlen($n) >= DUP_MIN_LEN) {
    foreach (dup_recent('p.author = ? AND p.at > ?', [$u['name'], $now - DUP_WINDOW_MS], $len) as $p)
      if (dup_norm($p['body']) === $n) {
        $t = row("SELECT title FROM topics WHERE id = ? AND deleted = 0", [(int) $p['topic_id']]);
        fail($t ? "You've already posted this in “{$t['title']}”. Please don't post the same thing twice; add something new or link to it instead."
                : "You've already posted this. Please don't post the same thing twice.");
      }
  } elseif ($topic) {
    foreach (dup_recent('p.author = ? AND p.topic_id = ? AND p.at > ?', [$u['name'], $topic, $now - DUP_SHORT_WINDOW_MS], $len) as $p)
      if (dup_norm($p['body']) === $n) fail("You've just posted that here.");
  }
}
function dup_flag_cross(array $u, string $body, int $topic, int $post): void {
  $n = dup_norm($body); if (mb_strlen($n) < DUP_CROSS_MIN_LEN) return;
  $who = [$u['name'] => true];
  foreach (dup_recent('p.at > ? AND p.id <> ?', [now_ms() - DUP_WINDOW_MS, $post], strlen($body)) as $p)
    if (dup_norm($p['body']) === $n) $who[$p['author']] = true;
  if (count($who) < DUP_CROSS_ACCOUNTS) return;
  // one flag per text per day is enough
  $key = 'dup:' . substr(hash('sha256', $n), 0, 24);
  $last = (int) (meta_get($key) ?? 0); if ($last > now_ms() - DUP_WINDOW_MS) return;
  meta_set($key, (string) now_ms());
  $t = row("SELECT board FROM topics WHERE id = ?", [$topic]);
  $names = array_keys($who);
  insert('reports', ['queue' => 'spam', 'kind' => 'post', 'target' => jenc(['topic' => $topic, 'post' => $post]), 'board' => $t['board'] ?? null,
    'reason' => 'Spam: the same text was posted by ' . count($names) . ' different accounts in 24 hours (' . implode(', ', array_slice($names, 0, 8)) . (count($names) > 8 ? '…' : '') . ')',
    'by_user' => 'system', 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
}

(function () {
  $ops = &$GLOBALS['OPS'];

  if (isset($ops['topic.create'])) {
    [$base, $need] = $ops['topic.create'];
    $ops['topic.create'] = [function (array $in, array $u) use ($base) {
      $body = is_string($in['body'] ?? null) ? $in['body'] : '';
      $title = is_string($in['title'] ?? null) ? trim($in['title']) : '';
      if (!is_staff($u) && $title !== '') {
        $nt = dup_norm($title);
        foreach (rows("SELECT id, title FROM topics WHERE author = ? AND at > ? AND deleted = 0 ORDER BY id DESC LIMIT 100", [$u['name'], now_ms() - DUP_TITLE_WINDOW_MS]) as $t)
          if ($nt !== '' && dup_norm($t['title']) === $nt) fail("You already started a topic called “{$t['title']}” this week. Please carry on there instead of starting it again.");
      }
      dup_check_own($u, $body, null);
      $res = $base($in, $u);
      try {
        $id = (int) ($res['id'] ?? 0);
        $pid = $id ? (int) val("SELECT id FROM posts WHERE topic_id = ? ORDER BY id LIMIT 1", [$id]) : 0;
        if ($pid && !is_staff($u)) dup_flag_cross($u, $body, $id, $pid);
      } catch (Throwable $e) { error_log('duplicate check: ' . $e->getMessage()); }
      return $res;
    }, $need];
  }

  if (isset($ops['post.reply'])) {
    [$base, $need] = $ops['post.reply'];
    $ops['post.reply'] = [function (array $in, array $u) use ($base) {
      $body = is_string($in['body'] ?? null) ? $in['body'] : '';
      $topic = (int) ($in['topic'] ?? 0);
      dup_check_own($u, $body, $topic ?: null);
      $res = $base($in, $u);
      try {
        $pid = (int) ($res['id'] ?? 0);
        if ($pid && $topic && !is_staff($u)) dup_flag_cross($u, $body, $topic, $pid);
      } catch (Throwable $e) { error_log('duplicate check: ' . $e->getMessage()); }
      return $res;
    }, $need];
  }
})();
