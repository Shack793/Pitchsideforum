<?php
// Turns database rows into the shapes the browser app works with, and builds the sync payload.
declare(strict_types=1);

const TOPIC_WINDOW_DAYS = 180;   // topics active in this window load with the page; older ones load when opened
const TOPIC_WINDOW_MAX = 1500;

function user_out(array $u, ?array $viewer): array {
  $p = $u['profile']; $mine = $viewer && $viewer['id'] === $u['id']; $staff = is_staff($viewer);
  $o = ['name' => $u['name'], 'role' => $u['role'], 'joined' => $u['joined'], 'posts' => $u['posts'], 'topics' => $u['topics'], 'likes' => $u['likes'],
    'rep' => $p['rep'], 'badges' => $p['badges'], 'favTeams' => $p['favTeams'], 'favSports' => $p['favSports'], 'about' => $p['about'], 'website' => $p['website'],
    'avatar' => $p['avatar'], 'avatarColor' => $p['avatarColor'], 'sig' => $p['sig'], 'hideSigs' => false,
    'privacy' => ['dms' => $p['privacy']['dms'] ?? 'members', 'showActivity' => $p['privacy']['showActivity'] ?? true],
    'status' => $u['status'] === 'deleted' ? 'banned' : $u['status'], 'warnings' => ($mine || $staff) ? $u['warnings'] : 0,
    'notify' => ['email' => true, 'browser' => true, 'push' => false], 'twoFA' => false, 'verified' => ($mine || $staff) ? (bool) $u['email_verified'] : true,
    'business' => $p['business'] ?? null, 'wallets' => [], 'lastSeen' => ($p['privacy']['showActivity'] ?? true) || $staff ? $u['last_seen'] : 0];
  if ($mine) { $o['hideSigs'] = (bool) $p['hideSigs']; $o['notify'] = $p['notify']; $o['twoFA'] = (bool) $u['totp_on']; $o['email'] = $u['email']; $o['needsVerify'] = needs_verify($u); }
  if ($staff && can($viewer, 'managePermissions')) $o['email'] = $u['email'];
  return $o;
}
function users_out(array $names, ?array $viewer): array {
  $names = array_values(array_unique(array_filter($names, fn($n) => is_string($n) && $n !== '' && $n !== 'system')));
  $o = [];
  foreach (array_chunk($names, 400) as $chunk)
    foreach (rows("SELECT * FROM users WHERE name IN (" . in_list($chunk) . ")", $chunk) as $r) { $u = user_from_row($r); $o[$u['name']] = user_out($u, $viewer); }
  return $o;
}

/* ---------- Topics ---------- */
function topic_visible(array $t, ?array $viewer): bool {
  $b = board_doc($t['board']);
  if (!$b || !can_read_board($viewer, $b)) return false;
  if ((int) $t['deleted'] && !can_mod_board($viewer, $t['board'])) return false;
  // Sections that aren't open yet, and removed reviews (still visible to their author and moderators)
  if (($b['kind'] ?? '') === 'review' && !feature_on('casinos') && !is_staff($viewer)) return false;
  if ($t['board'] === 'complaint-talk' && !feature_on('complaints') && !is_staff($viewer)) return false;
  if (!empty($t['review_id'])) {
    $r = row("SELECT user, status FROM reviews WHERE id = ?", [(int) $t['review_id']]);
    if ($r && $r['status'] === 'removed' && !mp($viewer, 'review.moderate') && !($viewer && $viewer['name'] === $r['user'])) return false;
  }
  return true;
}
// Builds full topic objects (with posts, likes and poll) for a list of topic rows.
function topics_out(array $trows, ?array $viewer): array {
  $trows = array_values(array_filter($trows, fn($t) => topic_visible($t, $viewer)));
  if (!$trows) return [];
  $ids = array_map(fn($t) => (int) $t['id'], $trows);
  $posts = []; $likes = []; $votes = [];
  foreach (array_chunk($ids, 500) as $chunk) {
    foreach (rows("SELECT * FROM posts WHERE topic_id IN (" . in_list($chunk) . ") ORDER BY at, id", $chunk) as $p) $posts[(int) $p['topic_id']][] = $p;
    foreach (rows("SELECT l.post_id, l.user FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.topic_id IN (" . in_list($chunk) . ")", $chunk) as $l) $likes[(int) $l['post_id']][] = $l['user'];
    foreach (rows("SELECT * FROM poll_votes WHERE topic_id IN (" . in_list($chunk) . ")", $chunk) as $v) $votes[(int) $v['topic_id']][(int) $v['opt']][] = $v['user'];
  }
  $out = [];
  foreach ($trows as $t) {
    $id = (int) $t['id']; $mod = can_mod_board($viewer, $t['board']);
    $ps = [];
    foreach ($posts[$id] ?? [] as $p) {
      $hidden = (bool) $p['hidden']; $show = !$hidden || $mod || ($viewer && $viewer['name'] === $p['author']);
      $ps[] = ['id' => (int) $p['id'], 'author' => $p['author'], 'body' => $show ? $p['body'] : '', 'at' => (int) $p['at'], 'hidden' => $hidden,
        'likes' => $likes[(int) $p['id']] ?? [], 'revisions' => $show ? jdec($p['revisions'], []) : []];
    }
    if (!$ps) continue;
    $poll = jdec($t['poll'], null);
    if ($poll) {
      // Who voted stays private: the browser gets counts, plus whether you voted.
      foreach ($poll['options'] as $i => &$o) {
        $vs = $votes[$id][$i] ?? []; $mine = $viewer && in_array($viewer['name'], $vs, true);
        $o['v'] = $mine ? [$viewer['name']] : [];
        for ($k = 1; $k <= count($vs) - ($mine ? 1 : 0); $k++) $o['v'][] = "·$k";
      }
      unset($o);
    }
    $out[] = ['id' => $id, 'board' => $t['board'], 'title' => $t['title'], 'author' => $t['author'], 'at' => (int) $t['at'], 'posts' => $ps,
      'pinned' => (bool) $t['pinned'], 'locked' => (bool) $t['locked'], 'archived' => (bool) $t['archived'], 'deleted' => (bool) $t['deleted'],
      'mergedInto' => $t['merged_into'] ? (int) $t['merged_into'] : null, 'auto' => (bool) $t['auto'],
      'tags' => jdec($t['tags'], []), 'teams' => jdec($t['teams'], []), 'league' => $t['league'], 'event' => $t['event'], 'views' => (int) $t['views'], 'poll' => $poll,
      'review' => !empty($t['review_id']) ? (int) $t['review_id'] : null, 'complaint' => $t['complaint_id'] ?? null];
  }
  return $out;
}
function touch_topic(int $id): void { q("UPDATE topics SET updated = ? WHERE id = ?", [now_ms(), $id]); }

/* ---------- Messages, notifications, reports ---------- */
function convs_out(string $me, int $since): array {
  $ids = array_map(fn($r) => (int) $r['conv_id'], rows("SELECT cm.conv_id FROM conv_members cm JOIN convs c ON c.id = cm.conv_id WHERE cm.user = ? AND c.updated > ?", [$me, $since]));
  if (!$ids) return [];
  $members = []; $reads = []; $msgs = [];
  foreach (rows("SELECT * FROM conv_members WHERE conv_id IN (" . in_list($ids) . ") ORDER BY pos", $ids) as $m) { $members[(int) $m['conv_id']][] = $m['user']; $reads[(int) $m['conv_id']][$m['user']] = (int) $m['read_n']; }
  foreach (rows("SELECT * FROM msgs WHERE conv_id IN (" . in_list($ids) . ") ORDER BY id", $ids) as $m)
    $msgs[(int) $m['conv_id']][] = ['id' => (int) $m['id'], 'from' => $m['from_user'], 'body' => $m['body'], 'at' => (int) $m['at'], 'att' => jdec($m['att'], []), 'notice' => (bool) $m['notice'], 'reported' => (bool) $m['reported']];
  $out = [];
  foreach (rows("SELECT * FROM convs WHERE id IN (" . in_list($ids) . ")", $ids) as $c)
    $out[] = ['id' => (int) $c['id'], 'title' => $c['title'], 'kind' => $c['kind'], 'members' => $members[(int) $c['id']] ?? [], 'msgs' => $msgs[(int) $c['id']] ?? [], 'read' => (object) ($reads[(int) $c['id']] ?? [])];
  return $out;
}
function notif_out(array $n): array { return ['id' => (int) $n['id'], 'to' => $n['to_user'], 'type' => $n['type'], 'text' => $n['text'], 'go' => $n['go'], 'at' => (int) $n['at'], 'read' => (bool) $n['is_read']]; }
function report_out(array $r): array { return ['id' => (int) $r['id'], 'queue' => $r['queue'], 'kind' => $r['kind'], 'target' => jdec($r['target'], []), 'board' => $r['board'], 'reason' => $r['reason'],
  'by' => $r['by_user'], 'at' => (int) $r['at'], 'status' => $r['status'], 'closedBy' => $r['closed_by'], 'closedAt' => $r['closed_at'] ? (int) $r['closed_at'] : null]; }
function queue_perm(string $q): string { return $q === 'sellers' ? 'seller.verify' : "queue.$q"; }
function report_visible(array $r, array $viewer): bool { return mp($viewer, queue_perm($r['queue'])) && (!$r['board'] || can_mod_board($viewer, $r['board'])); }

/* ---------- Side effects: notifications and the audit log ---------- */
function notify(?string $to, string $type, string $text, string $go, ?array $actor = null): void {
  if (!$to || ($actor && $to === $actor['name'])) return;
  if (!val("SELECT 1 FROM users WHERE name = ? AND status <> 'deleted'", [$to])) return;
  insert('notifs', ['to_user' => $to, 'type' => $type, 'text' => mb_substr($text, 0, 400), 'go' => mb_substr($go, 0, 255), 'at' => now_ms(), 'is_read' => 0, 'emailed' => 0, 'updated' => now_ms()]);
}
function audit(?array $actor, string $action, string $object, string $reason, string $prev, string $next): void {
  insert('audit', ['at' => now_ms(), 'actor' => $actor ? $actor['name'] : 'system', 'action' => mb_substr($action, 0, 80), 'object' => mb_substr($object, 0, 200),
    'reason' => mb_substr($reason, 0, 1000), 'prev' => mb_substr($prev, 0, 400), 'next' => mb_substr($next, 0, 400)]);
}

/* ---------- Public numbers for the Community pulse ---------- */
function stats_out(?array $viewer): array {
  $day = now_ms() - DAY_MS;
  $o = ['members' => (int) val("SELECT COUNT(*) FROM users WHERE status <> 'deleted'"),
    'online' => (int) val("SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_seen > ?", [now_ms() - 15 * 60000]),
    'topicsToday' => (int) val("SELECT COUNT(*) FROM topics WHERE at > ? AND deleted = 0", [$day]),
    'postsToday' => (int) val("SELECT COUNT(*) FROM posts WHERE at > ?", [$day])];
  if ($viewer && can($viewer, 'manageCategories')) {
    $o['dau'] = (int) val("SELECT COUNT(*) FROM users WHERE last_seen > ?", [$day]);
    $o['mau'] = (int) val("SELECT COUNT(*) FROM users WHERE last_seen > ?", [now_ms() - 30 * DAY_MS]);
    $o['newUsers7'] = (int) val("SELECT COUNT(*) FROM users WHERE joined > ?", [now_ms() - 7 * DAY_MS]);
    $o['posters7'] = (int) val("SELECT COUNT(DISTINCT author) FROM posts WHERE at > ?", [now_ms() - 7 * DAY_MS]);
    $o['totalTopics'] = (int) val("SELECT COUNT(*) FROM topics WHERE deleted = 0");
    $o['totalPosts'] = (int) val("SELECT COUNT(*) FROM posts");
    $o['mailReady'] = mail_ready();
    if (can($viewer, 'system')) {
      $b = jdec(@file_get_contents(APP_DIR . '/storage/backup.json') ?: null, []);
      $o['jobs'] = ['cron' => (int) meta_get('cron:last', '0'), 'fixtures' => meta_get('fixtures:last'), 'backup' => (int) ($b['last'] ?? 0) * 1000, 'offsite' => (int) ($b['offsite'] ?? 0) * 1000];
    }
  }
  return $o;
}

/* ---------- Sync: everything the browser needs, or everything that changed since its last sync ---------- */
function sync_payload(?array $viewer, int $since = 0): array {
  $now = now_ms(); $s = current_session();
  $out = ['now' => $now, 'me' => $viewer ? $viewer['name'] : null, 'csrf' => $s ? $s['csrf'] : null, 'full' => $since === 0,
    'pending2fa' => $s && (int) $s['pending_2fa'] ? true : false];
  [$out['docs'], $out['docVers']] = docs_out($viewer, $since);

  // Topics
  if ($since === 0) {
    $trows = rows("SELECT * FROM topics WHERE (last_at > ? OR pinned = 1) ORDER BY last_at DESC LIMIT " . TOPIC_WINDOW_MAX, [$now - TOPIC_WINDOW_DAYS * DAY_MS]);
  } else {
    $trows = rows("SELECT * FROM topics WHERE updated > ? ORDER BY last_at DESC LIMIT 500", [$since]);
    $out['gone'] = array_values(array_map(fn($t) => (int) $t['id'], array_filter($trows, fn($t) => !topic_visible($t, $viewer))));
  }
  $out['topics'] = topics_out($trows, $viewer);

  // Members referenced by what we're sending, plus staff and anyone changed since the last sync
  $names = [];
  foreach ($out['topics'] as $t) { $names[] = $t['author']; foreach ($t['posts'] as $p) $names[] = $p['author']; }
  if ($since === 0) {
    foreach (rows("SELECT name FROM users WHERE role IN ('moderator','senior_moderator','admin','super_admin') OR last_seen > ? ORDER BY last_seen DESC LIMIT 400", [$now - 30 * DAY_MS]) as $r) $names[] = $r['name'];
  } else {
    foreach (rows("SELECT name FROM users WHERE updated > ? LIMIT 300", [$since]) as $r) $names[] = $r['name'];
  }

  if ($viewer) {
    $me = $viewer['name']; $names[] = $me;
    $out['convs'] = convs_out($me, $since);
    foreach ($out['convs'] as $c) foreach ($c['members'] as $m) $names[] = $m;
    $out['notifs'] = array_map('notif_out', rows("SELECT * FROM notifs WHERE to_user = ? AND updated > ? ORDER BY id DESC LIMIT 150", [$me, $since]));
    $out['follows'] = array_map(fn($r) => $r['k'], rows("SELECT k FROM follows WHERE user = ?", [$me]));
    $out['bookmarks'] = array_map(fn($r) => (int) $r['topic_id'], rows("SELECT topic_id FROM bookmarks WHERE user = ?", [$me]));
    $out['reads'] = (object) array_column(array_map(fn($r) => [(int) $r['topic_id'], (int) $r['n']], rows("SELECT topic_id, n FROM topic_reads WHERE user = ?", [$me])), 1, 0);
    $out['blocks'] = ['mine' => array_map(fn($r) => $r['blocked'], rows("SELECT blocked FROM blocks WHERE blocker = ?", [$me])),
      'by' => array_map(fn($r) => $r['blocker'], rows("SELECT blocker FROM blocks WHERE blocked = ?", [$me]))];
    if (is_staff($viewer)) {
      $rs = rows("SELECT * FROM reports WHERE updated > ? AND (status = 'open' OR closed_at > ?) ORDER BY id DESC LIMIT 1000", [$since, $now - 30 * DAY_MS]);
      $out['reports'] = array_values(array_map('report_out', array_filter($rs, fn($r) => report_visible($r, $viewer))));
      foreach ($out['reports'] as $r) { $names[] = $r['by']; if (!empty($r['target']['user'])) $names[] = $r['target']['user']; }
      // Reported topics outside the loaded window still need to show in the queue
      $need = array_unique(array_filter(array_map(fn($r) => (int) ($r['target']['topic'] ?? 0), $out['reports'])));
      $have = array_flip(array_map(fn($t) => $t['id'], $out['topics']));
      $need = array_values(array_filter($need, fn($id) => !isset($have[$id])));
      if ($need) foreach (topics_out(rows("SELECT * FROM topics WHERE id IN (" . in_list($need) . ")", $need), $viewer) as $t) { $out['topics'][] = $t; $names[] = $t['author']; }
      // Conversations named in message reports, so moderators can read the reported message
      $out['reportedMsgs'] = [];
      foreach ($out['reports'] as $r) if ($r['kind'] === 'message' && !empty($r['target']['msg'])) {
        $m = row("SELECT id, conv_id, from_user, body, at FROM msgs WHERE id = ?", [(int) $r['target']['msg']]);
        if ($m) { $out['reportedMsgs'][] = ['conv' => (int) $m['conv_id'], 'id' => (int) $m['id'], 'from' => $m['from_user'], 'body' => $m['body'], 'at' => (int) $m['at']]; $names[] = $m['from_user']; }
      }
    }
    if (can($viewer, 'manageCategories')) {
      $out['audit'] = array_map(fn($a) => ['id' => (int) $a['id'], 'at' => (int) $a['at'], 'actor' => $a['actor'], 'action' => $a['action'], 'object' => $a['object'], 'reason' => $a['reason'], 'prev' => $a['prev'], 'next' => $a['next']],
        rows("SELECT * FROM audit WHERE at > ? ORDER BY id DESC LIMIT 1000", [$since ?: $now - 365 * DAY_MS]));
      $out['affClicks'] = array_map(fn($c) => ['link' => (int) $c['link'], 'placement' => $c['placement'], 'at' => (int) $c['at'], 'visitor' => $c['visitor'], 'user' => $c['user'], 'page' => $c['page']],
        rows("SELECT * FROM aff_clicks WHERE at > ? ORDER BY id DESC LIMIT 20000", [$since ?: $now - 90 * DAY_MS]));
    }
  }
  // Phase 2: casinos & sportsbooks, reviews, complaints
  if (feature_on('casinos') || feature_on('complaints') || is_staff($viewer)) {
    $out['operators'] = operators_out($since);
    $out['reviews'] = reviews_out($viewer, $since);
    $out['complaints'] = complaints_out($viewer, $since);
    foreach ($out['reviews'] as $r) $names[] = $r['user'];
    foreach ($out['complaints'] as $c) { $names[] = $c['user']; if ($c['specialist']) $names[] = $c['specialist']; foreach ($c['messages'] as $m) $names[] = $m['by']; }
    foreach ($out['operators'] as $o) foreach ($o['reps'] ?? [] as $r) $names[] = $r;
    if ($since === 0) {
      // Review and complaint discussion topics, even older ones
      $need = array_values(array_filter(array_merge(array_column($out['reviews'], 'thread'), array_column($out['complaints'], 'thread'))));
      $have = array_flip(array_map(fn($t) => $t['id'], $out['topics']));
      $need = array_values(array_filter($need, fn($id) => !isset($have[$id])));
      foreach (array_chunk($need, 500) as $ch) foreach (topics_out(rows("SELECT * FROM topics WHERE id IN (" . in_list($ch) . ")", $ch), $viewer) as $t) { $out['topics'][] = $t; $names[] = $t['author']; foreach ($t['posts'] as $p) $names[] = $p['author']; }
    }
  }
  $out['predictions'] = [];
  foreach (rows("SELECT event, user, v FROM predictions WHERE at > ?", [$since]) as $p) $out['predictions'][$p['event']][$p['user']] = $p['v'];
  $out['users'] = (object) users_out($names, $viewer);
  $out['stats'] = stats_out($viewer);
  $out['site'] = ['turnstile' => cfg('turnstile_site_key') ?: null, 'mail' => mail_ready(), 'name' => 'Pitchside Forum'];
  return $out;
}
