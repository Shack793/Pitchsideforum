<?php
// Pitchside Forum installer. Creates the tables, loads the default site settings and makes the first Super Admin.
//   php app/install.php --admin=yourname --email=you@example.com --password='…' [--demo]
// Safe to run again: existing tables, settings and accounts are left alone.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib/api.php';

$opt = getopt('', ['admin:', 'email:', 'password:', 'demo', 'reset-settings:']);
$say = fn(string $s) => fwrite(STDOUT, $s . "\n");

/* ---------- 1. Tables ---------- */
$sql = file_get_contents(__DIR__ . '/schema.sql');
$sql = preg_replace('/^--.*$/m', '', $sql);
$statements = array_filter(array_map('trim', explode(';', $sql)));
foreach ($statements as $st) {
  if (cfg('db_driver') === 'sqlite') foreach (sqlite_statements($st) as $s2) db()->exec($s2);
  else db()->exec($st);
}
// Columns added after the first release (safe to run again)
function has_column(string $table, string $col): bool {
  if (cfg('db_driver') === 'sqlite') { foreach (rows("PRAGMA table_info($table)") as $c) if ($c['name'] === $col) return true; return false; }
  return (bool) row("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [$table, $col]);
}
foreach ([['topics', 'review_id', 'INT NULL'], ['topics', 'complaint_id', 'VARCHAR(16) NULL'], ['raffle_rounds', 'rules', 'MEDIUMTEXT NULL'], ['raffle_rounds', 'rules_at', 'BIGINT NULL']] as [$t, $c, $type])
  if (!has_column($t, $c)) db()->exec("ALTER TABLE $t ADD COLUMN $c $type");
$say('Tables ready.');

// Turns the MySQL schema into SQLite (used only for local testing).
function sqlite_statements(string $st): array {
  if (!preg_match('/CREATE TABLE IF NOT EXISTS (\w+)/', $st, $m)) return [$st];
  $table = $m[1]; $idx = []; $lines = [];
  foreach (explode("\n", $st) as $line) {
    $l = trim($line);
    if (preg_match('/^(UNIQUE )?KEY (\w+) \(([^)]+)\),?$/', $l, $k)) { $idx[] = 'CREATE ' . ($k[1] ? 'UNIQUE ' : '') . "INDEX IF NOT EXISTS {$table}_{$k[2]} ON $table ({$k[3]})"; continue; }
    if (str_starts_with($l, ') ENGINE')) { $lines[] = ')'; continue; }
    $l = str_replace('INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT', $l);
    $l = str_replace('INT UNSIGNED', 'INTEGER', $l);
    $lines[] = $l;
  }
  $body = implode("\n", $lines);
  $body = preg_replace('/,\s*\n\)/', "\n)", $body);
  return array_merge([$body], $idx);
}

/* ---------- 2. Default settings ---------- */
$seed = json_decode(file_get_contents(__DIR__ . '/seed/docs.json'), true);
$now = now_ms();
$resolve = function ($v) use (&$resolve, $now) {
  if (is_array($v)) { if (isset($v['$rel']) && count($v) === 1) return $now + (int) $v['$rel']; foreach ($v as $k => $x) $v[$k] = $resolve($x); }
  return $v;
};
$reset = isset($opt['reset-settings']) ? explode(',', (string) $opt['reset-settings']) : [];
foreach (DOC_KEYS as $k) {
  if (!array_key_exists($k, $seed)) continue;
  if (doc_row($k) && !in_array($k, $reset, true)) continue;
  $v = clean_doc($resolve($seed[$k]), $k);
  if ($k === 'MOD_PROFILES' || $k === 'SPORT_BOARD') $v = (object) $v;
  save_doc($k, $v);
  $say("Loaded default settings: $k");
}

/* ---------- Upgrades for sites installed with an earlier phase ---------- */
// Reads a setting straight from the database, so one upgrade step never overwrites the step before it
function fresh_doc(string $k) { $r = doc_row($k); return $r ? jdec($r['v'], []) : []; }
// Promotions & bonuses page: add it to the Gambling menu once (an admin can rename or hide it in Admin → Navigation)
if (!meta_get('nav:promotions')) {
  $nav = fresh_doc('NAV');
  foreach ($nav as &$n) if (($n['id'] ?? '') === 'gambling') {
    $n['match'] = array_values(array_unique(array_merge($n['match'] ?? [], ['/promotions'])));
    $paths = array_column($n['children'] ?? [], 'path');
    if (!in_array('/promotions', $paths, true)) array_splice($n['children'], 2, 0, [['label' => 'Promotions & bonuses', 'path' => '/promotions', 'hint' => 'Latest casino and sportsbook offers']]);
  }
  unset($n); save_doc('NAV', $nav); meta_set('nav:promotions', '1'); $say('Added Promotions & bonuses to the Gambling menu.');
}
// Weekly raffle page: add it to the Gambling menu once, after Promotions
if (!meta_get('nav:raffle')) {
  $nav = fresh_doc('NAV');
  foreach ($nav as &$n) if (($n['id'] ?? '') === 'gambling') {
    $n['match'] = array_values(array_unique(array_merge($n['match'] ?? [], ['/raffle'])));
    $paths = array_column($n['children'] ?? [], 'path');
    if (!in_array('/raffle', $paths, true)) { $at = array_search('/promotions', $paths, true); array_splice($n['children'], $at === false ? 2 : $at + 1, 0, [['label' => 'Weekly raffle', 'path' => '/raffle', 'hint' => 'Free to enter: win USDT every week']]); }
  }
  unset($n); save_doc('NAV', $nav); meta_set('nav:raffle', '1'); $say('Added Weekly raffle to the Gambling menu.');
}
// Live Scores links: replace the placeholder address with LiveScoreNow (an address an admin has set in Admin → System is kept)
$s = fresh_doc('SETTINGS');
if (($s['scoresUrl'] ?? '') === '' || str_contains((string) $s['scoresUrl'], 'scores.pitchside.example')) {
  $s['scoresUrl'] = 'https://livescorenow.xyz'; save_doc('SETTINGS', $s); $say('Live Scores links now point to https://livescorenow.xyz');
}
// Post ranks get sports names (once). Only ranks still using an old default name are renamed, so names an admin chose are kept.
if (!meta_get('ranks:sports-names')) {
  $map = ['New Member' => 'Rookie', 'Member' => 'Contender', 'Active Member' => 'Starter', 'Established Member' => 'Playmaker',
    'Senior Member' => 'Captain', 'Veteran' => 'MVP', 'Community Expert' => 'Legend', 'Community Leader' => 'GOAT'];
  $ranks = fresh_doc('RANKS'); $ch = 0;
  foreach ($ranks as &$r) if (isset($map[$r['name'] ?? ''])) { $r['name'] = $map[$r['name']]; $ch++; }
  unset($r);
  if ($ch) { save_doc('RANKS', $ranks); $say("Renamed $ch post rank" . ($ch > 1 ? 's' : '') . ' (Rookie, Contender, Starter, Playmaker, Captain, MVP, Legend, GOAT).'); }
  meta_set('ranks:sports-names', '1');
}
// Casino listings researched in October 2026 (two batches): each batch is added once. An operator already listed
// (same address, name or slug) is left exactly as it is, so your own edits are never overwritten.
foreach ([['import:operators-2026-10', 'operators-2026-10.json'], ['import:operators-2026-10b', 'operators-2026-10b.json']] as [$flag, $file]) {
  if (meta_get($flag) || !is_file(__DIR__ . "/seed/$file")) continue;
  $added = 0; $skipped = [];
  $have = []; foreach (rows("SELECT slug, data FROM operators") as $r) { $d = jdec($r['data'], []); $have[] = strtolower((string) ($d['name'] ?? '')); $have[] = strtolower(preg_replace('#^www\.#', '', (string) ($d['website'] ?? ''))); $have[] = $r['slug']; }
  foreach (json_decode(file_get_contents(__DIR__ . "/seed/$file"), true) ?: [] as $x) {
    if (array_intersect([$x['slug'], strtolower($x['name']), strtolower($x['website'])], $have)) { $skipped[] = $x['name']; continue; }
    $kind = $x['kind'] ?? 'both';
    op_save(array_merge(['reps' => [], 'claimed' => false, 'verified' => false, 'featured' => false, 'affiliate' => false, 'warning' => null, 'blacklist' => null, 'pendingClaim' => null,
      'countries' => [], 'logo' => null, 'images' => []], $x, ['type' => $kind === 'sportsbook' ? 'sportsbook' : 'casino', 'casino' => $kind !== 'sportsbook', 'sportsbook' => $kind !== 'casino']));
    $added++;
  }
  meta_set($flag, '1');
  if ($added) audit(null, 'Operator added', "$added casinos and sportsbooks", 'Imported listings (October 2026 research)', 'none', 'saved');
  $say("Added $added casino listing" . ($added === 1 ? '' : 's') . ($skipped ? ' (already listed, left unchanged: ' . implode(', ', $skipped) . ')' : '') . '.');
}
// Starting Top picks on the casino list: feature Pinnacle and Jackbit, once, and only if no casino is featured yet
if (!meta_get('featured:2026-10-28')) {
  $any = false; foreach (rows("SELECT data FROM operators") as $r) if (!empty(jdec($r['data'], [])['featured'])) { $any = true; break; }
  $done = [];
  if (!$any) foreach (['pinnacle', 'jackbit'] as $sl) if (val("SELECT 1 FROM operators WHERE slug = ?", [$sl])) { $o = op_get($sl); $o['featured'] = true; op_save($o); $done[] = $o['name']; }
  meta_set('featured:2026-10-28', '1');
  if ($done) { audit(null, 'Commercial setting', implode(', ', $done), 'featured toggled', 'off', 'on'); $say('Featured ' . implode(' and ', $done) . ' as Top picks on the casino list (change in Admin → Businesses).'); }
}
// Forum rep (likes received) and post counts (which set each member's rank) from visible posts only
$n = forum_rep_sync(); if ($n) $say("Forum rep and post counts worked out for $n member" . ($n > 1 ? 's' : '') . '.');
$phase = (int) (meta_get('phase', '1'));
if ($phase < 2) {
  // Phase 2 opens Casinos & Sportsbooks, reviews, complaints and the blacklist
  $s = fresh_doc('SETTINGS'); $s['features'] = array_merge(['marketplace' => false, 'escrow' => false, 'verification' => false], $s['features'] ?? [], ['casinos' => true, 'complaints' => true]);
  save_doc('SETTINGS', $s); meta_set('phase', '2'); $say('Upgraded to Phase 2: casinos, reviews, complaints and the blacklist are open.');
}

/* ---------- 3. First Super Admin ---------- */
if (!val("SELECT 1 FROM users WHERE role = 'super_admin'")) {
  $name = strtolower(preg_replace('/[^A-Za-z0-9_]/', '_', (string) ($opt['admin'] ?? '')));
  $email = strtolower((string) ($opt['email'] ?? '')); $pass = (string) ($opt['password'] ?? '');
  if (strlen($name) < 3 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 10) {
    fwrite(STDERR, "To create the first Super Admin, pass --admin=name --email=you@example.com --password='at least 10 characters'\n"); exit(1);
  }
  $profile = PROFILE_DEFAULTS; $profile['badges'] = ['Super admin'];
  insert('users', ['name' => $name, 'email' => $email, 'pass' => hash_pw($pass), 'role' => 'super_admin', 'status' => 'active', 'warnings' => 0, 'email_verified' => 1,
    'joined' => $now, 'posts' => 0, 'topics' => 0, 'likes' => 0, 'profile' => jenc($profile), 'totp_on' => 0, 'last_seen' => 0, 'updated' => $now]);
  $say("Created Super Admin: $name");
} else $say('Super Admin already exists; left as is.');

/* ---------- 4. Sample content for a staging site (optional) ---------- */
if (isset($opt['demo'])) {
  if (val("SELECT COUNT(*) FROM topics")) { $say('Sample content skipped: the forum already has topics.'); exit(0); }
  $d = json_decode(file_get_contents(__DIR__ . '/seed/demo.json'), true);
  $shift = $now - (int) $d['now']; $T = fn($t) => $t === null ? null : (int) $t + $shift;
  $pw = hash_pw('demo-password');
  tx(function () use ($d, $T, $pw, $now, $say) {
    foreach ($d['users'] as $u) {
      if (val("SELECT 1 FROM users WHERE name = ?", [$u['name']])) continue;
      $p = array_intersect_key($u, PROFILE_DEFAULTS); $p['wallets'] = [];
      insert('users', ['name' => $u['name'], 'email' => $u['name'] . '@demo.invalid', 'pass' => $pw, 'role' => $u['role'], 'status' => $u['status'], 'warnings' => (int) $u['warnings'],
        'email_verified' => 1, 'joined' => $T($u['joined']), 'posts' => (int) $u['posts'], 'topics' => (int) $u['topics'], 'likes' => (int) $u['likes'], 'profile' => jenc($p),
        'totp_on' => 0, 'last_seen' => $now - random_int(0, 20) * 3600000, 'updated' => $now]);
    }
    foreach ($d['topics'] as $t) {
      $last = max(array_map(fn($p) => $T($p['at']), $t['posts']));
      $poll = $t['poll'] ? ['q' => $t['poll']['q'], 'multi' => $t['poll']['multi'], 'publicResults' => $t['poll']['publicResults'], 'closes' => $T($t['poll']['closes']), 'options' => array_map(fn($o) => ['t' => $o['t']], $t['poll']['options'])] : null;
      insert('topics', ['id' => $t['id'], 'review_id' => $t['review'] ?? null, 'complaint_id' => $t['complaint'] ?? null, 'board' => $t['board'], 'title' => $t['title'], 'author' => $t['author'], 'at' => $T($t['at']), 'last_at' => $last, 'pinned' => $t['pinned'] ? 1 : 0,
        'locked' => $t['locked'] ? 1 : 0, 'archived' => $t['archived'] ? 1 : 0, 'auto' => $t['auto'] ? 1 : 0, 'tags' => jenc($t['tags']), 'teams' => jenc($t['teams']),
        'league' => $t['league'], 'event' => $t['event'], 'views' => (int) $t['views'], 'poll' => $poll ? jenc($poll) : null, 'updated' => $now]);
      if ($t['poll']) foreach ($t['poll']['options'] as $i => $o) foreach ($o['v'] as $voter) insert_ignore('poll_votes', ['topic_id' => $t['id'], 'user' => $voter, 'opt' => $i]);
      foreach ($t['posts'] as $p) {
        insert('posts', ['id' => $p['id'], 'topic_id' => $t['id'], 'author' => $p['author'], 'body' => $p['body'], 'at' => $T($p['at']), 'hidden' => $p['hidden'] ? 1 : 0,
          'revisions' => jenc(array_map(fn($r) => ['at' => $T($r['at']), 'body' => $r['body'], 'by' => $r['by']], $p['revisions']))]);
        foreach ($p['likes'] as $l) insert_ignore('post_likes', ['post_id' => $p['id'], 'user' => $l]);
      }
    }
    $msgMap = [];
    foreach ($d['convs'] as $c) {
      $last = $c['msgs'] ? $T(end($c['msgs'])['at']) : $now;
      insert('convs', ['id' => $c['id'], 'title' => $c['title'], 'kind' => $c['kind'] ?? null, 'created' => $last, 'updated' => $now]);
      foreach ($c['members'] as $i => $m) insert('conv_members', ['conv_id' => $c['id'], 'user' => $m, 'read_n' => (int) ($c['read'][$m] ?? 0), 'pos' => $i]);
      foreach ($c['msgs'] as $m) $msgMap[$c['id'] . ':' . $m['id']] = insert('msgs', ['conv_id' => $c['id'], 'from_user' => $m['from'], 'body' => $m['body'], 'at' => $T($m['at']), 'att' => '[]', 'notice' => !empty($m['notice']) ? 1 : 0, 'reported' => 0]);
    }
    foreach ($d['follows'] as $u => $ks) foreach ($ks as $k) insert_ignore('follows', ['user' => $u, 'k' => $k]);
    foreach ($d['bookmarks'] as $u => $ids) foreach ($ids as $id) insert_ignore('bookmarks', ['user' => $u, 'topic_id' => $id]);
    foreach ($d['blocks'] as $u => $bs) foreach ($bs as $b) insert_ignore('blocks', ['blocker' => $u, 'blocked' => $b]);
    foreach ($d['notifs'] as $n) insert('notifs', ['to_user' => $n['to'], 'type' => $n['type'], 'text' => $n['text'], 'go' => $n['go'], 'at' => $T($n['at']), 'is_read' => $n['read'] ? 1 : 0, 'emailed' => 1, 'updated' => $now]);
    foreach ($d['reports'] as $r) {
      $t = $r['target'];
      if ($r['kind'] === 'message') { $mid = $msgMap[$t['conv'] . ':' . $t['msg']] ?? null; if (!$mid) continue; $t['msg'] = $mid; q("UPDATE msgs SET reported = 1 WHERE id = ?", [$mid]); }
      if (in_array($r['kind'], ['post', 'topic'], true) && !val("SELECT 1 FROM topics WHERE id = ?", [(int) $t['topic']])) continue;
      insert('reports', ['queue' => $r['queue'], 'kind' => $r['kind'], 'target' => jenc($t), 'board' => $r['board'], 'reason' => $r['reason'], 'by_user' => $r['by'], 'at' => $T($r['at']), 'status' => $r['status'], 'updated' => $now]);
    }
    foreach ($d['audit'] as $a) insert('audit', ['at' => $T($a['at']), 'actor' => $a['actor'], 'action' => $a['action'], 'object' => $a['object'], 'reason' => $a['reason'], 'prev' => (string) $a['prev'], 'next' => (string) $a['next']]);
    foreach ($d['predictions'] as $ev => $ps) foreach ($ps as $u => $v) insert_ignore('predictions', ['event' => $ev, 'user' => $u, 'v' => $v, 'at' => $now]);
    // Sample casinos, sportsbooks, reviews and complaints (fictional, for a staging site)
    foreach ($d['operators'] as $o) { $o['reps'] = array_values(array_filter($o['reps'] ?? [], fn($r) => (bool) val("SELECT 1 FROM users WHERE name = ?", [$r]))); $o['pendingClaim'] = null;
      if (!empty($o['blacklist']['at'])) $o['blacklist']['at'] = $T($o['blacklist']['at']); insert('operators', ['slug' => $o['slug'], 'data' => jenc($o), 'created' => $now, 'updated' => $now]); }
    foreach ($d['reviews'] as $r) {
      insert('reviews', ['id' => $r['id'], 'op' => $r['op'], 'user' => $r['user'], 'stars' => $r['stars'], 'scores' => jenc($r['scores']), 'title' => $r['title'], 'body' => $r['body'], 'status' => $r['status'],
        'at' => $T($r['at']), 'response' => $r['response'] ? jenc(array_merge($r['response'], ['at' => $T($r['response']['at'])])) : null,
        'history' => jenc(array_map(fn($h) => array_merge($h, ['at' => $T($h['at'])]), $r['history'])), 'thread' => $r['thread'] ?? null, 'updated' => $now]);
      foreach ($r['helpful'] as $v) insert_ignore('review_votes', ['review_id' => $r['id'], 'user' => $v, 'v' => 1]);
      foreach ($r['unhelpful'] as $v) insert_ignore('review_votes', ['review_id' => $r['id'], 'user' => $v, 'v' => -1]);
    }
    foreach ($d['complaints'] as $c) {
      $seq = (int) substr($c['id'], 3);
      insert('complaints', ['id' => $c['id'], 'seq' => $seq, 'op' => $c['op'], 'user' => $c['user'], 'title' => $c['title'], 'cat' => $c['cat'], 'amount' => (int) $c['amount'], 'refunded' => (int) $c['refunded'],
        'status' => $c['status'], 'at' => $T($c['at']), 'deadline' => $c['status'] === 'Awaiting Business' ? $now + 2 * DAY_MS : null, 'specialist' => $c['specialist'], 'statement' => $c['statement'],
        'evidence' => jenc(array_map(fn($e) => ['name' => $e['name'], 'public' => $e['public']], $c['evidence'])), 'mod_notes' => jenc(array_map(fn($n) => array_merge($n, ['at' => $T($n['at'])]), $c['modNotes'])),
        'support' => 1, 'thread' => $c['thread'] ?? null, 'updated' => $now]);
      foreach ($c['messages'] as $m) insert('complaint_msgs', ['complaint_id' => $c['id'], 'by_user' => $m['by'], 'body' => $m['body'], 'at' => $T($m['at']), 'role' => $m['role']]);
      foreach ($c['followers'] as $f) insert_ignore('complaint_follows', ['complaint_id' => $c['id'], 'user' => $f]);
    }
    save_doc('MOD_PROFILES', (object) $d['docs']['MOD_PROFILES']);
    $boards = doc('BOARDS'); foreach ($boards as &$b) $b['mods'] = $d['docs']['BOARD_MODS'][$b['slug']] ?? []; unset($b); save_doc('BOARDS', $boards);
    save_doc('EVENTS', array_map(function ($e) use ($T) { $e['at'] = $T($e['at']); return $e; }, $d['docs']['EVENTS']));
    // MySQL keeps counting from the highest id automatically; SQLite does too.
    $say('Loaded sample content: ' . count($d['topics']) . ' topics, ' . count($d['users']) . " members (password for all: demo-password).");
  });
}
$say('Install finished.');
