<?php
// Phase 2: casinos & sportsbooks, ratings and reviews, business accounts, complaints and the blacklist.
declare(strict_types=1);

const REVIEW_CATS = ['Overall', 'Deposits', 'Withdrawals', 'Support', 'KYC', 'Games', 'Bonuses', 'Speed', 'Reliability', 'Crypto'];
const REVIEW_STATUSES = ['unverified', 'verified user', 'verified transaction', 'disputed', 'removed'];
const COMPLAINT_CATS = ['Delayed withdrawal', 'Confiscated winnings', 'Account closed', 'KYC / verification', 'Bonus terms', 'Deposit not credited', 'Limits or restrictions', 'Other'];
const OPEN_STATUSES = ['Open', 'Under Investigation', 'Awaiting Business', 'Awaiting User', 'Escalated'];
const OUTCOMES = ['Resolved', 'Partially Resolved', 'Unresolved', 'Rejected', 'No Response'];
const STATUS_LABEL = ['Open' => 'Open', 'Under Investigation' => 'Specialist reviewing', 'Awaiting Business' => 'Waiting for operator', 'Awaiting User' => 'Waiting for player',
  'Escalated' => 'Escalated', 'Resolved' => 'Resolved', 'Partially Resolved' => 'Partially resolved', 'Unresolved' => 'Unresolved', 'Rejected' => 'Rejected',
  'No Response' => 'Closed: no operator response', 'Closed' => 'Closed by player'];
const BLACKLIST_REASONS = ['Confiscated winnings without a valid reason', 'Ignores complaints and our specialists', 'No licence, or a fake licence', 'Unfair or predatory terms',
  'Copies another brand or uses fake reviews', 'Shut down without paying players'];
// Fields an operator's own representative may change; everything else is admin-only
const REP_FIELDS = ['website', 'kyc', 'withdrawals', 'countries', 'crypto', 'fiat', 'minDeposit', 'withdrawalLimit', 'games', 'languages'];
const ADMIN_FIELDS = ['name', 'type', 'website', 'owner', 'license', 'regulator', 'size', 'est', 'countries', 'crypto', 'fiat', 'sportsbook', 'casino', 'poker', 'kyc', 'withdrawals',
  'minDeposit', 'withdrawalLimit', 'games', 'languages', 'pros', 'cons', 'unfairTerms', 'color', 'logo'];

function need_feature(string $k): void { if (!feature_on($k)) fail('This part of Pitchside is not open yet.', 403); }
function op_get(string $slug): array { $r = row("SELECT * FROM operators WHERE slug = ?", [$slug]); if (!$r) fail('That casino or sportsbook no longer exists.', 404); return jdec($r['data'], []) + ['slug' => $slug]; }
function op_save(array $o): void {
  $now = now_ms(); $json = jenc($o);
  if (!q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [$json, $now, $o['slug']])->rowCount()) insert('operators', ['slug' => $o['slug'], 'data' => $json, 'created' => $now, 'updated' => $now]);
}
function is_rep(?array $u, array $o): bool { return $u && $u['role'] === 'business' && in_array($u['name'], $o['reps'] ?? [], true); }
function op_path(array $o): string { return ($o['type'] === 'casino' ? '/casinos/' : '/sportsbooks/') . $o['slug']; }
function review_board(array $o): string { return $o['type'] === 'casino' ? 'casino-reviews' : 'sportsbook-reviews'; }
function list_in($v, int $max = 30, int $len = 160): array {
  if (is_string($v)) $v = preg_split('/\s*[,\n]\s*/', $v);
  $items = array_map(fn($x) => mb_substr(trim((string) $x), 0, $len), is_array($v) ? $v : []);
  return array_values(array_slice(array_filter($items, fn($x) => $x !== ''), 0, $max));
}
// Blacklisted operators' affiliate links are paused and can't be resumed
function pause_affiliate_for(string $slug): void {
  $links = doc('AFF_LINKS'); $ch = false;
  foreach ($links as &$l) if (($l['op'] ?? '') === $slug && ($l['status'] ?? '') === 'active') { $l['status'] = 'paused'; $ch = true; } unset($l);
  if ($ch) save_doc('AFF_LINKS', $links);
}

/* =================== Operators =================== */
// Admin → Businesses: add or fully edit a casino / sportsbook
op('operator.save', function (array $in, array $u) {
  if (!can($u, 'manageCategories')) fail('Only admins can add or edit casinos and sportsbooks.', 403);
  $slug = slugify(str_in($in, 'slug', 64)); $new = $slug === '';
  $d = arr_in($in, 'data'); $name = mb_substr(trim((string) ($d['name'] ?? '')), 0, 80);
  if (mb_strlen($name) < 2) fail('Give the operator a name.');
  if ($new) { $slug = slugify($name); if (!$slug) fail('Give the operator a name with letters or numbers.'); if (val("SELECT 1 FROM operators WHERE slug = ?", [$slug])) fail('An operator with that name already exists.'); $o = ['slug' => $slug, 'reps' => [], 'claimed' => false, 'verified' => false, 'featured' => false, 'affiliate' => false, 'warning' => null, 'blacklist' => null]; }
  else $o = op_get($slug);
  $type = in_array($d['type'] ?? '', ['casino', 'sportsbook'], true) ? $d['type'] : 'casino';
  $color = preg_match('/^#[0-9a-f]{6}$/i', (string) ($d['color'] ?? '')) ? $d['color'] : '#1E6FB0';
  $logo = $d['logo'] ?? ($o['logo'] ?? null);
  if (is_string($logo) && str_starts_with($logo, 'data:')) $logo = store_data_image($logo, 2500000, 400);
  if ($logo !== null && !preg_match('#^/uploads/[A-Za-z0-9/_.-]+$#', (string) $logo)) $logo = null;
  $o = array_merge($o, [
    'name' => $name, 'type' => $type, 'website' => mb_substr(preg_replace('#^https?://#', '', trim((string) ($d['website'] ?? ''))), 0, 120),
    'owner' => mb_substr((string) ($d['owner'] ?? ''), 0, 120), 'license' => mb_substr((string) ($d['license'] ?? ''), 0, 120),
    'regulator' => in_array($d['regulator'] ?? '', ['mga', 'ukgc', 'curacao', 'anjouan', 'none'], true) ? $d['regulator'] : 'none',
    'size' => in_array($d['size'] ?? '', ['small', 'medium', 'large'], true) ? $d['size'] : 'small', 'est' => max(1990, min((int) date('Y'), (int) ($d['est'] ?? date('Y')))),
    'countries' => list_in($d['countries'] ?? [], 80, 12), 'crypto' => !empty($d['crypto']), 'fiat' => !empty($d['fiat']),
    'sportsbook' => $type === 'sportsbook' || !empty($d['sportsbook']), 'casino' => $type === 'casino' || !empty($d['casino']), 'poker' => !empty($d['poker']),
    'kyc' => mb_substr((string) ($d['kyc'] ?? ''), 0, 160), 'withdrawals' => list_in($d['withdrawals'] ?? [], 20, 40),
    'minDeposit' => mb_substr((string) ($d['minDeposit'] ?? ''), 0, 40), 'withdrawalLimit' => mb_substr((string) ($d['withdrawalLimit'] ?? ''), 0, 60),
    'games' => mb_substr((string) ($d['games'] ?? ''), 0, 160), 'languages' => mb_substr((string) ($d['languages'] ?? ''), 0, 120),
    'pros' => list_in($d['pros'] ?? [], 10, 160), 'cons' => list_in($d['cons'] ?? [], 10, 160), 'unfairTerms' => list_in($d['unfairTerms'] ?? [], 10, 200),
    'color' => $color, 'logo' => $logo]);
  op_save($o);
  audit($u, $new ? 'Operator added' : 'Operator edited', $name, 'Admin → Businesses', $new ? 'none' : 'previous', 'saved');
  return ['slug' => $slug];
});

op('operator.delete', function (array $in, array $u) {
  if (!can($u, 'manageCategories')) fail('Only admins can remove operators.', 403);
  $o = op_get(str_in($in, 'slug', 64));
  if (val("SELECT 1 FROM complaints WHERE op = ?", [$o['slug']]) || val("SELECT 1 FROM reviews WHERE op = ? AND status <> 'removed'", [$o['slug']]))
    fail("{$o['name']} has reviews or complaints, so it can't be deleted. Blacklist it instead if players should avoid it.");
  q("DELETE FROM operators WHERE slug = ?", [$o['slug']]);
  audit($u, 'Operator removed', $o['name'], str_in($in, 'reason', 400) ?: 'Admin', 'listed', 'removed');
  return [];
});

// The operator's own representative edits a few public fields
op('operator.edit', function (array $in, array $u) {
  need_feature('casinos');
  $o = op_get(str_in($in, 'slug', 64)); $admin = can($u, 'manageCategories');
  if (!$admin && !is_rep($u, $o)) fail("Only this operator's official representatives and admins can edit it.", 403);
  $d = arr_in($in, 'data');
  foreach ($admin ? ADMIN_FIELDS : REP_FIELDS as $k) if (array_key_exists($k, $d)) {
    $v = $d[$k];
    if (in_array($k, ['countries', 'withdrawals', 'pros', 'cons', 'unfairTerms'], true)) $o[$k] = list_in($v, 30, 160);
    elseif (in_array($k, ['crypto', 'fiat', 'sportsbook', 'casino', 'poker'], true)) $o[$k] = (bool) $v;
    elseif (in_array($k, ['color', 'logo', 'regulator', 'size', 'type', 'est'], true)) continue;   // use operator.save for these
    else $o[$k] = mb_substr(trim((string) $v), 0, 160);
  }
  op_save($o);
  audit($u, 'Business info edited', $o['name'], is_rep($u, $o) ? 'Edited by official rep' : 'Admin edit', 'previous', 'updated');
  return [];
});

op('operator.flag', function (array $in, array $u) {
  if (!can($u, 'manageCategories')) fail('Only admins can change this.', 403);
  $o = op_get(str_in($in, 'slug', 64)); $k = str_in($in, 'k', 16);
  if (!in_array($k, ['verified', 'featured', 'affiliate'], true)) fail('Unknown setting.');
  if ($k === 'verified' && empty($o['claimed'])) fail('Only claimed operators can be verified.');
  $prev = !empty($o[$k]); $o[$k] = bool_in($in, 'v'); op_save($o);
  audit($u, $k === 'verified' ? 'Business verification' : 'Commercial setting', $o['name'], "$k toggled", $prev ? 'on' : 'off', $o[$k] ? 'on' : 'off');
  return [];
});

op('operator.claim', function (array $in, array $u) {
  need_feature('casinos');
  if (!can($u, 'claimBusiness')) fail('Only business accounts can claim an operator. Ask an admin to make yours a business account.', 403);
  $o = op_get(str_in($in, 'slug', 64));
  if (in_array($u['name'], $o['reps'] ?? [], true)) fail("You already represent {$o['name']}.");
  $email = str_in($in, 'email', 190); $role = str_in($in, 'role', 80);
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter your work email.');
  if ($role === '') fail('Tell us your role at the company.');
  if (val("SELECT 1 FROM reports WHERE kind = 'claim' AND status = 'open' AND by_user = ? AND target LIKE ?", [$u['name'], '%"op":"' . $o['slug'] . '"%'])) fail('Your claim is already waiting for an admin.');
  $o['pendingClaim'] = $u['name']; op_save($o);
  $domainOk = $o['website'] && str_ends_with(strtolower($email), '@' . strtolower(preg_replace('#^www\.#', '', explode('/', $o['website'])[0])));
  insert('reports', ['queue' => 'claims', 'kind' => 'claim', 'target' => jenc(['op' => $o['slug'], 'user' => $u['name']]), 'board' => null,
    'reason' => mb_substr("Claim request ($role, $email" . ($domainOk ? ', email matches website' : ', email does NOT match website') . ')', 0, 1000), 'by_user' => $u['name'], 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
  return [];
});

op('operator.blacklist', function (array $in, array $u) {
  need_feature('casinos');
  $o = op_get(str_in($in, 'slug', 64)); need_mp($u, 'operator.warning');
  $reasons = array_values(array_intersect(array_map('strval', arr_in($in, 'reasons')), BLACKLIST_REASONS));
  $note = str_in($in, 'note', 1000);
  if (!$reasons) fail('Tick at least one reason.');
  if (mb_strlen($note) < 20) fail('Write a short public summary of what happened (20 characters or more).');
  $o['blacklist'] = ['at' => now_ms(), 'by' => $u['name'], 'reasons' => $reasons, 'note' => $note]; op_save($o);
  pause_affiliate_for($o['slug']);
  audit($u, 'Operator blacklisted', $o['name'], implode('; ', $reasons), 'listed', 'blacklisted');
  foreach ($o['reps'] ?? [] as $r) notify($r, 'complaint', "{$o['name']} has been blacklisted: " . implode(', ', $reasons), op_path($o), $u);
  return [];
});
op('operator.unblacklist', function (array $in, array $u) {
  $o = op_get(str_in($in, 'slug', 64)); need_mp($u, 'operator.warning');
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $o['blacklist'] = null; op_save($o);
  audit($u, 'Operator removed from blacklist', $o['name'], $reason, 'blacklisted', 'listed');
  return [];
});
op('operator.warning', function (array $in, array $u) {
  $o = op_get(str_in($in, 'slug', 64)); need_mp($u, 'operator.warning');
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $w = str_in($in, 'w', 16); $prev = $o['warning']['status'] ?? 'none';
  $o['warning'] = $w === 'none' ? null : (in_array($w, ['allegation', 'confirmed'], true) ? ['status' => $w, 'label' => $w === 'confirmed' ? 'Confirmed scam finding' : 'Open scam allegation', 'topic' => int_in($in, 'topic') ?: null] : fail('Pick a label.'));
  op_save($o);
  audit($u, 'Warning label', $o['name'], $reason, $prev, $w);
  return [];
});

/* =================== Reviews =================== */
function review_row(int $id): array { $r = row("SELECT * FROM reviews WHERE id = ?", [$id]); if (!$r) fail('That review no longer exists.', 404); return $r; }
function touch_review(int $id): void { q("UPDATE reviews SET updated = ? WHERE id = ?", [now_ms(), $id]); }

op('review.create', function (array $in, array $u) {
  need_feature('casinos');
  if (!can($u, 'review') || $u['role'] === 'business') fail($u['role'] === 'business' ? "Business accounts can't post reviews." : "Your account can't post reviews yet.", 403);
  $o = op_get(str_in($in, 'operator', 64));
  if (in_array($u['name'], $o['reps'] ?? [], true)) fail("You can't review a business you represent.");
  if (val("SELECT 1 FROM reviews WHERE op = ? AND user = ? AND status <> 'removed' AND at > ?", [$o['slug'], $u['name'], now_ms() - 180 * DAY_MS])) fail("You've reviewed {$o['name']} in the last 180 days. Edit that review instead.");
  $stars = int_in($in, 'stars'); if ($stars < 1 || $stars > 5) fail('Choose a rating from 1 to 5 stars.');
  $title = str_in($in, 'title', 100); $body = str_in($in, 'body', 10000);
  if (mb_strlen($title) < 6) fail('Give the topic a clearer title.');
  if (mb_strlen($body) < 30) fail('Write at least 30 characters so the review is useful.');
  need_ok(content_problem($u, $body));
  rate_limit('review:' . $u['name'], 5, 86400, "You've posted a lot of reviews today. Try again tomorrow.");
  $scores = []; $sc = arr_in($in, 'scores');
  foreach (REVIEW_CATS as $k) { $v = (int) ($sc[$k] ?? 0); $scores[$k] = $v >= 1 && $v <= 5 ? $v : $stars; }
  $tx = str_in($in, 'tx', 120);
  $status = can($u, 'verifiedReview') ? ($tx !== '' ? 'verified transaction' : 'verified user') : 'unverified';
  $dupe = (bool) val("SELECT 1 FROM reviews WHERE LOWER(body) = ?", [mb_strtolower($body)]);
  $now = now_ms(); $board = review_board($o);
  if (!board_doc($board)) fail('The reviews board is missing. An admin needs to restore it in Admin → Forum.');
  [$rid, $tid] = tx(function () use ($o, $u, $stars, $scores, $title, $body, $status, $tx, $now, $board) {
    $rid = insert('reviews', ['op' => $o['slug'], 'user' => $u['name'], 'stars' => $stars, 'scores' => jenc($scores), 'title' => $title, 'body' => $body, 'status' => $status,
      'tx' => $tx ?: null, 'at' => $now, 'response' => null, 'history' => '[]', 'updated' => $now]);
    $tid = insert('topics', ['board' => $board, 'title' => $title, 'author' => $u['name'], 'at' => $now, 'last_at' => $now, 'tags' => '[]', 'teams' => '[]', 'review_id' => $rid, 'updated' => $now]);
    insert('posts', ['topic_id' => $tid, 'author' => $u['name'], 'body' => $body, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    q("UPDATE reviews SET thread = ? WHERE id = ?", [$tid, $rid]);
    $p = $u['profile']; $p['rep']['review'] = (int) ($p['rep']['review'] ?? 0) + 1;
    q("UPDATE users SET posts = posts + 1, topics = topics + 1, profile = ?, updated = ? WHERE id = ?", [jenc($p), $now, $u['id']]);
    return [$rid, $tid];
  });
  if ($dupe) insert('reports', ['queue' => 'review_disputes', 'kind' => 'review', 'target' => jenc(['review' => $rid]), 'board' => null, 'reason' => 'Duplicate review text detected', 'by_user' => 'system', 'at' => $now, 'status' => 'open', 'updated' => $now]);
  $low = (int) val("SELECT COUNT(*) FROM reviews WHERE op = ? AND stars = 1 AND at > ? AND status <> 'removed'", [$o['slug'], $now - 2 * DAY_MS]);
  if ($stars === 1 && $low === 3) insert('reports', ['queue' => 'review_disputes', 'kind' => 'review', 'target' => jenc(['review' => $rid]), 'board' => null, 'reason' => "Possible review bombing: 3 one-star reviews of {$o['name']} in 48 hours", 'by_user' => 'system', 'at' => $now, 'status' => 'open', 'updated' => $now]);
  foreach ($o['reps'] ?? [] as $r) notify($r, 'review', "New {$stars}★ review of {$o['name']}: “{$title}”", "/topic/$tid", $u);
  return ['id' => $rid, 'thread' => $tid];
});

op('review.vote', function (array $in, array $u) {
  $r = review_row(int_in($in, 'id'));
  if ($r['user'] === $u['name']) fail("You can't vote on your own review.");
  if ($u['status'] !== 'active') fail("Your account can't vote right now.", 403);
  $v = str_in($in, 'v', 4) === 'up' ? 1 : -1;
  $cur = val("SELECT v FROM review_votes WHERE review_id = ? AND user = ?", [$r['id'], $u['name']]);
  q("DELETE FROM review_votes WHERE review_id = ? AND user = ?", [$r['id'], $u['name']]);
  if ((int) $cur !== $v) insert('review_votes', ['review_id' => $r['id'], 'user' => $u['name'], 'v' => $v]);
  touch_review((int) $r['id']);
  return [];
});

op('review.edit', function (array $in, array $u) {
  $r = review_row(int_in($in, 'id'));
  if ($r['user'] !== $u['name']) fail('Only the author can edit a review.', 403);
  if ($u['status'] !== 'active') fail("Your account can't edit right now.", 403);
  $stars = int_in($in, 'stars'); if ($stars < 1 || $stars > 5) fail('Choose a rating from 1 to 5 stars.');
  $body = str_in($in, 'body', 10000); if (mb_strlen($body) < 30) fail('Write at least 30 characters.');
  need_ok(content_problem($u, $body));
  $hist = jdec($r['history'], []); $hist[] = ['at' => now_ms(), 'stars' => (int) $r['stars'], 'body' => $r['body']];
  q("UPDATE reviews SET stars = ?, body = ?, history = ?, updated = ? WHERE id = ?", [$stars, $body, jenc($hist), now_ms(), $r['id']]);
  if ($r['thread']) {
    $p = row("SELECT * FROM posts WHERE topic_id = ? ORDER BY at, id LIMIT 1", [$r['thread']]);
    if ($p && $p['body'] !== $body) { $rev = jdec($p['revisions'], []); $rev[] = ['at' => now_ms(), 'body' => $p['body'], 'by' => $u['name']];
      q("UPDATE posts SET body = ?, revisions = ? WHERE id = ?", [$body, jenc($rev), $p['id']]); touch_topic((int) $r['thread']); }
  }
  return [];
});

op('review.respond', function (array $in, array $u) {
  $r = review_row(int_in($in, 'id')); $o = op_get($r['op']);
  if (!(is_rep($u, $o) && can($u, 'respondBusiness')) && !can($u, 'manageCategories')) fail("Only {$o['name']}'s official representatives can respond.", 403);
  $body = str_in($in, 'body', 3000); if (mb_strlen($body) < 5) fail('Write a response.');
  need_ok(content_problem($u, $body));
  q("UPDATE reviews SET response = ?, updated = ? WHERE id = ?", [jenc(['by' => $u['name'], 'body' => $body, 'at' => now_ms()]), now_ms(), $r['id']]);
  notify($r['user'], 'review', "{$o['name']} responded to your review", $r['thread'] ? "/topic/{$r['thread']}" : op_path($o), $u);
  return [];
});

op('review.dispute', function (array $in, array $u) {
  $r = review_row(int_in($in, 'id')); $o = op_get($r['op']);
  if (!is_rep($u, $o)) fail("Only {$o['name']}'s official representatives can dispute its reviews.", 403);
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Explain why you dispute this review.');
  if (val("SELECT 1 FROM reports WHERE kind = 'review' AND status = 'open' AND target = ?", [jenc(['review' => (int) $r['id']])])) fail('This review is already waiting for a moderator.');
  q("UPDATE reviews SET status = 'disputed', updated = ? WHERE id = ?", [now_ms(), $r['id']]);
  insert('reports', ['queue' => 'review_disputes', 'kind' => 'review', 'target' => jenc(['review' => (int) $r['id']]), 'board' => null, 'reason' => mb_substr("Business dispute: $reason", 0, 1000), 'by_user' => $u['name'], 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
  notify($r['user'], 'review', 'A business disputed your review. Moderators will look at it.', op_path($o), $u);
  return [];
});

op('review.status', function (array $in, array $u) {
  $r = review_row(int_in($in, 'id')); need_mp($u, 'review.moderate');
  $st = str_in($in, 'st', 24); if (!in_array($st, REVIEW_STATUSES, true)) fail('Pick a status.');
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  q("UPDATE reviews SET status = ?, updated = ? WHERE id = ?", [$st, now_ms(), $r['id']]);
  if ($r['thread']) touch_topic((int) $r['thread']);
  $o = op_get($r['op']);
  audit($u, $st === 'removed' ? 'Review removal' : 'Review status', "review #{$r['id']} ({$o['name']})", $reason, $r['status'], $st);
  notify($r['user'], 'review', "Moderators changed your review status to “{$st}”", $r['thread'] ? "/topic/{$r['thread']}" : op_path($o), $u);
  return [];
});

/* =================== Complaints =================== */
function complaint_row(string $id): array { $c = row("SELECT * FROM complaints WHERE id = ?", [$id]); if (!$c) fail('That complaint no longer exists.', 404); return $c; }
function case_role(array $c, ?array $u, ?array $o = null): string {
  if (!$u) return 'guest';
  if ($u['name'] === $c['user']) return 'player';
  $o = $o ?? op_get($c['op']);
  if (in_array($u['name'], $o['reps'] ?? [], true)) return 'casino';
  if (mp($u, 'complaint.manage')) return 'specialist';
  return 'member';
}
function case_msg(string $id, string $by, string $body, ?string $role = null): void {
  insert('complaint_msgs', ['complaint_id' => $id, 'by_user' => $by, 'body' => $body, 'at' => now_ms(), 'role' => $role]);
  q("UPDATE complaints SET updated = ? WHERE id = ?", [now_ms(), $id]);
}
function case_people(array $c, array $o): array {
  $f = array_map(fn($r) => $r['user'], rows("SELECT user FROM complaint_follows WHERE complaint_id = ?", [$c['id']]));
  return array_values(array_unique(array_filter(array_merge([$c['user'], $c['specialist']], $o['reps'] ?? [], $f))));
}
// One place for status changes: system line, audit entry, notifications, the 7-day deadline.
function set_case_status(array $c, string $status, ?array $actor, ?string $reason, array $opts = []): void {
  $o = op_get($c['op']); $prev = $c['status'];
  $deadline = $status === 'Awaiting Business' ? now_ms() + 7 * DAY_MS : null;
  $refunded = array_key_exists('recovered', $opts) ? max(0, (int) $opts['recovered']) : (int) $c['refunded'];
  q("UPDATE complaints SET status = ?, deadline = ?, refunded = ?, updated = ? WHERE id = ?", [$status, $deadline, $refunded, now_ms(), $c['id']]);
  $extra = !empty($opts['recovered']) ? ' · $' . number_format((int) $opts['recovered']) . ' recovered' : '';
  case_msg($c['id'], 'system', 'Status → ' . (STATUS_LABEL[$status] ?? $status) . $extra, 'system');
  if (empty($opts['quiet'])) audit($actor, in_array($status, OPEN_STATUSES, true) ? 'Complaint status' : 'Complaint decision', $c['id'], $reason ?? '—', STATUS_LABEL[$prev] ?? $prev, STATUS_LABEL[$status] ?? $status);
  foreach (case_people($c, $o) as $p) notify($p, 'complaint', "{$c['id']} ({$o['name']}) is now “" . (STATUS_LABEL[$status] ?? $status) . '”', "/complaints/{$c['id']}", $actor);
  if ($c['thread']) touch_topic((int) $c['thread']);
}
function evidence_in(array $in, array $u, bool $public): array {
  $out = [];
  foreach (array_slice(arr_in($in, 'att'), 0, 10) as $a) {
    $f = row("SELECT * FROM uploads WHERE id = ? AND user = ?", [(int) ($a['id'] ?? 0), $u['name']]);
    if ($f) $out[] = ['id' => (int) $f['id'], 'name' => $f['name'], 'public' => $public, 'by' => $u['name'], 'at' => now_ms()];
  }
  return $out;
}

op('complaint.create', function (array $in, array $u) {
  need_feature('complaints');
  if (!can($u, 'topic')) fail(needs_verify($u) ? 'Confirm your email address before filing a complaint.' : "Your account can't file complaints right now.", 403);
  $o = op_get(str_in($in, 'operator', 64));
  if (in_array($u['name'], $o['reps'] ?? [], true)) fail("You can't file a complaint against a business you represent.");
  $title = str_in($in, 'title', 90); $st = str_in($in, 'statement', 10000); $cat = str_in($in, 'cat', 60);
  if (mb_strlen($title) < 8) fail('Give your complaint a short, clear title.');
  if (mb_strlen($st) < 40) fail('Describe what happened in at least 40 characters.');
  if (!bool_in($in, 'support')) fail("Please contact the operator's support first. Most problems get fixed there, and our specialists will ask what they said.");
  if (!in_array($cat, COMPLAINT_CATS, true)) $cat = 'Other';
  need_ok(content_problem($u, $st));
  rate_limit('complaint:' . $u['name'], 3, 86400, "You've filed several complaints today. A specialist will be in touch.");
  if (!board_doc('complaint-talk')) fail('The complaint discussion board is missing. An admin needs to restore it in Admin → Forum.');
  $ev = evidence_in($in, $u, bool_in($in, 'public'));
  $now = now_ms();
  $id = tx(function () use ($o, $u, $title, $cat, $st, $ev, $now, $in) {
    $seq = max(1000, (int) val("SELECT MAX(seq) FROM complaints")) + 1; $id = "PC-$seq";
    insert('complaints', ['id' => $id, 'seq' => $seq, 'op' => $o['slug'], 'user' => $u['name'], 'title' => $title, 'cat' => $cat, 'amount' => max(0, min(100000000, int_in($in, 'amount'))),
      'refunded' => 0, 'status' => 'Open', 'at' => $now, 'statement' => $st, 'evidence' => jenc($ev), 'mod_notes' => '[]', 'support' => 1, 'updated' => $now]);
    insert('complaint_msgs', ['complaint_id' => $id, 'by_user' => $u['name'], 'body' => $st, 'at' => $now, 'role' => null]);
    insert('complaint_msgs', ['complaint_id' => $id, 'by_user' => 'system', 'body' => 'Complaint submitted. A specialist will pick it up within 48 hours.', 'at' => $now, 'role' => 'system']);
    insert_ignore('complaint_follows', ['complaint_id' => $id, 'user' => $u['name']]);
    $tid = insert('topics', ['board' => 'complaint-talk', 'title' => $title, 'author' => $u['name'], 'at' => $now, 'last_at' => $now, 'tags' => '[]', 'teams' => '[]', 'complaint_id' => $id, 'updated' => $now]);
    insert('posts', ['topic_id' => $tid, 'author' => $u['name'], 'body' => $st, 'at' => $now, 'hidden' => 0, 'revisions' => '[]']);
    q("UPDATE complaints SET thread = ? WHERE id = ?", [$tid, $id]);
    insert('reports', ['queue' => 'complaints', 'kind' => 'complaint', 'target' => jenc(['complaint' => $id]), 'board' => null, 'reason' => 'New complaint needs a specialist', 'by_user' => 'system', 'at' => $now, 'status' => 'open', 'updated' => $now]);
    return $id;
  });
  foreach ($o['reps'] ?? [] as $r) notify($r, 'complaint', "New complaint $id against {$o['name']}: “{$title}”", "/complaints/$id", $u);
  return ['id' => $id];
});

op('complaint.reply', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); $o = op_get($c['op']); $role = case_role($c, $u, $o);
  if (!in_array($role, ['player', 'casino', 'specialist'], true)) fail('Only the player, the operator and our specialists post in a case. Join the community discussion instead.', 403);
  if (!in_array($c['status'], OPEN_STATUSES, true)) fail('This case is closed.');
  if ($u['status'] !== 'active' && $role !== 'player') fail("Your account can't post right now.", 403);
  $body = str_in($in, 'body', 10000); if ($body === '') fail('Write a message first.');
  need_ok(content_problem($u, $body));
  rate_limit('case:' . $u['name'], 20, 3600);
  $ev = evidence_in($in, $u, false);
  if ($ev) q("UPDATE complaints SET evidence = ? WHERE id = ?", [jenc(array_merge(jdec($c['evidence'], []), $ev)), $c['id']]);
  case_msg($c['id'], $u['name'], $body);
  if ($role === 'casino' && $c['status'] === 'Awaiting Business') set_case_status($c, 'Under Investigation', $u, 'Operator replied', ['quiet' => true]);
  if ($role === 'player' && $c['status'] === 'Awaiting User') set_case_status($c, 'Under Investigation', $u, 'Player replied', ['quiet' => true]);
  foreach (case_people($c, $o) as $p) notify($p, 'complaint', "New message in {$c['id']} from " . ($role === 'casino' ? $o['name'] : $u['name']), "/complaints/{$c['id']}", $u);
  return [];
});

op('complaint.evidence', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); $role = case_role($c, $u);
  if (!in_array($role, ['player', 'specialist'], true)) fail('Only the player and our specialists can add evidence.', 403);
  $ev = evidence_in($in, $u, bool_in($in, 'public')); if (!$ev) fail('Choose at least one file.');
  q("UPDATE complaints SET evidence = ?, updated = ? WHERE id = ?", [jenc(array_merge(jdec($c['evidence'], []), $ev)), now_ms(), $c['id']]);
  case_msg($c['id'], 'system', "{$u['name']} added " . count($ev) . ' evidence file' . (count($ev) > 1 ? 's' : ''), 'system');
  return [];
});
op('complaint.evidenceToggle', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); $role = case_role($c, $u);
  if (!in_array($role, ['player', 'specialist'], true)) fail('Only the player and our specialists can change this.', 403);
  $ev = jdec($c['evidence'], []); $i = int_in($in, 'i', -1); if (!isset($ev[$i])) fail('That file no longer exists.');
  $ev[$i]['public'] = empty($ev[$i]['public']);
  q("UPDATE complaints SET evidence = ?, updated = ? WHERE id = ?", [jenc($ev), now_ms(), $c['id']]);
  return [];
});

op('complaint.follow', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16));
  if (q("DELETE FROM complaint_follows WHERE complaint_id = ? AND user = ?", [$c['id'], $u['name']])->rowCount()) $on = false;
  else { insert_ignore('complaint_follows', ['complaint_id' => $c['id'], 'user' => $u['name']]); $on = true; }
  q("UPDATE complaints SET updated = ? WHERE id = ?", [now_ms(), $c['id']]);
  return ['on' => $on];
});

op('complaint.take', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $prev = $c['specialist'];
  q("UPDATE complaints SET specialist = ?, updated = ? WHERE id = ?", [$u['name'], now_ms(), $c['id']]);
  case_msg($c['id'], 'system', "Specialist {$u['name']} " . ($prev ? 'took over' : 'took') . ' the case', 'system');
  if ($c['status'] === 'Open') set_case_status(complaint_row($c['id']), 'Under Investigation', $u, null, ['quiet' => true]);
  q("UPDATE reports SET status = 'resolved', closed_by = ?, closed_at = ?, updated = ? WHERE kind = 'complaint' AND status = 'open' AND target = ? AND reason LIKE 'New complaint%'",
    [$u['name'], now_ms(), now_ms(), jenc(['complaint' => $c['id']])]);
  audit($u, 'Complaint assigned', $c['id'], $prev ? "Taken over from $prev" : 'Specialist assigned', $prev ?: 'unassigned', $u['name']);
  notify($c['user'], 'complaint', "Specialist {$u['name']} is handling {$c['id']}", "/complaints/{$c['id']}", $u);
  return [];
});

op('complaint.status', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $v = str_in($in, 'v', 24); if (!in_array($v, ['Awaiting Business', 'Awaiting User', 'Escalated', 'Under Investigation'], true)) fail('Pick a status.');
  if (!in_array($c['status'], OPEN_STATUSES, true)) fail('This case is closed.');
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $note = str_in($in, 'note', 5000); if ($note !== '') case_msg($c['id'], $u['name'], $note);
  set_case_status($c, $v, $u, $reason);
  if ($v === 'Escalated') insert('reports', ['queue' => 'complaints', 'kind' => 'complaint', 'target' => jenc(['complaint' => $c['id']]), 'board' => null, 'reason' => "Escalated: $reason", 'by_user' => $u['name'], 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
  return [];
});

op('complaint.outcome', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $v = str_in($in, 'st', 24); if (!in_array($v, OUTCOMES, true)) fail('Pick an outcome.');
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $note = str_in($in, 'note', 5000); if ($note !== '') case_msg($c['id'], $u['name'], $note);
  set_case_status($c, $v, $u, $reason, ['recovered' => in_array($v, ['Resolved', 'Partially Resolved'], true) ? max(0, int_in($in, 'rec')) : 0]);
  q("UPDATE reports SET status = 'resolved', closed_by = ?, closed_at = ?, updated = ? WHERE kind = 'complaint' AND status = 'open' AND target = ?", [$u['name'], now_ms(), now_ms(), jenc(['complaint' => $c['id']])]);
  return [];
});

op('complaint.solved', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16));
  if ($c['user'] !== $u['name']) fail('Only the person who filed the complaint can do this.', 403);
  if (!in_array($c['status'], OPEN_STATUSES, true)) fail('This case is already closed.');
  $n = str_in($in, 'note', 5000); if ($n !== '') case_msg($c['id'], $u['name'], $n);
  set_case_status($c, 'Resolved', $u, 'Player confirmed resolution', ['recovered' => max(0, int_in($in, 'rec'))]);
  q("UPDATE reports SET status = 'resolved', closed_by = ?, closed_at = ?, updated = ? WHERE kind = 'complaint' AND status = 'open' AND target = ?", [$u['name'], now_ms(), now_ms(), jenc(['complaint' => $c['id']])]);
  return [];
});

op('complaint.withdraw', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16));
  if ($c['user'] !== $u['name']) fail('Only the person who filed the complaint can withdraw it.', 403);
  if (!in_array($c['status'], OPEN_STATUSES, true)) fail('This case is already closed.');
  set_case_status($c, 'Closed', $u, 'Withdrawn by player');
  q("UPDATE reports SET status = 'dismissed', closed_by = ?, closed_at = ?, updated = ? WHERE kind = 'complaint' AND status = 'open' AND target = ?", [$u['name'], now_ms(), now_ms(), jenc(['complaint' => $c['id']])]);
  return [];
});

op('complaint.note', function (array $in, array $u) {
  $c = complaint_row(str_in($in, 'id', 16)); need_mp($u, 'complaint.manage');
  $t = str_in($in, 'body', 3000); if ($t === '') return [];
  $n = jdec($c['mod_notes'], []); $n[] = ['by' => $u['name'], 'at' => now_ms(), 'text' => $t];
  q("UPDATE complaints SET mod_notes = ?, updated = ? WHERE id = ?", [jenc($n), now_ms(), $c['id']]);
  return [];
});

/* =================== Sending Phase 2 data to the browser =================== */
function operators_out(int $since): array {
  return array_map(fn($r) => jdec($r['data'], []) + ['slug' => $r['slug']], rows("SELECT * FROM operators WHERE updated > ? ORDER BY slug", [$since]));
}
function reviews_out(?array $viewer, int $since): array {
  $rs = rows("SELECT * FROM reviews WHERE updated > ? ORDER BY id", [$since]);
  if (!$rs) return [];
  $ids = array_map(fn($r) => (int) $r['id'], $rs); $votes = [];
  foreach (array_chunk($ids, 500) as $ch) foreach (rows("SELECT * FROM review_votes WHERE review_id IN (" . in_list($ch) . ")", $ch) as $v) $votes[(int) $v['review_id']][] = $v;
  $mod = mp($viewer, 'review.moderate'); $out = [];
  foreach ($rs as $r) {
    $hidden = $r['status'] === 'removed' && !$mod && !($viewer && $viewer['name'] === $r['user']);
    // Who voted stays private: the browser gets counts, plus your own vote
    $up = []; $down = []; $k = 0;
    foreach ($votes[(int) $r['id']] ?? [] as $v) { $label = ($viewer && $v['user'] === $viewer['name']) ? $viewer['name'] : '·' . (++$k);
      if ((int) $v['v'] > 0) $up[] = $label; else $down[] = $label; }
    $out[] = ['id' => (int) $r['id'], 'op' => $r['op'], 'user' => $r['user'], 'stars' => (int) $r['stars'], 'scores' => jdec($r['scores'], []), 'title' => $r['title'],
      'body' => $hidden ? '' : $r['body'], 'status' => $r['status'], 'helpful' => $up, 'unhelpful' => $down, 'at' => (int) $r['at'],
      'response' => jdec($r['response'], null), 'history' => $hidden ? [] : jdec($r['history'], []), 'thread' => $r['thread'] ? (int) $r['thread'] : null];
  }
  return $out;
}
function complaints_out(?array $viewer, int $since): array {
  $cs = rows("SELECT * FROM complaints WHERE updated > ? ORDER BY seq", [$since]);
  if (!$cs) return [];
  $ids = array_map(fn($c) => $c['id'], $cs); $msgs = []; $fol = [];
  foreach (array_chunk($ids, 300) as $ch) {
    foreach (rows("SELECT * FROM complaint_msgs WHERE complaint_id IN (" . in_list($ch) . ") ORDER BY id", $ch) as $m) $msgs[$m['complaint_id']][] = ['by' => $m['by_user'], 'body' => $m['body'], 'at' => (int) $m['at'], 'role' => $m['role']];
    foreach (rows("SELECT * FROM complaint_follows WHERE complaint_id IN (" . in_list($ch) . ")", $ch) as $f) $fol[$f['complaint_id']][] = $f['user'];
  }
  $spec = mp($viewer, 'complaint.manage'); $out = [];
  foreach ($cs as $c) {
    $mine = $viewer && $viewer['name'] === $c['user'];
    $ev = array_map(function ($e) use ($mine, $spec) { $see = !empty($e['public']) || $mine || $spec;
      return $see ? ['name' => $e['name'], 'public' => !empty($e['public']), 'url' => isset($e['id']) ? '/api/file/' . (int) $e['id'] : null] : ['name' => '', 'public' => false, 'url' => null]; }, jdec($c['evidence'], []));
    $f = $fol[$c['id']] ?? [];
    $out[] = ['id' => $c['id'], 'op' => $c['op'], 'user' => $c['user'], 'title' => $c['title'], 'cat' => $c['cat'], 'amount' => (int) $c['amount'], 'currency' => 'USD',
      'refunded' => (int) $c['refunded'], 'status' => $c['status'], 'at' => (int) $c['at'], 'deadline' => $c['deadline'] ? (int) $c['deadline'] : null, 'specialist' => $c['specialist'],
      'statement' => $c['statement'], 'evidence' => $ev, 'messages' => $msgs[$c['id']] ?? [], 'modNotes' => $spec ? jdec($c['mod_notes'], []) : [],
      'followers' => $viewer && in_array($viewer['name'], $f, true) ? [$viewer['name']] : [], 'contactedSupport' => (bool) $c['support'], 'thread' => $c['thread'] ? (int) $c['thread'] : null];
  }
  return $out;
}
// Who may open a complaint evidence file
function evidence_file_ok(int $fileId, ?array $u): bool {
  foreach (rows("SELECT * FROM complaints WHERE evidence LIKE ?", ['%"id":' . $fileId . ',%']) as $c)
    foreach (jdec($c['evidence'], []) as $e) if ((int) ($e['id'] ?? 0) === $fileId) {
      if (!empty($e['public'])) return true;
      if ($u && ($u['name'] === $c['user'] || mp($u, 'complaint.manage'))) return true;
    }
  return false;
}
