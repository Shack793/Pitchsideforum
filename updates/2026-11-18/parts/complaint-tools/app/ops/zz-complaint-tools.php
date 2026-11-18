<?php
// Pitchside Forum: complaint tools for specialists.
//  1. Timers. A new complaint starts a 48-hour timer for Pitchside to respond. Specialists then set a timer for the
//     casino, the player or Pitchside (hours, days, weeks or months), shown to everyone as a countdown on the case.
//     When that side replies, their timer stops (as before). A casino that misses its timer is flagged for a
//     specialist by the nightly job, as before.
//  2. Hide sensitive text. Specialists can hide any text (an email, an account number...) everywhere in a case: the
//     complaint, every message from the player or the casino, its title, and its community discussion. Or hide a
//     whole message. The original text is removed, not kept.
//  3. Public files need approval. When a player makes a file public, it waits for a specialist to approve it;
//     until then only the player and specialists can see it. Specialists' own public files need no approval.
// Page side: public/assets/complaint-tools.1.js
declare(strict_types=1);

const CT_PITCHSIDE_HOURS = 48;
const CT_HIDDEN = '[hidden by Pitchside]';

// ---------- 1. Timers ----------
function ct_wrap(string $name, callable $wrap): void {
  if (!isset($GLOBALS['OPS'][$name])) return;
  [$base, $need] = $GLOBALS['OPS'][$name];
  $GLOBALS['OPS'][$name] = [fn(array $in, ...$rest) => $wrap($base, $in, ...$rest), $need];
}

ct_wrap('complaint.create', function ($base, array $in, ...$rest) {
  $res = $base($in, ...$rest);
  if (!empty($res['id'])) {
    q("UPDATE complaints SET deadline = ?, updated = ? WHERE id = ? AND status = 'Open'", [now_ms() + CT_PITCHSIDE_HOURS * 3600000, now_ms(), $res['id']]);
    ct_hold_new_public((string) $res['id'], 0, $rest[0] ?? null);
  }
  return $res;
});

op('complaint.timer', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  if (!in_array($c['status'], OPEN_STATUSES, true)) fail('This case is closed.');
  $who = str_in($in, 'who', 12);
  $status = ['casino' => 'Awaiting Business', 'player' => 'Awaiting User', 'pitchside' => 'Under Investigation', 'none' => null];
  if (!array_key_exists($who, $status)) fail('Choose who the timer is for.');
  $o = op_get($c['op']); $note = str_in($in, 'note', 5000);
  if ($who === 'none') {
    q("UPDATE complaints SET deadline = NULL, updated = ? WHERE id = ?", [now_ms(), $c['id']]);
    if ($note !== '') case_msg($c['id'], $u['name'], $note);
    case_msg($c['id'], 'system', 'Timer stopped', 'system');
    audit($u, 'Complaint timer', $c['id'], 'Timer stopped', $c['deadline'] ? date('j M Y H:i', intdiv((int) $c['deadline'], 1000)) . ' UTC' : 'none', 'none');
    return [];
  }
  $n = int_in($in, 'n'); $unit = str_in($in, 'unit', 8);
  $ms = ['hours' => 3600000, 'days' => 86400000, 'weeks' => 7 * 86400000, 'months' => 30 * 86400000][$unit] ?? 0;
  if (!$ms || $n < 1 || $n > 999 || $n * $ms > 366 * 86400000) fail('Set a time from 1 hour to 12 months.');
  $until = now_ms() + $n * $ms;
  $party = ['casino' => $o['name'], 'player' => $c['user'], 'pitchside' => 'Pitchside'][$who];
  $len = $n . ' ' . ($n === 1 ? rtrim($unit, 's') : $unit);
  if ($note !== '') case_msg($c['id'], $u['name'], $note);
  if ($c['status'] !== $status[$who]) set_case_status($c, $status[$who], $u, "Timer: $party has $len", ['quiet' => true]);
  q("UPDATE complaints SET deadline = ?, updated = ? WHERE id = ?", [$until, now_ms(), $c['id']]);
  case_msg($c['id'], 'system', "Timer: $party has $len to respond (until " . date('j M Y, H:i', intdiv($until, 1000)) . ' UTC)', 'system');
  audit($u, 'Complaint timer', $c['id'], "$party has $len", $c['deadline'] ? date('j M Y H:i', intdiv((int) $c['deadline'], 1000)) . ' UTC' : 'none', date('j M Y H:i', intdiv($until, 1000)) . ' UTC');
  $tell = $who === 'casino' ? ($o['reps'] ?? []) : ($who === 'player' ? [$c['user']] : []);
  foreach ($tell as $p) notify($p, 'complaint', "{$c['id']}: you have $len to respond", "/complaints/{$c['id']}", $u);
  return ['until' => $until];
});

// ---------- 2. Hide sensitive text ----------
function ct_replace_everywhere(array $c, string $find): int {
  $hits = 0;
  $count = function (string $s) use ($find) { return mb_substr_count(mb_strtolower($s), mb_strtolower($find)); };
  $hits += $count((string) $c['statement']) + $count((string) $c['title']);
  q("UPDATE complaints SET statement = ?, title = ?, updated = ? WHERE id = ?", [str_ireplace($find, CT_HIDDEN, (string) $c['statement']), str_ireplace($find, CT_HIDDEN, (string) $c['title']), now_ms(), $c['id']]);
  foreach (rows("SELECT id, body FROM complaint_msgs WHERE complaint_id = ?", [$c['id']]) as $m) {
    $k = $count((string) $m['body']); if (!$k) continue; $hits += $k;
    q("UPDATE complaint_msgs SET body = ? WHERE id = ?", [str_ireplace($find, CT_HIDDEN, (string) $m['body']), $m['id']]);
  }
  if ($c['thread']) {
    $t = row("SELECT id, title FROM topics WHERE id = ?", [(int) $c['thread']]);
    if ($t && $count((string) $t['title'])) { $hits += $count((string) $t['title']); q("UPDATE topics SET title = ? WHERE id = ?", [str_ireplace($find, CT_HIDDEN, (string) $t['title']), $t['id']]); }
    foreach (rows("SELECT id, body, revisions FROM posts WHERE topic_id = ?", [(int) $c['thread']]) as $p) {
      $k = $count((string) $p['body']) + $count((string) $p['revisions']); if (!$k) continue; $hits += $count((string) $p['body']);
      $rev = jdec((string) $p['revisions'], []);
      $rev = is_array($rev) ? json_decode(str_ireplace(json_encode_part($find), json_encode_part(CT_HIDDEN), jenc($rev)), true) : [];
      q("UPDATE posts SET body = ?, revisions = ? WHERE id = ?", [str_ireplace($find, CT_HIDDEN, (string) $p['body']), jenc(is_array($rev) ? $rev : []), $p['id']]);
    }
    touch_topic((int) $c['thread']);
  }
  return $hits;
}
function json_encode_part(string $s): string { return substr(json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 1, -1); }

op('complaint.hideText', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $find = trim(str_in($in, 'text', 500));
  if (mb_strlen($find) < 3) fail('Paste at least 3 characters of the text to hide.');
  $hits = ct_replace_everywhere($c, $find);
  if (!$hits) fail("That text wasn't found in this case. Copy it exactly as it appears.");
  case_msg($c['id'], 'system', 'Pitchside hid sensitive information in this case', 'system');
  audit($u, 'Complaint text hidden', $c['id'], "Hid sensitive text ($hits place" . ($hits > 1 ? 's' : '') . ')', '—', CT_HIDDEN);
  return ['hits' => $hits];
});

op('complaint.hideMsg', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $i = int_in($in, 'i', -1);
  $msgs = rows("SELECT id, by_user, body, role FROM complaint_msgs WHERE complaint_id = ? ORDER BY id", [$c['id']]);
  if (!isset($msgs[$i]) || $msgs[$i]['role'] === 'system') fail('That message no longer exists.');
  $m = $msgs[$i]; $txt = '[Message hidden by Pitchside]';
  q("UPDATE complaint_msgs SET body = ? WHERE id = ?", [$txt, $m['id']]);
  if (trim((string) $m['body']) === trim((string) $c['statement'])) {   // the opening statement: also the statement and the discussion's first post
    q("UPDATE complaints SET statement = ? WHERE id = ?", [$txt, $c['id']]);
    if ($c['thread']) { $p = row("SELECT id FROM posts WHERE topic_id = ? ORDER BY id LIMIT 1", [(int) $c['thread']]);
      if ($p) q("UPDATE posts SET body = ?, revisions = '[]' WHERE id = ?", [$txt, $p['id']]); touch_topic((int) $c['thread']); }
  }
  q("UPDATE complaints SET updated = ? WHERE id = ?", [now_ms(), $c['id']]);
  audit($u, 'Complaint message hidden', $c['id'], "Hid a message by {$m['by_user']}", 'visible', 'hidden');
  return [];
});

// ---------- 3. Public files need approval ----------
// Any file a non-specialist asks to make public waits as "pending" (not public) until a specialist approves it.
function ct_hold_new_public(string $id, int $from, $u, ?int $only = null): void {
  $c = row("SELECT * FROM complaints WHERE id = ?", [$id]); if (!$c) return;
  $ev = jdec((string) $c['evidence'], []); if (!is_array($ev)) return;
  $spec = $u && mp($u, 'complaint.manage'); $held = 0; $changed = false;
  foreach ($ev as $k => &$e) {
    if ($k < $from || ($only !== null && $k !== $only) || empty($e['public']) || !empty($e['approved'])) continue;
    if ($spec) { $e['approved'] = true; $changed = true; continue; }
    $e['public'] = false; $e['pending'] = true; $held++; $changed = true;
  }
  unset($e);
  if (!$changed) return;
  q("UPDATE complaints SET evidence = ?, updated = ? WHERE id = ?", [jenc($ev), now_ms(), $id]);
  if ($held) {
    case_msg($id, 'system', "$held file" . ($held > 1 ? 's' : '') . ' waiting for Pitchside to approve before going public', 'system');
    insert('reports', ['queue' => 'complaints', 'kind' => 'complaint', 'target' => jenc(['complaint' => $id]), 'board' => null, 'reason' => 'Evidence waiting for approval to go public',
      'by_user' => 'system', 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
  }
}
ct_wrap('complaint.evidence', function ($base, array $in, ...$rest) {
  $id = str_in($in, 'id', 16); $c = complaint_row($id); $before = count(jdec((string) $c['evidence'], []) ?: []);
  $res = $base($in, ...$rest); ct_hold_new_public($id, $before, $rest[0] ?? null); return $res;
});
ct_wrap('complaint.reply', function ($base, array $in, ...$rest) {
  $id = str_in($in, 'id', 16); $c = complaint_row($id); $before = count(jdec((string) $c['evidence'], []) ?: []); $u = $rest[0] ?? null;
  $res = $base($in, ...$rest); ct_hold_new_public($id, $before, $u);
  // a specialist answering stops Pitchside's own timer
  if ($u && mp($u, 'complaint.manage') && $u['name'] !== $c['user'])
    q("UPDATE complaints SET deadline = NULL, updated = ? WHERE id = ? AND status IN ('Open', 'Under Investigation', 'Escalated')", [now_ms(), $id]);
  return $res;
});
ct_wrap('complaint.evidenceToggle', function ($base, array $in, ...$rest) {
  $id = str_in($in, 'id', 16); $c = complaint_row($id); $i = int_in($in, 'i', -1); $u = $rest[0] ?? null;
  $ev = jdec((string) $c['evidence'], []);
  if (isset($ev[$i]) && !empty($ev[$i]['pending'])) {          // asking again cancels the request
    if (case_role($c, $u) !== 'player' && !($u && mp($u, 'complaint.manage'))) fail('Only the player and our specialists can change this.', 403);
    unset($ev[$i]['pending']); q("UPDATE complaints SET evidence = ?, updated = ? WHERE id = ?", [jenc($ev), now_ms(), $id]); return ['pending' => false];
  }
  $res = $base($in, ...$rest);
  ct_hold_new_public($id, 0, $u, $i);
  return $res;
});

op('complaint.evApprove', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $ev = jdec((string) $c['evidence'], []); $i = int_in($in, 'i', -1);
  if (!isset($ev[$i]) || empty($ev[$i]['pending'])) fail('That file is no longer waiting for approval.');
  $ok = bool_in($in, 'ok'); unset($ev[$i]['pending']);
  if ($ok) { $ev[$i]['public'] = true; $ev[$i]['approved'] = true; }
  q("UPDATE complaints SET evidence = ?, updated = ? WHERE id = ?", [jenc($ev), now_ms(), $c['id']]);
  case_msg($c['id'], 'system', $ok ? 'Pitchside approved a file to be public' : 'Pitchside kept a file private', 'system');
  audit($u, 'Complaint evidence', $c['id'], $ok ? 'Approved a file to be public' : 'Kept a file private', 'pending', $ok ? 'public' : 'private');
  notify($c['user'], 'complaint', $ok ? "{$c['id']}: your file is now public" : "{$c['id']}: your file stays private", "/complaints/{$c['id']}", $u);
  if (!array_filter($ev, fn($e) => !empty($e['pending'])))
    q("UPDATE reports SET status = 'resolved', closed_by = ?, closed_at = ?, updated = ? WHERE kind = 'complaint' AND status = 'open' AND target = ? AND reason LIKE 'Evidence waiting%'", [$u['name'], now_ms(), now_ms(), jenc(['complaint' => $c['id']])]);
  return [];
});

// Which files are waiting for approval (only the player and specialists are told)
op('complaint.evPending', function (array $in, ?array $u) {
  $c = complaint_row(str_in($in, 'id', 16));
  if (!$u || ($u['name'] !== $c['user'] && !mp($u, 'complaint.manage'))) return ['pending' => []];
  $out = []; foreach (jdec((string) $c['evidence'], []) as $k => $e) if (!empty($e['pending'])) $out[] = $k;
  return ['pending' => $out];
}, false);
