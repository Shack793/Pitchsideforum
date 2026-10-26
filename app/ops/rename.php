<?php
// Change a member's username everywhere it's stored (Super Admins only). Sign-in, password and sessions stay the same.
declare(strict_types=1);

// Columns that hold a username
const RENAME_COLS = [
  ['topics', 'author'], ['posts', 'author'], ['post_likes', 'user'], ['poll_votes', 'user'], ['follows', 'user'], ['bookmarks', 'user'],
  ['topic_reads', 'user'], ['blocks', 'blocker'], ['blocks', 'blocked'], ['conv_members', 'user'], ['msgs', 'from_user'], ['notifs', 'to_user'],
  ['reports', 'by_user'], ['reports', 'closed_by'], ['audit', 'actor'], ['predictions', 'user'], ['aff_clicks', 'user'], ['uploads', 'user'],
  ['reviews', 'user'], ['review_votes', 'user'], ['complaints', 'user'], ['complaints', 'specialist'], ['complaint_msgs', 'by_user'],
  ['complaint_follows', 'user'], ['raffle_rounds', 'winner'], ['raffle_entries', 'user'],
];
// JSON columns that mention usernames under known keys: [table, id column, column]
const RENAME_JSON = [
  ['posts', 'id', 'revisions'], ['reviews', 'id', 'response'], ['reviews', 'id', 'history'], ['complaints', 'id', 'mod_notes'], ['complaints', 'id', 'evidence'],
  ['operators', 'slug', 'data'], ['reports', 'id', 'target'], ['raffle_rounds', 'id', 'draw_info'], ['topics', 'id', 'poll'],
];
// Keys whose value (or list of values) is a username
const RENAME_KEYS = ['by', 'user', 'author', 'actor', 'mods', 'reps', 'names', 'winner', 'specialist', 'claimedBy', 'closedBy'];

function rename_walk(&$v, string $old, string $new, bool $nameList = false): bool {
  if (!is_array($v)) return false;
  $ch = false;
  foreach ($v as $k => &$x) {
    $isName = is_int($k) ? $nameList : in_array($k, RENAME_KEYS, true);
    if (is_string($x)) { if ($isName && $x === $old) { $x = $new; $ch = true; } }
    elseif (is_array($x)) { if (rename_walk($x, $old, $new, $isName && array_is_list($x))) $ch = true; }
  }
  unset($x);
  return $ch;
}
// @mentions and [quote=name] in written text
function rename_text(string $s, string $old, string $new): string {
  $q = preg_quote($old, '/');
  $s = preg_replace('/(?<![\w@])@' . $q . '(?![\w])/u', '@' . $new, $s) ?? $s;
  return preg_replace('/\[quote=' . $q . '(?=[\]#,; ])/u', '[quote=' . $new, $s) ?? $s;
}
function rename_table_ok(string $t): bool {
  try { q("SELECT 1 FROM $t LIMIT 1"); return true; } catch (Throwable $e) { return false; }
}

op('user.rename', function (array $in, array $u) {
  if ($u['role'] !== 'super_admin') fail('Only a Super Admin can change usernames.', 403);
  rate_limit('rename:' . $u['name'], 20, 3600);
  $old = str_in($in, 'user', 40);
  $t = row("SELECT * FROM users WHERE name = ?", [$old]); if (!$t) fail('That member wasn’t found.', 404);
  if ($t['status'] === 'deleted') fail('That account has been deleted.');
  $raw = str_in($in, 'name', 40);
  $new = trim(strtolower(preg_replace('/[^A-Za-z0-9_]+/', '_', $raw) ?? ''), '_');
  if (strlen($new) < 3 || strlen($new) > 24) fail('Usernames have 3 to 24 letters, numbers or underscores.');
  if ($new === $old) fail('That’s already the username.');
  if (in_array($new, RESERVED_NAMES, true) || str_starts_with($new, 'deleted_user')) fail("“{$new}” is reserved. Pick another.");
  if (val("SELECT 1 FROM users WHERE LOWER(name) = ? AND id <> ?", [$new, $t['id']])) fail("“{$new}” is taken. Pick another.");
  $reason = str_in($in, 'reason', 300);

  tx(function () use ($old, $new, $t, $u, $reason) {
    $now = now_ms();
    q("UPDATE users SET name = ?, updated = ? WHERE id = ?", [$new, $now, $t['id']]);
    foreach (RENAME_COLS as [$tbl, $col]) if (rename_table_ok($tbl)) q("UPDATE $tbl SET $col = ? WHERE $col = ?", [$new, $old]);
    $like = '%"' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $old) . '"%';
    foreach (RENAME_JSON as [$tbl, $idc, $col]) {
      if (!rename_table_ok($tbl)) continue;
      foreach (rows("SELECT $idc AS id, $col AS v FROM $tbl WHERE $col LIKE ? ESCAPE '!'", [$like]) as $r) {
        $v = jdec($r['v'], null); if (!is_array($v)) continue;
        if (rename_walk($v, $old, $new)) q("UPDATE $tbl SET $col = ? WHERE $idc = ?", [jenc($v), $r['id']]);
      }
    }
    // @mentions and quotes in posts and messages
    $likeTxt = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $old) . '%';
    foreach ([['posts', 'body'], ['msgs', 'body'], ['complaint_msgs', 'body']] as [$tbl, $col]) {
      if (!rename_table_ok($tbl)) continue;
      foreach (rows("SELECT id, $col AS v FROM $tbl WHERE $col LIKE ? ESCAPE '!'", [$likeTxt]) as $r) {
        $s = rename_text((string) $r['v'], $old, $new); if ($s !== $r['v']) q("UPDATE $tbl SET $col = ? WHERE id = ?", [$s, $r['id']]);
      }
    }
    q("UPDATE notifs SET go = ? WHERE go = ?", ["/members/$new", "/members/$old"]);
    // Site settings: board moderators, moderator profiles and anything else that names the member
    foreach (DOC_KEYS as $k) {
      $r = doc_row($k); if (!$r) continue;
      $v = jdec($r['v'], null); if (!is_array($v)) continue;
      $ch = rename_walk($v, $old, $new);
      if ($k === 'MOD_PROFILES' && array_key_exists($old, $v)) { $v[$new] = $v[$old]; unset($v[$old]); $ch = true; }
      if ($ch) save_doc($k, $k === 'MOD_PROFILES' ? (object) $v : $v);
    }
    // Make open pages pick up the new name on their next refresh
    q("UPDATE topics SET updated = ? WHERE author = ? OR id IN (SELECT topic_id FROM posts WHERE author = ?)", [$now, $new, $new]);
    $actor = $t['id'] === $u['id'] ? array_merge($u, ['name' => $new]) : $u;   // renaming yourself: record it under the new name
    audit($actor, 'Username change', $new, $reason ?: 'Renamed by a Super Admin', $old, $new);
  });
  if ($t['id'] !== $u['id']) notify($new, 'moderator', "Your username is now “{$new}” (it was “{$old}”). Use it to sign in.", "/members/$new", $u);
  return ['name' => $new, 'self' => $t['id'] === $u['id']];
});
