<?php
// Background jobs. setup.sh runs this every 5 minutes:  */5 * * * * php /var/www/pitchside/app/cron.php
//  1. Imports fixtures from the live scores site (Admin → System → Fixtures feed)
//  2. Opens match threads before kick-off and archives old ones
//  3. Emails notifications members haven't seen
//  4. Finishes account deletions after the 30-day grace period
//  5. Tidies up expired sessions, links and counters
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib/api.php';

$lock = fopen(APP_DIR . '/storage/cron.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) exit(0);   // the previous run is still going
$now = now_ms();
$log = fn(string $s) => log_line('cron.log', $s);

/* ---------- 1. Fixtures from the live scores site ----------
   The feed is a JSON array of matches:
   [{"slug":"arsenal-vs-chelsea-2026-10-18","league":"premier-league","home":"arsenal","away":"chelsea",
     "at":"2026-10-18T15:00:00Z","status":"upcoming","score":null}]
   league/home/away use the same slugs as Admin → Sports. Unknown teams can carry "homeName"/"awayName". */
$feed = (string) setting('fixturesFeed', '');
if ($feed !== '' && str_starts_with($feed, 'https://')) {
  $ch = curl_init($feed);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_USERAGENT => 'PitchsideForum/1.0']);
  $res = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $items = $code === 200 ? json_decode((string) $res, true) : null;
  if (is_array($items)) {
    $events = doc('EVENTS'); $bySlug = [];
    foreach ($events as $i => $e) $bySlug[$e['slug']] = $i;
    $n = 0;
    foreach (array_slice($items, 0, 5000) as $m) {
      if (!is_array($m) || empty($m['slug']) || !preg_match('/^[a-z0-9-]{3,128}$/', (string) $m['slug'])) continue;
      $at = is_numeric($m['at'] ?? null) ? (int) $m['at'] : (int) (strtotime((string) ($m['at'] ?? '')) * 1000);
      if (!$at) continue;
      $e = ['slug' => $m['slug'], 'league' => (string) ($m['league'] ?? ''), 'home' => (string) ($m['home'] ?? ''), 'away' => (string) ($m['away'] ?? ''),
        'homeName' => mb_substr((string) ($m['homeName'] ?? ''), 0, 60), 'awayName' => mb_substr((string) ($m['awayName'] ?? ''), 0, 60), 'at' => $at,
        'status' => in_array($m['status'] ?? '', ['upcoming', 'live', 'finished', 'postponed'], true) ? $m['status'] : 'upcoming',
        'score' => is_array($m['score'] ?? null) ? array_map('intval', array_slice($m['score'], 0, 2)) : null,
        // Links to this match and its league on the live scores site, when the feed provides them
        'scoresUrl' => (is_string($m['url'] ?? null) && preg_match('#^https://[^\s"\'<>]+$#', $m['url'])) ? $m['url'] : null,
        'leagueUrl' => (is_string($m['leagueUrl'] ?? null) && preg_match('#^https://[^\s"\'<>]+$#', $m['leagueUrl'])) ? $m['leagueUrl'] : null, 'minute' => mb_substr((string) ($m['minute'] ?? ''), 0, 8), 'stats' => (object) [], 'lineups' => null];
      if (isset($bySlug[$e['slug']])) { $e['thread'] = $events[$bySlug[$e['slug']]]['thread'] ?? null; $events[$bySlug[$e['slug']]] = $e; }
      else { $e['thread'] = null; $events[] = $e; $bySlug[$e['slug']] = count($events) - 1; }
      $n++;
    }
    // Keep 60 days of history
    $events = array_values(array_filter($events, fn($e) => $e['at'] > $now - 60 * DAY_MS));
    save_doc('EVENTS', $events);
    $log("fixtures: $n from feed"); meta_set('fixtures:last', gmdate('j M H:i') . " UTC: $n matches");
  } else { $log("fixtures: feed failed (HTTP $code)"); meta_set('fixtures:last', gmdate('j M H:i') . " UTC: failed (HTTP $code)"); }
}

/* ---------- 2. Match threads ---------- */
$lead = (float) setting('matchThreadLeadHrs', 2) * 3600000;
foreach (doc('EVENTS') as $e) {
  if (empty($e['thread']) && ($e['status'] ?? '') !== 'postponed' && $e['at'] > $now - 3 * 3600000 && $e['at'] - $lead <= $now) {
    try { $id = create_match_thread($e, null); if ($id) $log("match thread #$id for {$e['slug']}"); } catch (Throwable $x) { $log('match thread failed: ' . $x->getMessage()); }
  }
}
$archive = (int) setting('archiveAfterDays', 30);
if ($archive > 0) q("UPDATE topics SET archived = 1, pinned = 0, updated = ? WHERE auto = 1 AND archived = 0 AND last_at < ?", [$now, $now - $archive * DAY_MS]);
// Match threads stay pinned only around the game
q("UPDATE topics SET pinned = 0, updated = ? WHERE auto = 1 AND pinned = 1 AND at < ?", [$now, $now - 2 * DAY_MS]);

/* ---------- 2b. Complaints: operators get 7 days to answer ---------- */
if (function_exists('set_case_status')) foreach (rows("SELECT * FROM complaints WHERE status = 'Awaiting Business' AND deadline IS NOT NULL AND deadline < ?", [$now]) as $c) {
  try {
    case_msg($c['id'], 'system', 'No operator response in 7 days. A specialist will decide the case.', 'system');
    set_case_status($c, 'Under Investigation', null, 'Operator missed the 7-day deadline');
    insert('reports', ['queue' => 'complaints', 'kind' => 'complaint', 'target' => jenc(['complaint' => $c['id']]), 'board' => null, 'reason' => 'Operator missed the 7-day deadline: record an outcome (No Response?)', 'by_user' => 'system', 'at' => $now, 'status' => 'open', 'updated' => $now]);
    $log("complaint {$c['id']}: operator deadline passed");
  } catch (Throwable $x) { $log('complaint deadline failed: ' . $x->getMessage()); }
}

/* ---------- 3. Email notifications (at most one email per member per hour) ---------- */
if (mail_ready()) {
  $due = rows("SELECT DISTINCT to_user FROM notifs WHERE is_read = 0 AND emailed = 0 AND at < ? AND at > ?", [$now - 10 * 60000, $now - 3 * DAY_MS]);
  foreach ($due as $r) {
    $u = user_by_name($r['to_user']);
    if (!$u || $u['status'] === 'deleted' || !$u['email_verified'] || empty($u['profile']['notify']['email'])) { q("UPDATE notifs SET emailed = 1 WHERE to_user = ? AND emailed = 0", [$r['to_user']]); continue; }
    if ($u['last_seen'] > $now - 10 * 60000) continue;   // they're on the site right now
    $last = (int) (val("SELECT v FROM meta WHERE k = ?", ['mailed:' . $u['name']]) ?? 0);
    if ($last > $now - 3600000) continue;
    $ns = rows("SELECT * FROM notifs WHERE to_user = ? AND is_read = 0 AND emailed = 0 ORDER BY id DESC LIMIT 10", [$u['name']]);
    if (!$ns) continue;
    $lines = implode("\n", array_map(fn($n) => '• ' . $n['text'] . "\n  " . site_url($n['go']), $ns));
    send_mail($u['email'], count($ns) === 1 ? $ns[0]['text'] : count($ns) . ' new notifications on Pitchside Forum',
      "Hi {$u['name']},\n\n$lines\n\nTurn these emails off in Settings → Notifications: " . site_url('/settings') . "\n\nPitchside Forum");
    q("UPDATE notifs SET emailed = 1 WHERE to_user = ? AND emailed = 0", [$u['name']]);
    if (!q("UPDATE meta SET v = ? WHERE k = ?", [(string) $now, 'mailed:' . $u['name']])->rowCount()) insert_ignore('meta', ['k' => 'mailed:' . $u['name'], 'v' => (string) $now]);
  }
}

/* ---------- 4. Account deletions after the grace period ---------- */
foreach (rows("SELECT * FROM users WHERE delete_after IS NOT NULL AND delete_after < ?", [$now]) as $r) {
  $old = $r['name']; $new = 'deleted_user_' . $r['id'];
  tx(function () use ($r, $old, $new, $now) {
    q("UPDATE users SET name = ?, email = ?, pass = ?, status = 'deleted', profile = ?, totp_secret = NULL, totp_on = 0, delete_after = NULL, updated = ? WHERE id = ?",
      [$new, "$new@deleted.invalid", hash_pw(rand_token(16)), jenc(PROFILE_DEFAULTS), $now, $r['id']]);
    foreach ([['posts', 'author'], ['topics', 'author'], ['msgs', 'from_user'], ['conv_members', 'user'], ['post_likes', 'user'], ['poll_votes', 'user'], ['reports', 'by_user'], ['predictions', 'user']] as [$t, $c])
      q("UPDATE $t SET $c = ? WHERE $c = ?", [$new, $old]);
    foreach (['follows' => 'user', 'bookmarks' => 'user', 'topic_reads' => 'user', 'notifs' => 'to_user'] as $t => $c) q("DELETE FROM $t WHERE $c = ?", [$old]);
    q("DELETE FROM blocks WHERE blocker = ? OR blocked = ?", [$old, $old]);
    q("DELETE FROM sessions WHERE user_id = ?", [$r['id']]); q("DELETE FROM tokens WHERE user_id = ?", [$r['id']]);
    q("UPDATE topics SET updated = ? WHERE author = ? OR id IN (SELECT topic_id FROM posts WHERE author = ?)", [$now, $new, $new]);
  });
  $log("deleted account #{$r['id']}");
}

/* ---------- 5. AI Community pilot (disabled unless explicitly configured) ---------- */
require_once APP_DIR . '/ai-community/service.php';
ai_community_cron();
ai_moderation_cron();

/* ---------- 6. Housekeeping ---------- */
q("DELETE FROM sessions WHERE last_seen < ?", [$now - SESSION_DAYS * DAY_MS]);
q("DELETE FROM sessions WHERE pending_2fa = 1 AND created < ?", [$now - 3600000]);
q("DELETE FROM tokens WHERE expires < ?", [$now]);
q("DELETE FROM rate_hits WHERE win < ?", [time() - 2 * 86400]);   // the longest limit window is one day
q("DELETE FROM notifs WHERE at < ? AND is_read = 1", [$now - 180 * DAY_MS]);
meta_set('cron:last', (string) now_ms());
flock($lock, LOCK_UN);
