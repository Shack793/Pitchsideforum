<?php
// Pitchside Forum: Bug Reports board with statuses (New → Investigating → Confirmed → Fixed → Closed).
// The status travels as a tag on the topic (bug-new, bug-investigating…), so every visitor sees it and the board's
// tag filter lets anyone list reports by status. Only staff who moderate the board (and admins) change a status;
// the member who reported it is notified each time, and an optional note is posted in the topic.
declare(strict_types=1);

const BUG_BOARD = 'bug-reports';
const BUG_STATUSES = ['bug-new' => 'New', 'bug-investigating' => 'Investigating', 'bug-confirmed' => 'Confirmed', 'bug-fixed' => 'Fixed', 'bug-closed' => 'Closed'];
const BUG_DESC = ['bug-new' => 'Reported, not looked at yet', 'bug-investigating' => 'Staff are looking into it', 'bug-confirmed' => "We can reproduce it; a fix is on the way",
  'bug-fixed' => 'Fixed on the live site', 'bug-closed' => 'Closed: duplicate, not a bug, or no reply'];

function bug_status_of(array $tags): ?string { foreach ($tags as $t) if (isset(BUG_STATUSES[$t])) return $t; return null; }
function bug_set_tags(int $id, array $tags, string $status): array {
  $tags = array_values(array_filter($tags, fn($t) => !isset(BUG_STATUSES[$t]))); $tags[] = $status;
  q("UPDATE topics SET tags = ?, updated = ? WHERE id = ?", [jenc($tags), now_ms(), $id]);
  return $tags;
}

// One-off setup, run by apply.sh: the status tags, the board, and a pinned "how to report a bug" guide
function bug_doc_fresh(string $k): array { $v = val("SELECT v FROM config WHERE k = ?", [$k]); $d = $v === null ? doc($k) : jdec((string) $v, []); return is_array($d) ? $d : []; }
function bugs_install(): array {
  $done = [];
  $tags = bug_doc_fresh('TAGS'); $have = array_column($tags, 'slug'); $add = 0;
  foreach (BUG_STATUSES as $slug => $name) if (!in_array($slug, $have, true)) { $tags[] = ['slug' => $slug, 'name' => $name, 'desc' => 'Bug report status: ' . BUG_DESC[$slug], 'index' => false]; $add++; }
  if ($add) { save_doc('TAGS', $tags); $done[] = "TAGS $add"; }
  $boards = bug_doc_fresh('BOARDS');
  if (!in_array(BUG_BOARD, array_column($boards, 'slug'), true)) {
    $tpl = null; foreach ($boards as $b) if (($b['slug'] ?? '') === 'help') $tpl = $b;
    if (!$tpl) foreach ($boards as $b) if (($b['cat'] ?? '') === 'community' && empty($b['kind'])) { $tpl = $b; break; }
    $roles = ['guest', 'new_member', 'member', 'trusted', 'verified_reviewer', 'verified_seller', 'business', 'moderator', 'senior_moderator', 'admin', 'super_admin'];
    $after = (int) ($tpl['order'] ?? 2);
    foreach ($boards as &$b) if (($b['cat'] ?? '') === 'community' && (int) ($b['order'] ?? 0) > $after) $b['order'] = (int) $b['order'] + 1; unset($b);
    $boards[] = ['slug' => BUG_BOARD, 'name' => 'Bug Reports', 'desc' => "Something broken on Pitchside? Report it here. Each report shows its status: New, Investigating, Confirmed, Fixed or Closed.",
      'cat' => 'community', 'parent' => null, 'icon' => 'B', 'mods' => [], 'readRoles' => $tpl['readRoles'] ?? $roles, 'postRoles' => $tpl['postRoles'] ?? array_values(array_diff($roles, ['guest'])), 'order' => $after + 1];
    save_doc('BOARDS', $boards); $done[] = 'BOARD';
  }
  if (!meta_get('bugs:guide')) {
    $u = row("SELECT * FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY id LIMIT 1") ?: row("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1");
    if ($u) {
      $body = "Found something that isn't working? Start a new topic on this board. Every report gets a status so you can see where it's up to:\n\n"
        . "- **New:** reported, not looked at yet.\n- **Investigating:** staff are looking into it.\n- **Confirmed:** we can reproduce it and a fix is on the way.\n- **Fixed:** fixed on the live site.\n- **Closed:** a duplicate, not a bug, or we couldn't reproduce it.\n\n"
        . "You'll get a notification each time your report changes status. Use the buttons at the top of the board to list reports by status.\n\n"
        . "**To help us fix it fast, include:**\n\n1. What you were trying to do.\n2. What happened instead (the exact error message, if there was one).\n3. The steps to make it happen again.\n4. The page address, and your device and browser (for example: iPhone, Safari).\n5. A screenshot link, if you have one.\n\n"
        . "Search the board first in case someone has already reported it; if so, add your details there. Please don't post passwords, wallet keys or personal details.\n\nSecurity problems that could put members at risk: message the admins privately instead of posting them here.";
      $now = now_ms();
      $id = tx(function () use ($u, $body, $now) {
        $id = insert('topics', ['board' => BUG_BOARD, 'title' => 'How to report a bug', 'author' => $u['name'], 'at' => $now, 'last_at' => $now, 'tags' => '[]', 'teams' => '[]', 'league' => null, 'poll' => null, 'pinned' => 1, 'locked' => 1, 'updated' => $now]);
        insert('posts', ['topic_id' => $id, 'author' => $u['name'], 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
        return $id;
      });
      meta_set('bugs:guide', (string) $id); $done[] = "GUIDE $id";
    }
  }
  return $done;
}

(function () {
  if (!isset($GLOBALS['OPS']['topic.create'])) return;
  $ops = &$GLOBALS['OPS'];
  [$base, $need] = $ops['topic.create'];
  $ops['topic.create'] = [function (array $in, array $u) use ($base) {
    // members can't pick a status themselves
    if (isset($in['tags']) && is_array($in['tags'])) $in['tags'] = array_values(array_filter($in['tags'], fn($t) => !isset(BUG_STATUSES[(string) $t])));
    $res = $base($in, $u);
    if (($in['board'] ?? '') === BUG_BOARD && !empty($res['id'])) {
      $t = row("SELECT tags FROM topics WHERE id = ?", [(int) $res['id']]);
      if ($t) bug_set_tags((int) $res['id'], jdec($t['tags'], []), 'bug-new');
    }
    return $res;
  }, $need];
})();

op('bug.status', function (array $in, array $u) {
  $t = readable_topic(int_in($in, 'id'), $u);
  if ($t['board'] !== BUG_BOARD) fail("That topic isn't a bug report.");
  if (!is_admin($u) && !(is_staff($u) && can_mod_board($u, BUG_BOARD))) fail('Only staff can change a bug report status.', 403);
  $st = str_in($in, 'status', 24); if (!isset(BUG_STATUSES[$st])) fail('Pick a status.');
  $tags = jdec($t['tags'], []); $prev = bug_status_of($tags);
  $note = trim(str_in($in, 'note', 3000));
  if ($prev === $st && $note === '') return ['status' => $st];
  bug_set_tags((int) $t['id'], $tags, $st);
  $label = BUG_STATUSES[$st];
  if ($note !== '') {
    need_ok(content_problem($u, $note));
    $now = now_ms();
    insert('posts', ['topic_id' => (int) $t['id'], 'author' => $u['name'], 'body' => "**Status: $label**\n\n$note", 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    q("UPDATE topics SET last_at = ?, updated = ? WHERE id = ?", [$now, $now, (int) $t['id']]);
  }
  audit($u, 'Bug report status', "topic #{$t['id']} “{$t['title']}”", $note !== '' ? mb_substr($note, 0, 300) : 'Status change', $prev ? BUG_STATUSES[$prev] : 'none', $label);
  if ($prev !== $st) notify($t['author'], 'moderator', "Your bug report “{$t['title']}” is now $label" . ($st === 'bug-fixed' ? '. Thanks for reporting it!' : '.'), "/topic/{$t['id']}", $u);
  return ['status' => $st];
});
