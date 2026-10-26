<?php
// Weekly raffle (/raffle): free to enter. Members qualify with a minimum number of topics and posts,
// one entry per member and per device (the internet connection doesn't matter). The draw runs on the server.
// AI community accounts and staff can't enter, and AI accounts don't count toward the member target.
declare(strict_types=1);

const RAFFLE_NETWORKS = ['TRC20' => '/^T[1-9A-HJ-NP-Za-km-z]{33}$/', 'ERC20' => '/^0x[0-9a-fA-F]{40}$/', 'BEP20' => '/^0x[0-9a-fA-F]{40}$/'];

function raffle_salt(): string {
  $s = meta_get('raffle:salt');
  if (!$s) { $s = bin2hex(random_bytes(16)); meta_set('raffle:salt', $s); $s = meta_get('raffle:salt') ?: $s; }
  return $s;
}
function raffle_hash(string $v): string { return hash_hmac('sha256', $v, raffle_salt()); }
function raffle_is_ai(int $userId, string $email): bool {
  if (str_ends_with($email, '@ai.pitchside.invalid')) return true;
  try { return (bool) val("SELECT 1 FROM ai_characters WHERE user_id = ?", [$userId]); } catch (Throwable $e) { return false; }
}
// Qualified members for a draw: real, active, non-staff accounts (not AI community, demo or test accounts) with a
// confirmed email and at least the draw's topics and posts. This is the number shown on the page and the draw target.
function raffle_qualified_count(array $r): int {
  $topics = "(SELECT COUNT(*) FROM topics t WHERE t.author = u.name AND t.deleted = 0)";
  $posts = "(SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.author = u.name AND p.hidden = 0 AND t.deleted = 0)";
  $sql = "SELECT COUNT(*) FROM users u WHERE u.status = 'active' AND u.email NOT LIKE '%.invalid' AND u.role NOT IN (" . in_list(STAFF_ROLES) . ")"
    . (mail_ready() ? " AND u.email_verified = 1" : "") . " AND $topics >= " . (int) $r['min_topics'] . " AND $posts >= " . (int) $r['min_posts'];
  $args = STAFF_ROLES;
  try { return (int) val("$sql AND NOT EXISTS (SELECT 1 FROM ai_characters a WHERE a.user_id = u.id)", $args); } catch (Throwable $e) { return (int) val($sql, $args); }
}
// Real members: active accounts, not AI community accounts, not demo or test accounts
function raffle_member_count(): int {
  $n = "SELECT COUNT(*) FROM users u WHERE u.status = 'active' AND u.email NOT LIKE '%.invalid'";
  try { return (int) val("$n AND NOT EXISTS (SELECT 1 FROM ai_characters a WHERE a.user_id = u.id)"); } catch (Throwable $e) { return (int) val($n); }
}
function raffle_progress(array $u, array $r): array {
  $topics = (int) val("SELECT COUNT(*) FROM topics WHERE author = ? AND deleted = 0", [$u['name']]);
  $posts = (int) val("SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.author = ? AND p.hidden = 0 AND t.deleted = 0", [$u['name']]);
  $verified = (bool) $u['email_verified'] || !mail_ready();
  $staff = in_array($u['role'], STAFF_ROLES, true);
  $ai = raffle_is_ai((int) $u['id'], (string) $u['email']);
  $why = $ai ? 'AI community accounts can’t enter.' : ($staff ? 'Staff can’t enter the raffle.' : ($u['status'] !== 'active' ? "Your account is {$u['status']}." : null));
  $ok = !$why && $verified && $topics >= (int) $r['min_topics'] && $posts >= (int) $r['min_posts'];
  return ['topics' => $topics, 'posts' => $posts, 'verified' => $verified, 'blocked' => $why, 'eligible' => $ok];
}
function raffle_round(int $id): array { $r = row("SELECT * FROM raffle_rounds WHERE id = ?", [$id]); if (!$r) fail('That raffle wasn’t found.', 404); return $r; }
function raffle_need_admin(?array $u): void { if (!$u || !is_admin($u)) fail('Only admins can manage the raffle.', 403); }
function raffle_ready(array $r, int $members): bool { return $r['status'] === 'open' && now_ms() >= (int) $r['ends'] && $members >= (int) $r['min_members']; }
function raffle_out(array $r, ?array $u): array {
  $members = raffle_qualified_count($r);
  $admin = $u && is_admin($u); $isWinner = $u && $r['winner'] === $u['name'];
  $draw = jdec($r['draw_info'], null);
  $count = (int) val("SELECT COUNT(*) FROM raffle_entries WHERE round_id = ? AND status = 'ok'", [$r['id']]);
  $names = array_column(rows("SELECT user FROM raffle_entries WHERE round_id = ? AND status = 'ok' ORDER BY id", [$r['id']]), 'user');
  return ['id' => (int) $r['id'], 'title' => $r['title'], 'prize' => $r['prize'], 'prizeNote' => $r['prize_note'], 'starts' => (int) $r['starts'], 'ends' => (int) $r['ends'],
    'minMembers' => (int) $r['min_members'], 'minTopics' => (int) $r['min_topics'], 'minPosts' => (int) $r['min_posts'], 'blockIp' => (bool) $r['block_ip'], 'walletDays' => (int) $r['wallet_days'],
    'status' => $r['status'], 'qualified' => $members, 'ready' => raffle_ready($r, $members), 'entries' => $count, 'entrants' => $names,
    'winner' => $r['winner'], 'drawnAt' => $r['drawn_at'] ? (int) $r['drawn_at'] : null, 'draw' => $draw,
    'walletSet' => (bool) $r['wallet_addr'], 'walletDue' => $r['drawn_at'] ? (int) $r['drawn_at'] + (int) $r['wallet_days'] * 86400000 : null,
    'wallet' => ($admin || $isWinner) && $r['wallet_addr'] ? ['network' => $r['wallet_network'], 'addr' => $r['wallet_addr'], 'at' => (int) $r['wallet_at']] : null,
    'rules' => (string) ($r['rules'] ?? ''), 'rulesAt' => !empty($r['rules_at']) ? (int) $r['rules_at'] : null, 'paidTx' => $r['paid_tx'], 'paidAt' => $r['paid_at'] ? (int) $r['paid_at'] : null, 'paidNetwork' => $r['paid_tx'] ? $r['wallet_network'] : null];
}
// Accounts that signed in from the same network as another entrant (a hint for admins, not proof)
function raffle_shared_ip(string $user, array $entrants): array {
  $uid = val("SELECT id FROM users WHERE name = ?", [$user]); if (!$uid) return [];
  $others = rows("SELECT DISTINCT u.name FROM sessions s JOIN sessions s2 ON s2.ip = s.ip AND s2.user_id <> s.user_id JOIN users u ON u.id = s2.user_id
    WHERE s.user_id = ? AND s.ip <> ''", [(int) $uid]);
  return array_values(array_intersect(array_column($others, 'name'), $entrants));
}

op('raffle.get', function (array $in, ?array $u) {
  $members = raffle_member_count();
  $all = rows("SELECT * FROM raffle_rounds WHERE status <> 'cancelled' OR ? = 1 ORDER BY id DESC LIMIT 12", [$u && is_admin($u) ? 1 : 0]);
  $rounds = array_map(fn($r) => raffle_out($r, $u), $all);
  $cur = null; foreach ($all as $r) if ($r['status'] === 'open') { $cur = $r; break; }
  $me = null;
  if ($u && $cur) {
    $e = row("SELECT status, note, at FROM raffle_entries WHERE round_id = ? AND user = ?", [$cur['id'], $u['name']]);
    $me = raffle_progress($u, $cur) + ['entry' => $e ? ['status' => $e['status'], 'note' => $e['note'], 'at' => (int) $e['at']] : null];
  }
  $admin = null;
  if ($u && is_admin($u)) {
    $admin = [];
    foreach ($all as $r) if (in_array($r['status'], ['open', 'drawn'], true)) {
      $es = rows("SELECT id, user, at, status, note, ip_hash, dev_hash FROM raffle_entries WHERE round_id = ? ORDER BY id", [$r['id']]);
      $names = array_column(array_filter($es, fn($e) => $e['status'] === 'ok'), 'user');
      $admin[(string) $r['id']] = array_map(function ($e) use ($names, $r) {
        $usr = row("SELECT * FROM users WHERE name = ?", [$e['user']]);
        $p = $usr ? raffle_progress($usr, $r) : ['topics' => 0, 'posts' => 0, 'eligible' => false, 'blocked' => 'Account deleted'];
        return ['id' => (int) $e['id'], 'user' => $e['user'], 'at' => (int) $e['at'], 'status' => $e['status'], 'note' => $e['note'], 'topics' => $p['topics'], 'posts' => $p['posts'],
          'stillEligible' => $p['eligible'], 'problem' => $p['blocked'] ?? null, 'joined' => $usr ? (int) $usr['joined'] : null,
          'sharedNetwork' => raffle_shared_ip($e['user'], array_diff($names, [$e['user']]))];
      }, $es);
    }
  }
  return ['members' => $members, 'rounds' => $rounds, 'current' => $cur ? (int) $cur['id'] : null, 'me' => $me, 'admin' => $admin];
}, false);

op('raffle.enter', function (array $in, array $u) {
  rate_limit('raffle:' . $u['name'], 10, 3600);
  $r = raffle_round(int_in($in, 'id'));
  if ($r['status'] !== 'open') fail('Entries for this draw are closed.');
  if (now_ms() < (int) $r['starts']) fail('Entries open on ' . gmdate('j M Y', intdiv((int) $r['starts'], 1000)) . '.');
  if (raffle_ready($r, raffle_qualified_count($r))) fail('Entries are closed and the draw is about to take place.');
  if (!bool_in($in, 'agree')) fail('Confirm you’re 18 or older and agree to the raffle rules.');
  $dev = str_in($in, 'device', 64);
  if (!preg_match('/^[a-f0-9]{32}$/', $dev)) fail('Your browser didn’t send a device code. Allow site storage (cookies) for Pitchside and try again.');
  $p = raffle_progress($u, $r);
  if ($p['blocked']) fail($p['blocked']);
  if (!$p['verified']) fail('Confirm your email address first.');
  if ($p['topics'] < (int) $r['min_topics']) fail("Start at least {$r['min_topics']} topic" . ($r['min_topics'] > 1 ? 's' : '') . " first (you have {$p['topics']}).");
  if ($p['posts'] < (int) $r['min_posts']) fail("You need {$r['min_posts']} posts to enter (you have {$p['posts']}).");
  $devH = raffle_hash('dev:' . $dev);
  return tx(function () use ($r, $u, $devH) {
    if (val("SELECT 1 FROM raffle_entries WHERE round_id = ? AND user = ?", [$r['id'], $u['name']])) fail('You’re already entered in this draw.');
    if (val("SELECT 1 FROM raffle_entries WHERE round_id = ? AND dev_hash = ?", [$r['id'], $devH])) fail('Someone has already entered this draw from this device. It’s one entry per device.');
    insert('raffle_entries', ['round_id' => $r['id'], 'user' => $u['name'], 'at' => now_ms(), 'ip_hash' => '', 'dev_hash' => $devH, 'status' => 'ok', 'note' => '']);
    return ['entered' => true];
  });
});

op('raffle.save', function (array $in, array $u) {
  raffle_need_admin($u);
  $id = int_in($in, 'id');
  $d = ['title' => str_in($in, 'title', 120), 'prize' => str_in($in, 'prize', 80), 'prize_note' => str_in($in, 'prizeNote', 300),
    'starts' => int_in($in, 'starts'), 'ends' => int_in($in, 'ends'), 'min_members' => max(0, min(1000000, int_in($in, 'minMembers', 100))),
    'min_topics' => max(0, min(1000, int_in($in, 'minTopics', 1))), 'min_posts' => max(0, min(10000, int_in($in, 'minPosts', 25))),
    'block_ip' => 0, 'wallet_days' => max(1, min(90, int_in($in, 'walletDays', 14))), 'updated' => now_ms()];
  if (mb_strlen($d['title']) < 3) fail('Give the draw a name, e.g. “Round 1 raffle”.');
  if ($d['prize'] === '') fail('Write the prize, e.g. “$100 in USDT”.');
  if ($d['starts'] <= 0 || $d['ends'] <= $d['starts']) fail('The draw date must be after the start date.');
  // This draw's rules: plain text, one rule per line (shown as a numbered list)
  $rules = trim(preg_replace("/\r\n?/", "\n", str_in($in, 'rules', 8000)));
  $rules = implode("\n", array_slice(array_filter(array_map('trim', explode("\n", $rules)), 'strlen'), 0, 40));
  if (mb_strlen($rules) < 20) fail('Write the rules for this draw (one rule per line).');
  if ($id) {
    $r = raffle_round($id); if ($r['status'] !== 'open') fail('Only an open draw can be edited.');
    if ($rules !== (string) ($r['rules'] ?? '')) {
      q("UPDATE raffle_rounds SET rules = ?, rules_at = ? WHERE id = ?", [$rules, now_ms(), $id]);
      audit($u, 'Raffle change', "Raffle #$id: {$d['title']}", 'Rules changed', mb_substr((string) ($r['rules'] ?? 'standard rules'), 0, 400), mb_substr($rules, 0, 400));
    }
    q("UPDATE raffle_rounds SET title = ?, prize = ?, prize_note = ?, starts = ?, ends = ?, min_members = ?, min_topics = ?, min_posts = ?, block_ip = ?, wallet_days = ?, updated = ? WHERE id = ?",
      [...array_values($d), $id]);
    audit($u, 'Raffle change', "Raffle #$id: {$d['title']}", 'Edited', "{$r['prize']}, {$r['min_posts']} posts, {$r['min_members']} members", "{$d['prize']}, {$d['min_posts']} posts, {$d['min_members']} members");
  } else {
    if (val("SELECT 1 FROM raffle_rounds WHERE status = 'open'")) fail('Finish or cancel the open draw before starting the next one.');
    $id = insert('raffle_rounds', $d + ['status' => 'open', 'created' => now_ms(), 'rules' => $rules, 'rules_at' => now_ms()]);
    audit($u, 'Raffle change', "Raffle #$id: {$d['title']}", 'Created', '', "{$d['prize']}, draw " . gmdate('j M Y', intdiv($d['ends'], 1000)));
  }
  return ['id' => $id];
});

op('raffle.cancel', function (array $in, array $u) {
  raffle_need_admin($u);
  $r = raffle_round(int_in($in, 'id')); if ($r['status'] !== 'open') fail('Only an open draw can be cancelled.');
  $why = str_in($in, 'reason', 300); if (mb_strlen($why) < 5) fail('Say why the draw is cancelled.');
  q("UPDATE raffle_rounds SET status = 'cancelled', updated = ? WHERE id = ?", [now_ms(), $r['id']]);
  audit($u, 'Raffle change', "Raffle #{$r['id']}: {$r['title']}", $why, 'open', 'cancelled');
  return [];
});

op('raffle.dq', function (array $in, array $u) {
  raffle_need_admin($u);
  $e = row("SELECT * FROM raffle_entries WHERE id = ?", [int_in($in, 'entry')]); if (!$e) fail('Entry not found.', 404);
  $r = raffle_round((int) $e['round_id']); if ($r['status'] !== 'open') fail('Entries can only be changed before the draw. To replace a winner, use Redraw.');
  $undo = bool_in($in, 'undo'); $why = str_in($in, 'reason', 255);
  if (!$undo && mb_strlen($why) < 5) fail('Say why this entry is disqualified. The member sees the reason.');
  q("UPDATE raffle_entries SET status = ?, note = ? WHERE id = ?", [$undo ? 'ok' : 'disqualified', $undo ? '' : $why, $e['id']]);
  audit($u, 'Raffle change', "Raffle #{$r['id']} entry: {$e['user']}", $undo ? 'Reinstated' : $why, $e['status'], $undo ? 'ok' : 'disqualified');
  if (!$undo) notify($e['user'], 'raffle', "Your entry in “{$r['title']}” was disqualified: $why", '/raffle', $u);
  return [];
});

// Picks the winner at random from entries that are still eligible right now. Entries that no longer
// qualify (posts removed, account suspended…) are marked and left out first.
function raffle_pick(array $r, array $u, array $exclude = []): array {
  $entries = rows("SELECT * FROM raffle_entries WHERE round_id = ? AND status = 'ok' ORDER BY id", [$r['id']]);
  $pool = [];
  foreach ($entries as $e) {
    if (in_array($e['user'], $exclude, true)) continue;
    $usr = row("SELECT * FROM users WHERE name = ?", [$e['user']]);
    $p = $usr ? raffle_progress($usr, $r) : ['eligible' => false, 'blocked' => 'Account deleted'];
    if (!$p['eligible']) { q("UPDATE raffle_entries SET status = 'ineligible', note = ? WHERE id = ?", [mb_substr($p['blocked'] ?? 'No longer meets the topic and post requirements at draw time', 0, 255), $e['id']]); continue; }
    $pool[] = $e;
  }
  if (!$pool) fail('There are no eligible entries to draw from.');
  $k = random_int(0, count($pool) - 1); $w = $pool[$k];
  $info = ['at' => now_ms(), 'pool' => count($pool), 'ticket' => $k + 1, 'names' => array_column($pool, 'user'), 'by' => $u['name'], 'method' => 'PHP random_int (cryptographically secure)'];
  $prev = jdec($r['draw_info'], null); if ($prev) $info['previous'] = array_merge($prev['previous'] ?? [], [['winner' => $r['winner'], 'at' => $prev['at'], 'reason' => $prev['redrawReason'] ?? '']]);
  return [$w, $info];
}

op('raffle.draw', function (array $in, array $u) {
  raffle_need_admin($u);
  return tx(function () use ($in, $u) {
    $r = raffle_round(int_in($in, 'id'));
    if ($r['status'] !== 'open') fail('This draw has already taken place.');
    $members = raffle_qualified_count($r);
    if (now_ms() < (int) $r['ends']) fail('The draw date hasn’t arrived yet.');
    if ($members < (int) $r['min_members']) fail("The draw needs {$r['min_members']} qualified members. There are $members so far.");
    [$w, $info] = raffle_pick($r, $u);
    q("UPDATE raffle_rounds SET status = 'drawn', winner = ?, winner_entry = ?, drawn_at = ?, draw_info = ?, updated = ? WHERE id = ?", [$w['user'], $w['id'], now_ms(), jenc($info), now_ms(), $r['id']]);
    audit($u, 'Raffle draw', "Raffle #{$r['id']}: {$r['title']}", "Ticket {$info['ticket']} of {$info['pool']}", 'open', "winner: {$w['user']}");
    notify($w['user'], 'raffle', "You won {$r['prize']} in “{$r['title']}”! Open the raffle page to send us your USDT wallet address within {$r['wallet_days']} days.", '/raffle', $u);
    return ['winner' => $w['user']];
  });
});

op('raffle.redraw', function (array $in, array $u) {
  raffle_need_admin($u);
  return tx(function () use ($in, $u) {
    $r = raffle_round(int_in($in, 'id'));
    if ($r['status'] !== 'drawn') fail('Only a drawn, unpaid raffle can be redrawn.');
    $why = str_in($in, 'reason', 255); if (mb_strlen($why) < 5) fail('Say why the winner is being replaced. It’s shown on the raffle page.');
    q("UPDATE raffle_entries SET status = 'disqualified', note = ? WHERE id = ?", [$why, $r['winner_entry']]);
    $info = jdec($r['draw_info'], []); $info['redrawReason'] = $why; $r['draw_info'] = jenc($info);
    [$w, $new] = raffle_pick($r, $u, [$r['winner']]);
    q("UPDATE raffle_rounds SET winner = ?, winner_entry = ?, drawn_at = ?, draw_info = ?, wallet_network = NULL, wallet_addr = NULL, wallet_at = NULL, updated = ? WHERE id = ?",
      [$w['user'], $w['id'], now_ms(), jenc($new), now_ms(), $r['id']]);
    audit($u, 'Raffle draw', "Raffle #{$r['id']}: {$r['title']}", "Redraw: $why", "winner: {$r['winner']}", "winner: {$w['user']}");
    notify($r['winner'], 'raffle', "Your win in “{$r['title']}” was withdrawn: $why", '/raffle', $u);
    notify($w['user'], 'raffle', "You won {$r['prize']} in “{$r['title']}” (redraw)! Open the raffle page to send us your USDT wallet address within {$r['wallet_days']} days.", '/raffle', $u);
    return ['winner' => $w['user']];
  });
});

op('raffle.wallet', function (array $in, array $u) {
  rate_limit('raffle-wallet:' . $u['name'], 10, 3600);
  $r = raffle_round(int_in($in, 'id'));
  if ($r['status'] !== 'drawn' || $r['winner'] !== $u['name']) fail('Only the winner can add a wallet address, before the prize is paid.');
  $net = strtoupper(str_in($in, 'network', 10)); $addr = str_in($in, 'addr', 120);
  if (!isset(RAFFLE_NETWORKS[$net])) fail('Pick the network: TRC20 (Tron), ERC20 (Ethereum) or BEP20 (BNB Smart Chain).');
  if (!preg_match(RAFFLE_NETWORKS[$net], $addr)) fail($net === 'TRC20' ? 'A TRC20 address starts with T and has 34 characters.' : "An $net address starts with 0x and has 42 characters.");
  q("UPDATE raffle_rounds SET wallet_network = ?, wallet_addr = ?, wallet_at = ?, updated = ? WHERE id = ?", [$net, $addr, now_ms(), now_ms(), $r['id']]);
  audit($u, 'Raffle wallet', "Raffle #{$r['id']}: {$r['title']}", 'Winner added a wallet', $r['wallet_network'] ? "{$r['wallet_network']} " . substr((string) $r['wallet_addr'], 0, 8) . '…' : 'none', "$net " . substr($addr, 0, 8) . '…');
  foreach (rows("SELECT name FROM users WHERE role IN ('admin','super_admin') AND status = 'active'") as $a)
    notify($a['name'], 'raffle', "{$u['name']} sent their $net wallet for “{$r['title']}”. Ready to pay.", '/raffle', $u);
  return [];
});

op('raffle.paid', function (array $in, array $u) {
  raffle_need_admin($u);
  $r = raffle_round(int_in($in, 'id'));
  if ($r['status'] !== 'drawn') fail('This raffle isn’t waiting for payment.');
  if (!$r['wallet_addr']) fail('The winner hasn’t sent a wallet address yet.');
  $txh = str_in($in, 'tx', 140); if (!preg_match('/^(0x)?[0-9a-fA-F]{64}$/', $txh)) fail('Paste the transaction hash (ID) from the transfer: 64 letters and numbers, or 0x plus 64.');
  q("UPDATE raffle_rounds SET status = 'paid', paid_tx = ?, paid_at = ?, updated = ? WHERE id = ?", [$txh, now_ms(), now_ms(), $r['id']]);
  audit($u, 'Raffle payout', "Raffle #{$r['id']}: {$r['title']}", "Paid {$r['prize']} to {$r['winner']}", 'drawn', "paid, tx " . substr($txh, 0, 12) . '…');
  notify($r['winner'], 'raffle', "Your {$r['prize']} prize for “{$r['title']}” has been sent. Thanks for being part of Pitchside!", '/raffle', $u);
  return [];
});
