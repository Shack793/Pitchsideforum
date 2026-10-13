<?php
// Checks the database and every main feature end to end, then undoes everything it did.
//   php app/selftest.php      (setup.sh and update.sh run this for you)
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib/api.php';
$pass = 0; $fail = 0;
$check = function (bool $ok, string $what) use (&$pass, &$fail) { $ok ? $pass++ : $fail++; fwrite($ok ? STDOUT : STDERR, ($ok ? '  ok    ' : '  FAIL  ') . $what . "\n"); };
$as = function (?array $u) { $GLOBALS['SESSION'] = $u ? ['id' => 'selftest', 'csrf' => 'x', 'pending_2fa' => 0, 'user' => $u] : null; };
$run = function (string $op, array $in) { try { return run_op($op, $in); } catch (ApiError $e) { return ['error' => $e->getMessage(), 'status' => $e->status]; } };
foreach (['GD' => 'gd', 'cURL' => 'curl', 'mbstring' => 'mbstring', 'PDO MySQL' => 'pdo_mysql'] as $n => $ext) $check(extension_loaded($ext) || ($ext === 'pdo_mysql' && cfg('db_driver') === 'sqlite'), "PHP extension: $n");
$check(is_writable(APP_DIR . '/storage') && is_writable(PUBLIC_DIR . '/uploads'), 'Storage and uploads folders are writable');
$check(count(doc('BOARDS')) > 0 && count(doc('PERMS')) > 0, 'Site settings are loaded');
db()->beginTransaction();
try {
  $now = now_ms(); $mk = function (string $name, string $role) use ($now) {
    insert('users', ['name' => $name, 'email' => "$name@selftest.invalid", 'pass' => 'x', 'role' => $role, 'status' => 'active', 'warnings' => 0, 'email_verified' => 1,
      'joined' => $now - 30 * DAY_MS, 'posts' => 50, 'topics' => 0, 'likes' => 0, 'profile' => jenc(PROFILE_DEFAULTS), 'totp_on' => 0, 'last_seen' => 0, 'updated' => $now]);
    return user_by_name($name); };
  $a = $mk('selftest_alice', 'member'); $b = $mk('selftest_bob', 'member'); $m = $mk('selftest_admin', 'super_admin');
  $board = null; foreach (doc('BOARDS') as $x) if (can_post_board($a, $x)) { $board = $x['slug']; break; }
  $as($a); $r = $run('topic.create', ['board' => $board, 'title' => 'Self-test topic title', 'body' => 'Self-test body @selftest_bob', 'poll' => ['q' => 'Q?', 'options' => ['A', 'B']]]);
  $tid = (int) ($r['id'] ?? 0); $check($tid > 0, "Create a topic ($board)" . (isset($r['error']) ? ": {$r['error']}" : ''));
  $as($b); $r = $run('post.reply', ['topic' => $tid, 'body' => 'Self-test reply']); $check(!empty($r['id']), 'Reply' . (isset($r['error']) ? ": {$r['error']}" : ''));
  $first = (int) val("SELECT MIN(id) FROM posts WHERE topic_id = ?", [$tid]);
  $r = $run('post.like', ['topic' => $tid, 'post' => $first]); $check(($r['liked'] ?? null) === true, 'Like a post');
  $r = $run('poll.vote', ['id' => $tid, 'opts' => [1]]); $check(!isset($r['error']), 'Vote in a poll');
  $r = $run('follow.toggle', ['key' => "topic:$tid"]); $check(($r['on'] ?? null) === true, 'Follow a topic');
  $r = $run('bookmark.toggle', ['id' => $tid]); $check(($r['on'] ?? null) === true, 'Bookmark a topic');
  $check((int) val("SELECT COUNT(*) FROM notifs WHERE to_user = ?", ['selftest_bob']) > 0, 'Mention creates a notification');
  $r = $run('conv.create', ['to' => ['selftest_alice'], 'body' => 'Self-test message']); $cid = (int) ($r['id'] ?? 0); $check($cid > 0, 'Send a private message' . (isset($r['error']) ? ": {$r['error']}" : ''));
  $as($a); $r = $run('msg.send', ['conv' => $cid, 'body' => 'Self-test answer']); $check(!empty($r['id']), 'Reply to a message');
  $r = $run('report.create', ['kind' => 'post', 'topic' => $tid, 'post' => $first, 'why' => 'Spam', 'details' => 'self-test']); $check(!isset($r['error']), 'Report a post');
  $as($m); $rid = (int) val("SELECT MAX(id) FROM reports"); $r = $run('report.resolve', ['id' => $rid, 'do' => 'dismiss', 'reason' => 'Self-test']); $check(($r['status'] ?? '') === 'dismissed', 'Moderator resolves a report' . (isset($r['error']) ? ": {$r['error']}" : ''));
  $r = $run('topic.mod', ['id' => $tid, 'do' => 'pin', 'reason' => 'Self-test']); $check(($r['pinned'] ?? null) === true, 'Moderator pins a topic');
  $ver = (int) val("SELECT ver FROM config WHERE k = 'LAYOUT'"); $r = $run('config.save', ['k' => 'LAYOUT', 'v' => doc('LAYOUT'), 'ver' => $ver]); $check(isset($r['ver']), 'Admin saves a setting');
  $r = $run('user.role', ['user' => 'selftest_bob', 'role' => 'trusted']); $check(!isset($r['error']), 'Admin changes a role');
  $as(null); $r = $run('search', ['q' => 'Self-test topic']); $check(in_array($tid, $r['ids'] ?? [], true), 'Search finds the topic');
  $full = sync_payload(user_by_name('selftest_alice'), 0); $check(in_array($tid, array_column($full['topics'], 'id'), true) && count($full['convs']) >= 1, 'Page data includes topics and messages');
  $delta = sync_payload(user_by_name('selftest_alice'), $now - 1000); $check(in_array($tid, array_column($delta['topics'], 'id'), true), 'Live updates include recent changes');
  $as($b); $r = $run('topic.mod', ['id' => $tid, 'do' => 'lock', 'reason' => 'x']); $check(($r['status'] ?? 0) === 403, 'Members are refused moderator actions');
} catch (Throwable $e) { $check(false, 'Unexpected error: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine()); }
db()->rollBack();
echo "\nSelf-test: $pass passed, $fail failed. (Everything the test created has been removed.)\n";
exit($fail ? 1 : 0);
