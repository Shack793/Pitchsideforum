<?php
// Pitchside Forum: AI-first moderation ("AI moderator").
// A separate add-on: it wraps the existing posting actions (this file loads after the core ones) and keeps its own
// settings, log and queue. It never touches the AI chatbots in app/ai-community. Remove this file to switch it all off.
//
// What it checks: new topics, replies, edits and marketplace listings as they're posted, and private messages only
// when a member reports them.
// How it decides: rule-based signals run instantly (blocked or look-alike links, phishing and scam wording, link
// shorteners, off-site contact lures, mass posting, the same text from several accounts, impersonation). One signal
// alone never triggers an action, except a blocked link. With an AI key added in Admin → AI moderation, risky posts
// also get an AI check straight after posting.
// What it may do on its own: refuse blocked links, remove obvious spam, hide suspicious posts until checked, warn,
// suspend for up to 7 days. Never: permanent bans (it asks you), resolve casino disputes, remove criticism.
// Every action goes in the log with its reason, and an admin can reverse it.
declare(strict_types=1);

const AM_ACTOR = ['id' => 0, 'name' => 'AI moderator', 'role' => 'system', 'status' => 'active'];
const AM_SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'rb.gy', 'is.gd', 'shorturl.at', 'tiny.cc', 'ow.ly', 'goo.su', 'shorte.st', 'adf.ly', 'bl.ink', 'rebrand.ly', 't.ly', 'v.gd', 'clck.ru', 'u.to', 'qr.ae', 'lnkd.in', 's.id', 'shrtco.de', 'linktr.ee'];
const AM_GENERIC = ['casino', 'casinos', 'sports', 'sportsbook', 'online', 'slots', 'spins', 'poker', 'bingo', 'jackpot', 'games', 'gaming', 'player', 'lucky', 'royal', 'vegas', 'fortune', 'golden', 'bonus', 'betting', 'crypto', 'wager', 'stakes', 'winner', 'winners', 'palace', 'empire', 'kingdom', 'planet', 'magic', 'mister', 'queen', 'world', 'premier', 'classic', 'diamond', 'silver', 'rocket', 'monster'];

/* ---------- Settings ---------- */
function am_defaults(): array {
  return [
    'enabled' => true,           // rule-based checks
    'ai' => true,                // AI checks (only run once a key is added)
    'provider' => 'anthropic',   // 'anthropic' or 'openai' (any OpenAI-compatible service)
    'model' => '', 'base_url' => '',
    'ai_scope' => 'risky',       // 'risky': posts with any warning sign, new accounts and listings; 'all': every post
    'ai_daily_cap' => 500,
    'remove_at' => 8, 'hide_at' => 5, 'flag_at' => 3,
    'ai_remove_conf' => 0.85, 'ai_hide_conf' => 0.6,
    'strikes' => true, 'scam_suspend_days' => 7,
    'blocked_domains' => [],
    'trusted_domains' => ['youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'reddit.com', 'wikipedia.org', 'bbc.co.uk', 'bbc.com', 'espn.com', 'skysports.com', 'flashscore.com', 'sofascore.com', 'transfermarkt.com', 'coingecko.com', 'coinmarketcap.com', 'github.com', 'imgur.com', 'giphy.com'],
    'summary' => 'daily',        // 'daily', 'weekly' or 'off'
    'alerts' => true,            // email and notify Super Admins at once about serious cases
  ];
}
function am_cfg(bool $fresh = false): array {
  static $c = null;
  if ($c === null || $fresh) { $s = jdec((string) meta_get('automod:config', '{}'), []); $c = array_merge(am_defaults(), is_array($s) ? $s : []); }
  return $c;
}
function am_key(): string { $k = (string) (meta_get('automod:key', '') ?? ''); return $k !== '' ? $k : (string) (cfg('automod_api_key') ?? ''); }
function am_ai_ready(): bool { $c = am_cfg(); return $c['ai'] && am_key() !== '' && ($c['provider'] === 'anthropic' || trim((string) $c['model']) !== ''); }

/* ---------- Tables (apply.sh creates them; safe to run again) ---------- */
function am_install_tables(): void {
  if (cfg('db_driver') === 'sqlite') {
    q("CREATE TABLE IF NOT EXISTS automod_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user TEXT NOT NULL, user_id INTEGER NULL, kind TEXT NOT NULL,
      topic_id INTEGER NULL, post_id INTEGER NULL, msg_id INTEGER NULL, board TEXT NULL, excerpt TEXT NULL, rule TEXT NOT NULL, reason TEXT NULL, source TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0, action TEXT NOT NULL, details TEXT NULL, serious INTEGER NOT NULL DEFAULT 0, reversed_at INTEGER NULL, reversed_by TEXT NULL, reverse_note TEXT NULL)");
    q("CREATE INDEX IF NOT EXISTS automod_log_at ON automod_log (at)"); q("CREATE INDEX IF NOT EXISTS automod_log_user ON automod_log (user, at)");
    q("CREATE TABLE IF NOT EXISTS automod_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref INTEGER NOT NULL, user TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
      signals TEXT NULL, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending')");
    q("CREATE INDEX IF NOT EXISTS automod_queue_status ON automod_queue (status, id)");
  } else {
    q("CREATE TABLE IF NOT EXISTS automod_log (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, at BIGINT NOT NULL, user VARCHAR(32) NOT NULL, user_id INT UNSIGNED NULL,
      kind VARCHAR(16) NOT NULL, topic_id INT UNSIGNED NULL, post_id INT UNSIGNED NULL, msg_id INT UNSIGNED NULL, board VARCHAR(64) NULL, excerpt TEXT NULL, rule VARCHAR(160) NOT NULL,
      reason TEXT NULL, source VARCHAR(8) NOT NULL, score INT NOT NULL DEFAULT 0, action VARCHAR(24) NOT NULL, details TEXT NULL, serious TINYINT NOT NULL DEFAULT 0,
      reversed_at BIGINT NULL, reversed_by VARCHAR(32) NULL, reverse_note TEXT NULL, KEY k_at (at), KEY k_user (user, at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    q("CREATE TABLE IF NOT EXISTS automod_queue (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(16) NOT NULL, ref INT UNSIGNED NOT NULL, user VARCHAR(32) NOT NULL,
      score INT NOT NULL DEFAULT 0, signals TEXT NULL, at BIGINT NOT NULL, tries INT NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'pending', KEY k_status (status, id))
      ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  }
}
function am_ready(): bool {
  static $ok = null;
  if ($ok === null) { try { val("SELECT 1 FROM automod_log LIMIT 1"); $ok = true; } catch (Throwable $e) { $ok = false; } }
  return $ok;
}

/* ---------- Links ---------- */
function am_domain(string $host): string {
  $h = strtolower(rtrim($host, '.')); $h = preg_replace('/^www\d*\./', '', $h) ?? $h;
  $p = explode('.', $h); $n = count($p);
  if ($n >= 3 && preg_match('/^(co|com|org|net|ac|gov)\.[a-z]{2}$/', $p[$n - 2] . '.' . $p[$n - 1])) return implode('.', array_slice($p, -3));
  return $n >= 2 ? implode('.', array_slice($p, -2)) : $h;
}
function am_links(string $text): array {
  $out = [];
  $tld = 'com|net|org|io|xyz|top|bet|casino|club|site|online|live|vip|win|app|me|co|cc|ru|cn|tk|ml|ga|cf|gq|link|click|shop|store|info|biz|pro|gg|tv|uk|ng|gh|ke|za|in|us|eu|de|fr|es|it|nl|ly|to|sh|ws|su|bz|pw|icu|cyou|buzz|fun|games|space|website|digital|money|cash|finance|exchange|trade|bond|lol|sbs';
  if (preg_match_all('~(?:https?://|www\.)([^\s/<>"\'\)\]]+)|\b((?:[a-z0-9-]+\.)+(?:' . $tld . '))(?=[/\s,.!?)\]]|$)~i', $text, $m, PREG_SET_ORDER)) {
    foreach ($m as $x) {
      $host = $x[1] !== '' ? $x[1] : ($x[2] ?? ''); $host = strtolower(preg_replace('/[:].*$/', '', $host) ?? $host);
      if ($host === '' || !str_contains($host, '.')) continue;
      $out[] = ['host' => $host, 'domain' => am_domain($host), 'raw' => $x[0]];
    }
  }
  return $out;
}
function am_site_domain(): string { $h = parse_url(site_url('/'), PHP_URL_HOST); return $h ? am_domain((string) $h) : ''; }
function am_operators(): array {
  static $ops = null;
  if ($ops !== null) return $ops;
  $ops = [];
  try {
    foreach (rows("SELECT slug, data FROM operators") as $r) {
      $d = jdec($r['data'], []); $site = (string) ($d['website'] ?? '');
      $host = $site !== '' ? (parse_url(str_contains($site, '://') ? $site : "https://$site", PHP_URL_HOST) ?: '') : '';
      $tokens = [];
      foreach (preg_split('/[^a-z0-9]+/', strtolower($r['slug'] . ' ' . ($d['name'] ?? ''))) as $t)
        if (strlen($t) >= 6 && !in_array($t, AM_GENERIC, true) && !ctype_digit($t)) $tokens[$t] = true;
      $ops[] = ['slug' => $r['slug'], 'name' => (string) ($d['name'] ?? $r['slug']), 'domain' => $host ? am_domain($host) : '', 'tokens' => array_keys($tokens), 'reps' => $d['reps'] ?? []];
    }
  } catch (Throwable $e) {}
  return $ops;
}

/* ---------- Signals ---------- */
function am_plain(string $s): string { return mb_strtolower(preg_replace('/\s+/u', ' ', $s) ?? $s); }
function am_negated(string $t, int $pos): bool { return (bool) preg_match("/\b(never|don'?t|do not|not|no one|nobody|won'?t|avoid|beware)\b[^.!?]{0,30}$/", substr($t, max(0, $pos - 40), min(40, $pos))); }
function am_signals(array $u, string $text, string $title, array $ctx): array {
  $c = am_cfg(); $t = am_plain($title . "\n" . $text); $sig = [];
  $add = function (string $code, string $label, int $pts, string $cat) use (&$sig) { if (!isset($sig[$code])) $sig[$code] = ['code' => $code, 'label' => $label, 'points' => $pts, 'cat' => $cat]; };
  $siteDom = am_site_domain(); $trusted = array_map('strtolower', (array) $c['trusted_domains']); $blocked = array_map('strtolower', (array) $c['blocked_domains']);
  foreach ((array) setting('bannedDomains', []) as $d) if (is_string($d) && $d !== '') $blocked[] = strtolower($d);
  $links = am_links($title . "\n" . $text); $ext = [];
  foreach ($links as $l) {
    $d = $l['domain']; if ($d === $siteDom || in_array($d, $trusted, true)) continue;
    $ext[$d] = true;
    foreach ($blocked as $b) if ($b !== '' && ($d === am_domain($b) || str_ends_with($l['host'], strtolower($b)))) $add('blocked', "links to blocked site $d", 10, 'malicious_link');
    if (in_array($d, AM_SHORTENERS, true) || in_array($l['host'], AM_SHORTENERS, true)) $add('shortener', "uses a link shortener ($d)", 2, 'spam');
    if (str_contains($l['host'], 'xn--') || preg_match('/^\d{1,3}(\.\d{1,3}){3}$/', $l['host'])) $add('oddhost', "disguised link address ({$l['host']})", 3, 'phishing');
    foreach (am_operators() as $o) {
      if ($o['domain'] !== '' && $d === $o['domain']) continue;
      foreach ($o['tokens'] as $tok) if (str_contains($l['host'], $tok)) { $add('lookalike', "link imitates {$o['name']} ($d)", 4, 'phishing'); break 2; }
    }
    if ($siteDom !== '') { $tok = explode('.', $siteDom)[0]; if (strlen($tok) >= 6 && str_contains($l['host'], $tok)) $add('lookalike', "link imitates Pitchside ($d)", 4, 'phishing'); }
  }
  $nlinks = count($ext);
  if ($nlinks >= 8) $add('manylinks', "$nlinks different outside links", 3, 'spam'); elseif ($nlinks >= 4) $add('manylinks', "$nlinks different outside links", 2, 'spam');

  $phr = [
    ['seed', '/\b(send|share|enter|give|type|provide|submit|confirm|verify|need|paste|import)\b[^.!?]{0,40}\b((seed|recovery|secret|mnemonic|backup)\s*(phrase|words)|private\s*keys?)\b/', 'asks for a wallet seed phrase or private key', 4, 'phishing'],
    ['wallet', '/\b(verify|validate|sync|synchroni[sz]e|connect|rectify|unlock|link)\b\s+(your\s+)?(wallet|metamask|trust ?wallet)\b|\bwallet\s+(validation|synchroni[sz]ation|rectification|verification)\b/', 'asks people to "verify" or connect a wallet', 3, 'phishing'],
    ['double', '/\b(send|deposit|transfer)\b[^.!?]{0,40}\b(get|receive)\b[^.!?]{0,30}\b(back|double|2x|x2|twice)\b|\bdouble\s+your\s+(btc|bitcoin|crypto|usdt|eth|money|deposit)\b/', 'promises to double money sent', 4, 'scam'],
    ['giveaway', '/\b(giveaway|airdrop|free\s+(btc|usdt|eth|bitcoin|crypto))\b[^.!?]{0,80}\b(claim|send|deposit|connect|register|dm|message)\b/', 'giveaway or airdrop that asks for action', 2, 'scam'],
    ['guarantee', '/\bguarantee[sd]?\b[^.!?]{0,20}\b(profits?|returns?|wins?|winnings|income|payouts?)\b|\brisk[- ]?free\s+(profits?|returns?|bets?|income)\b|\b\d{1,4}\s?%\s*(daily|weekly|a day|per day|every day)\b/', 'promises guaranteed returns', 3, 'scam'],
    ['fixed', '/\bfixed\s+(match|matches|games?|odds)\b|\bsure\s+(odds|bets?|wins?)\b[^.!?]{0,20}(100\s?%|guaranteed)|\b100\s?%\s+(sure|guaranteed)\s+(odds|bets?|tips?|wins?)\b/', 'sells "fixed matches" or guaranteed tips', 3, 'scam'],
    ['recovery', '/\b(recover|retrieve|get back)\b\s+(your\s+)?(lost\s+|stolen\s+|scammed\s+)?(funds|crypto|bitcoin|money|btc|usdt)\b|\bfunds?\s+recovery\s+(expert|agent|service|specialist|company)\b|\b(hire|contact)\s+(a\s+)?(hacker|recovery expert)\b/', 'offers to "recover" lost or scammed money', 3, 'scam'],
    ['payment', '/\b(gift\s?cards?|steam\s?cards?|western\s+union|moneygram)\b/', 'asks for payment by gift card or money transfer', 2, 'scam'],
  ];
  foreach ($phr as [$code, $re, $label, $pts, $cat]) {
    if (preg_match($re, $t, $m, PREG_OFFSET_CAPTURE) && !am_negated($t, (int) $m[0][1])) $add($code, $label, $pts, $cat);
  }
  if (preg_match('~\b(t\.me/|wa\.me/|telegram\b|whats\s?app\b|signal\s+(me|number)\b|contact\s+me\s+(on|via|at)\b|dm\s+me\s+on\b)|\+\d[\d\s-]{8,}\d~', $t, $m, PREG_OFFSET_CAPTURE) && !am_negated($t, (int) $m[0][1]))
    $add('contact', 'pushes people to contact off the site (Telegram, WhatsApp, phone)', 2, 'spam');

  // The account
  $age = now_ms() - (int) ($u['joined'] ?? now_ms());
  if ($age < 3 * DAY_MS || (int) ($u['posts'] ?? 0) < 5) $add('new', 'new account', 1, 'context');

  // Behaviour
  if (!empty($ctx['post_id'])) {
    $since = now_ms() - 2 * 3600000;
    $recent = rows("SELECT id, topic_id, body FROM posts WHERE author = ? AND at > ? ORDER BY id DESC LIMIT 60", [$u['name'], $since]);
    if ($ext) {
      $topics = [];
      foreach ($recent as $p) foreach (am_links((string) $p['body']) as $l) if (isset($ext[$l['domain']])) $topics[(int) $p['topic_id']] = true;
      if (count($topics) >= 3) $add('masslink', 'posted the same outside link in ' . count($topics) . ' topics within 2 hours', 3, 'spam');
    }
    $burst = 0; foreach ($recent as $rp) if (am_links((string) $rp['body'])) $burst++;   // posts with links (recent = last 2 hours)
    $burst = $burst ? count(array_filter(rows("SELECT body FROM posts WHERE author = ? AND at > ? LIMIT 60", [$u['name'], now_ms() - 600000]), fn($rp) => (bool) am_links((string) $rp['body']))) : 0;
    if ($burst >= 8 && $ext) $add('burst', "$burst posts with links in 10 minutes", 2, 'spam');   // fast chat in match threads is normal; only link bursts count
    $norm = trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', mb_strtolower($text)) ?? '');
    if (mb_strlen($norm) >= 40) {
      $len = strlen($text); $lo = max(0, $len - 200); $hi = $len + 200; $who = [];
      foreach (rows("SELECT author, body FROM posts WHERE at > ? AND id <> ? AND LENGTH(body) BETWEEN $lo AND $hi ORDER BY id DESC LIMIT 300", [now_ms() - DAY_MS, (int) $ctx['post_id']]) as $p)
        if (trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', mb_strtolower((string) $p['body'])) ?? '') === $norm) $who[$p['author']] = true;
      unset($who[$u['name']]);
      if (count($who) >= 2) $add('crossacct', 'same text posted by ' . (count($who) + 1) . ' accounts in 24 hours', 3, 'spam');
    }
  }
  // Impersonation of staff or casino representatives
  $isRep = false; foreach (am_operators() as $o) if (in_array($u['name'], (array) $o['reps'], true)) $isRep = true;
  if (!$isRep && !is_staff($u)) {
    $nm = strtolower((string) $u['name']); $claims = (bool) preg_match('/\b(official|support team|customer support|representative|admin team|moderator team|staff)\b/', $t);
    $nameHit = (bool) preg_match('/(official|support|admin|staff|moderator|pitchside)/', $nm);
    foreach (am_operators() as $o) foreach ($o['tokens'] as $tok) if (str_contains($nm, $tok)) $nameHit = true;
    if ($nameHit && $claims) $add('impersonation', 'may be posing as staff or a casino representative', 3, 'impersonation');
  }
  $score = array_sum(array_column($sig, 'points'));
  return ['score' => $score, 'signals' => array_values($sig), 'links' => array_keys($ext)];
}

/* What the rules alone may do with a score */
function am_decide(array $s, array $ctx): array {
  $c = am_cfg(); $codes = array_column($s['signals'], 'code'); $score = (int) $s['score'];
  $real = array_values(array_diff($codes, ['new']));
  $linkOrScam = (bool) array_intersect($codes, ['blocked', 'lookalike', 'oddhost', 'seed', 'wallet', 'double', 'recovery']);
  $cat = 'spam';
  foreach ($s['signals'] as $x) if ($x['cat'] === 'malicious_link') { $cat = 'malicious_link'; break; }
  if ($cat === 'spam') foreach ($s['signals'] as $x) if (in_array($x['cat'], ['phishing', 'scam'], true)) { $cat = $x['cat']; break; }
  if ($cat === 'spam' && in_array('impersonation', $codes, true) && count($real) === 1) $cat = 'impersonation';
  if (in_array('blocked', $codes, true)) return ['action' => 'block', 'cat' => 'malicious_link'];
  // one warning sign on its own is never enough
  if (count($real) < 2) $score = min($score, (int) $c['flag_at']);   // can be sent to moderators, never acted on
  // reviews and complaints: criticism is protected; only links/phishing/scam wording can lead to removal
  if (!empty($ctx['protected']) && !$linkOrScam) $score = min($score, $c['flag_at']);
  if ($cat === 'impersonation') return ['action' => $score >= $c['flag_at'] ? 'flag' : 'none', 'cat' => $cat];
  if ($score >= $c['remove_at']) return ['action' => 'remove', 'cat' => $cat];
  if ($score >= $c['hide_at']) return ['action' => 'hide', 'cat' => $cat];
  if ($score >= $c['flag_at']) return ['action' => 'flag', 'cat' => $cat];
  return ['action' => 'none', 'cat' => $cat];
}

/* ---------- Log, alerts ---------- */
function am_log(array $row): int {
  $row += ['at' => now_ms(), 'user_id' => null, 'topic_id' => null, 'post_id' => null, 'msg_id' => null, 'board' => null, 'excerpt' => null, 'reason' => null, 'score' => 0, 'details' => null, 'serious' => 0];
  if (is_array($row['details'])) $row['details'] = jenc($row['details']);
  if ($row['excerpt'] !== null) $row['excerpt'] = mb_substr((string) $row['excerpt'], 0, 1500);
  $row['rule'] = mb_substr((string) $row['rule'], 0, 160);
  return (int) insert('automod_log', $row);
}
function am_admins(): array { return rows("SELECT name, email FROM users WHERE role = 'super_admin' AND status = 'active'"); }
function am_alert(string $text, string $go = '/admin/automod'): void {
  if (!am_cfg()['alerts']) return;
  foreach (rows("SELECT name FROM users WHERE role IN ('super_admin', 'admin') AND status = 'active'") as $a) notify($a['name'], 'moderator', 'AI moderator: ' . $text, $go, null);
  $p = jdec((string) meta_get('automod:alerts', '[]'), []); if (!is_array($p)) $p = [];
  $p[] = gmdate('j M H:i') . ' UTC: ' . $text; meta_set('automod:alerts', jenc(array_slice($p, -50)));
}
function am_flush_alerts(): void {
  $p = jdec((string) meta_get('automod:alerts', '[]'), []); if (!$p) return;
  if ((int) meta_get('automod:alerts:sent', '0') > now_ms() - 600000) return;   // at most one alert email every 10 minutes
  meta_set('automod:alerts', '[]'); meta_set('automod:alerts:sent', (string) now_ms());
  $body = "Pitchside's AI moderator flagged something serious:\n\n- " . implode("\n- ", $p) . "\n\nReview and reverse actions: " . site_url('/admin/automod') . "\n";
  foreach (am_admins() as $a) if (!empty($a['email'])) send_mail($a['email'], 'Pitchside AI moderator: serious incident' . (count($p) > 1 ? 's' : ''), $body);
}
function am_summary(): void {
  $mode = am_cfg()['summary']; if ($mode === 'off') return;
  $period = $mode === 'weekly' ? 7 * DAY_MS : DAY_MS;
  $last = (int) meta_get('automod:summary:at', '0');
  if ($last === 0) { meta_set('automod:summary:at', (string) now_ms()); return; }
  if ($last > now_ms() - $period) return;
  meta_set('automod:summary:at', (string) now_ms());
  $rows = rows("SELECT * FROM automod_log WHERE at > ? ORDER BY id", [$last]);
  $count = fn($a) => count(array_filter($rows, fn($r) => $r['action'] === $a));
  $lines = [
    'Blocked links: ' . $count('block'), 'Posts removed: ' . $count('remove'), 'Posts hidden for checking: ' . $count('hide'), 'Posts restored after checking: ' . $count('restore'),
    'Sent to moderators: ' . $count('flag'), 'Warnings: ' . $count('warn'), 'Temporary suspensions: ' . $count('suspend'), 'Ban recommendations waiting for you: ' . $count('recommend_ban'),
    'Reversed by an admin: ' . count(array_filter($rows, fn($r) => $r['reversed_at'])),
  ];
  $detail = array_map(fn($r) => '- ' . gmdate('j M H:i', (int) floor($r['at'] / 1000)) . " · {$r['action']} · {$r['user']} · {$r['rule']}", array_slice(array_filter($rows, fn($r) => $r['action'] !== 'restore'), -40));
  $label = $mode === 'weekly' ? 'weekly' : 'daily';
  $body = "Pitchside AI moderator, $label summary\n\n" . implode("\n", $lines) . "\n\n" . ($detail ? "Latest actions:\n" . implode("\n", $detail) : 'Nothing needed action.') .
    "\n\nSee everything, and reverse any decision: " . site_url('/admin/automod') . "\n";
  foreach (am_admins() as $a) if (!empty($a['email'])) send_mail($a['email'], "Pitchside AI moderator: $label summary", $body);
}

/* ---------- Actions ---------- */
function am_user(string $name): ?array { $u = row("SELECT * FROM users WHERE name = ?", [$name]); if ($u) $u['profile'] = jdec($u['profile'] ?? '{}', []); return $u ?: null; }
function am_report(string $queue, string $kind, array $target, ?string $board, string $reason): void {
  insert('reports', ['queue' => $queue, 'kind' => $kind, 'target' => jenc($target), 'board' => $board, 'reason' => mb_substr($reason, 0, 1000), 'by_user' => 'system', 'at' => now_ms(), 'status' => 'open', 'updated' => now_ms()]);
}
function am_cat_label(string $cat): string { return ['malicious_link' => 'malicious link', 'phishing' => 'phishing', 'scam' => 'scam', 'spam' => 'spam', 'impersonation' => 'impersonation', 'abuse' => 'abuse'][$cat] ?? $cat; }
// Hide (pending) or remove a post. The first post of a topic takes the topic with it.
function am_take_down(array $post, string $how, string $rule, string $reason, string $source, int $score, string $cat): int {
  $t = row("SELECT id, title, board, deleted FROM topics WHERE id = ?", [(int) $post['topic_id']]); if (!$t) return 0;
  $first = (int) val("SELECT MIN(id) FROM posts WHERE topic_id = ?", [(int) $t['id']]) === (int) $post['id'];
  $det = ['hidden_before' => (int) $post['hidden'], 'topic_deleted_before' => (int) $t['deleted'], 'whole_topic' => $first, 'cat' => $cat];
  q("UPDATE posts SET hidden = 1 WHERE id = ?", [(int) $post['id']]);
  if ($first) q("UPDATE topics SET deleted = 1, updated = ? WHERE id = ?", [now_ms(), (int) $t['id']]); else touch_topic((int) $t['id']);   // a spam topic's title goes too
  $u = am_user((string) $post['author']);
  $id = am_log(['user' => $post['author'], 'user_id' => $u['id'] ?? null, 'kind' => $first ? 'topic' : 'post', 'topic_id' => (int) $t['id'], 'post_id' => (int) $post['id'], 'board' => $t['board'],
    'excerpt' => ($first ? $t['title'] . "\n" : '') . $post['body'], 'rule' => $rule, 'reason' => $reason, 'source' => $source, 'score' => $score, 'action' => $how, 'details' => $det]);
  audit(AM_ACTOR, $how === 'remove' ? 'Removed post (automatic)' : 'Hid post for checking (automatic)', "post #{$post['id']} in topic #{$t['id']}", "$rule: $reason", 'visible', $how === 'remove' ? 'removed' : 'hidden');
  if ($how === 'remove') notify((string) $post['author'], 'moderator', "Our automated moderation removed your post in “{$t['title']}” as " . am_cat_label($cat) . ". If this is a mistake, appeal from your profile and an admin will check it.", "/members/{$post['author']}", null);
  else am_report($cat === 'spam' ? 'spam' : 'scam', 'post', ['topic' => (int) $t['id'], 'post' => (int) $post['id']], $t['board'], "AI moderator hid this for checking: $rule ($reason)");
  return $id;
}
// Warnings and temporary suspensions after a removal
function am_strike(string $name, string $cat, string $why): void {
  $c = am_cfg(); if (!$c['strikes']) return;
  $u = am_user($name); if (!$u || is_staff($u) || $u['status'] === 'banned' || $u['status'] === 'deleted') return;
  $n = (int) val("SELECT COUNT(*) FROM automod_log WHERE user = ? AND action IN ('remove', 'block') AND reversed_at IS NULL AND at > ?", [$name, now_ms() - 30 * DAY_MS]);
  $scam = in_array($cat, ['malicious_link', 'phishing', 'scam'], true);
  $days = 0; $warn = false;
  if ($scam && (int) $c['scam_suspend_days'] > 0) $days = min(7, max(1, (int) $c['scam_suspend_days']));
  elseif ($n <= 1) $warn = true;
  else $days = $n === 2 ? 1 : ($n === 3 ? 3 : 7);
  if ($warn) {
    q("UPDATE users SET warnings = warnings + 1, updated = ? WHERE id = ?", [now_ms(), $u['id']]);
    am_log(['user' => $name, 'user_id' => $u['id'], 'kind' => 'member', 'rule' => 'First removal in 30 days', 'reason' => "Warning after a post was removed as " . am_cat_label($cat) . ": $why", 'source' => 'rules', 'action' => 'warn', 'details' => ['warnings_before' => (int) $u['warnings']]]);
    audit(AM_ACTOR, 'Warning (automatic)', $name, $why, $u['warnings'] . ' warnings', ($u['warnings'] + 1) . ' warnings');
    notify($name, 'moderator', "You received a warning from automated moderation: your post looked like " . am_cat_label($cat) . ". Repeated removals lead to a suspension.", "/members/$name", null);
    return;
  }
  $until = now_ms() + $days * DAY_MS;
  if ($u['status'] === 'suspended' && (int) $u['suspended_until'] >= $until) return;   // already suspended for longer
  q("UPDATE users SET status = 'suspended', suspended_until = ?, updated = ? WHERE id = ? AND status IN ('active', 'suspended')", [$until, now_ms(), $u['id']]);
  $serious = $scam || $n >= 4;
  am_log(['user' => $name, 'user_id' => $u['id'], 'kind' => 'member', 'rule' => $scam ? 'Suspected ' . am_cat_label($cat) : "$n removals in 30 days", 'reason' => "Suspended for $days day" . ($days > 1 ? 's' : '') . ": $why",
    'source' => 'rules', 'action' => 'suspend', 'serious' => $serious ? 1 : 0, 'details' => ['status_before' => $u['status'], 'until_before' => $u['suspended_until'], 'until' => $until, 'days' => $days]]);
  audit(AM_ACTOR, 'Suspended user (automatic)', $name, "$why ($days days)", $u['status'], 'suspended');
  notify($name, 'moderator', "Your account is suspended for $days day" . ($days > 1 ? 's' : '') . " by automated moderation: " . am_cat_label($cat) . ". You can appeal from your profile and an admin will check it.", "/members/$name", null);
  if ($scam) { am_report('scam', 'user', ['user' => $name], null, "AI moderator suspended $name for $days days (suspected " . am_cat_label($cat) . "): $why. Please review. A permanent ban needs an admin.");
    am_alert("suspended $name for $days days, suspected " . am_cat_label($cat) . " ($why)."); }
  if ($n >= 4) {
    am_log(['user' => $name, 'user_id' => $u['id'], 'kind' => 'member', 'rule' => "$n removals in 30 days", 'reason' => 'Repeat offender. A permanent ban needs your approval.', 'source' => 'rules', 'action' => 'recommend_ban', 'serious' => 1]);
    am_report('reports', 'user', ['user' => $name], null, "AI moderator recommends a permanent ban for $name: $n posts removed in 30 days. Only an admin can ban.");
    am_alert("recommends a permanent ban for $name ($n removals in 30 days). Only you can approve a ban.");
  }
}

/* ---------- Checking a post ---------- */
function am_ctx_for_topic(int $topicId): array {
  $t = row("SELECT id, title, board FROM topics WHERE id = ?", [$topicId]); $b = $t ? board_doc((string) $t['board']) : null;
  $kind = $b['kind'] ?? null;
  return ['topic' => $t, 'board' => $b, 'protected' => $kind === 'review' || ($t['board'] ?? '') === 'complaint-talk', 'market' => ($b['cat'] ?? '') === 'market' || $kind === 'listing'];
}
function am_check_post(int $postId, string $via): void {
  $c = am_cfg(); if (!$c['enabled'] || !am_ready()) return;
  $p = row("SELECT * FROM posts WHERE id = ?", [$postId]); if (!$p || (int) $p['hidden']) return;
  $u = am_user((string) $p['author']); if (!$u || is_staff($u)) return;
  $ctx = am_ctx_for_topic((int) $p['topic_id']); if (!$ctx['topic']) return;
  $first = (int) val("SELECT MIN(id) FROM posts WHERE topic_id = ?", [(int) $p['topic_id']]) === (int) $p['id'];
  $s = am_signals($u, (string) $p['body'], $first ? (string) $ctx['topic']['title'] : '', ['post_id' => $postId] + $ctx);
  $d = am_decide($s, $ctx);
  $rule = implode('; ', array_map(fn($x) => $x['label'], array_filter($s['signals'], fn($x) => $x['code'] !== 'new'))) ?: 'warning signs';
  $why = 'Rule-based signals (score ' . $s['score'] . '): ' . implode(', ', array_column($s['signals'], 'label'));
  if ($d['action'] === 'remove' || $d['action'] === 'block') {
    am_take_down($p, 'remove', $rule, $why, 'rules', $s['score'], $d['cat']); am_strike((string) $p['author'], $d['cat'], $rule); return;
  }
  if ($d['action'] === 'hide') am_take_down($p, 'hide', $rule, $why, 'rules', $s['score'], $d['cat']);
  $wantAi = am_ai_ready() && ($c['ai_scope'] === 'all' || $s['score'] >= 1 || $s['links'] || $ctx['market'] || $d['action'] !== 'none');
  if ($wantAi) { am_queue('post', $postId, (string) $p['author'], $s); return; }
  if ($d['action'] === 'flag') {
    am_log(['user' => $p['author'], 'user_id' => $u['id'], 'kind' => $first ? 'topic' : 'post', 'topic_id' => (int) $p['topic_id'], 'post_id' => $postId, 'board' => $ctx['topic']['board'], 'excerpt' => $p['body'],
      'rule' => $rule, 'reason' => $why, 'source' => 'rules', 'score' => $s['score'], 'action' => 'flag', 'details' => ['cat' => $d['cat']]]);
    am_report($d['cat'] === 'spam' ? 'spam' : ($d['cat'] === 'impersonation' ? 'reports' : 'scam'), 'post', ['topic' => (int) $p['topic_id'], 'post' => $postId], $ctx['topic']['board'], "AI moderator: please check. $rule");
  }
}
function am_queue(string $kind, int $ref, string $user, array $s): void {
  if (val("SELECT 1 FROM automod_queue WHERE kind = ? AND ref = ? AND status = 'pending'", [$kind, $ref])) return;
  $GLOBALS['AM_QUEUED'][] = (int) insert('automod_queue', ['kind' => $kind, 'ref' => $ref, 'user' => $user, 'score' => (int) $s['score'], 'signals' => jenc($s['signals']), 'at' => now_ms(), 'tries' => 0, 'status' => 'pending']);
}

/* ---------- AI ---------- */
function am_ai_prompt(): string {
  return "You are the moderation assistant for Pitchside Forum, a sports, betting, casino-review and crypto community. Decide whether one piece of content breaks these rules:\n"
    . "- spam: advertising or promotion unrelated to the discussion, repeated promotional posts, link dropping, SEO spam, referral-code spam.\n"
    . "- scam: fake giveaways or airdrops, 'double your money', guaranteed profits, fixed matches, fund-recovery offers, advance-fee or upfront-payment tricks, fake marketplace listings.\n"
    . "- phishing: attempts to get passwords, seed phrases, private keys or logins; look-alike links of casinos, exchanges or Pitchside; fake 'verify your wallet/account'.\n"
    . "- malicious: links to malware or obviously harmful sites.\n"
    . "- impersonation: posing as Pitchside staff or a casino/sportsbook's official representative.\n"
    . "- abuse: threats, harassment, hate.\n"
    . "These are NOT violations and must be judged 'ok': criticism of casinos, sportsbooks or advertisers, however harsh; negative reviews; complaints about withdrawals or confiscated balances; warnings to others about an operator; ordinary crypto or betting discussion; tips and predictions without guarantees; members sharing an affiliate link they disclose; a new account by itself; strong opinions.\n"
    . "When unsure, answer 'uncertain'. Never decide who is right in a dispute between a player and a casino.\n"
    . "Reply with JSON only: {\"verdict\":\"ok|spam|scam|phishing|malicious|impersonation|abuse|uncertain\",\"confidence\":0.0-1.0,\"rule\":\"short rule name\",\"reason\":\"one sentence a moderator can read\"}";
}
function am_http(string $url, array $headers, array $body): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body), CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
    CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 30, CURLOPT_FOLLOWLOCATION => false]);
  $res = curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  return [$code, is_string($res) ? $res : '', $err];
}
function am_ai_call(string $content): array {
  $c = am_cfg(); $key = am_key(); if ($key === '') return ['error' => 'No AI key added yet.'];
  $day = 'automod:ai:' . gmdate('Ymd'); $used = (int) meta_get($day, '0');
  if ($used >= (int) $c['ai_daily_cap']) return ['error' => 'Daily AI check limit reached.'];
  meta_set($day, (string) ($used + 1));
  if ($c['provider'] === 'openai') {
    $base = rtrim(trim((string) $c['base_url']) ?: 'https://api.openai.com/v1', '/');
    if (!str_starts_with($base, 'https://') && !preg_match('~^http://(127\.0\.0\.1|localhost)[:/]~', $base)) return ['error' => 'The AI service address must start with https://'];
    [$code, $res, $err] = am_http("$base/chat/completions", ["Authorization: Bearer $key"], ['model' => $c['model'], 'temperature' => 0, 'max_tokens' => 300,
      'messages' => [['role' => 'system', 'content' => am_ai_prompt()], ['role' => 'user', 'content' => $content]]]);
    $j = json_decode($res, true); $text = $j['choices'][0]['message']['content'] ?? '';
  } else {
    [$code, $res, $err] = am_http('https://api.anthropic.com/v1/messages', ["x-api-key: $key", 'anthropic-version: 2023-06-01'],
      ['model' => trim((string) $c['model']) ?: 'claude-haiku-4-5-20251001', 'max_tokens' => 300, 'system' => am_ai_prompt(), 'messages' => [['role' => 'user', 'content' => $content]]]);
    $j = json_decode($res, true); $text = '';
    foreach (($j['content'] ?? []) as $part) if (($part['type'] ?? '') === 'text') $text .= $part['text'];
  }
  if ($code !== 200) return ['error' => 'The AI service said: ' . mb_substr((string) ($j['error']['message'] ?? $err ?: "HTTP $code"), 0, 200)];
  if (!preg_match('/\{[\s\S]*\}/', (string) $text, $m)) return ['error' => 'The AI reply could not be read.'];
  $v = json_decode($m[0], true); if (!is_array($v) || empty($v['verdict'])) return ['error' => 'The AI reply could not be read.'];
  $verdict = strtolower((string) $v['verdict']);
  if (!in_array($verdict, ['ok', 'spam', 'scam', 'phishing', 'malicious', 'impersonation', 'abuse', 'uncertain'], true)) $verdict = 'uncertain';
  return ['verdict' => $verdict, 'confidence' => max(0.0, min(1.0, (float) ($v['confidence'] ?? 0))), 'rule' => mb_substr((string) ($v['rule'] ?? $verdict), 0, 80), 'reason' => mb_substr((string) ($v['reason'] ?? ''), 0, 400)];
}
function am_ai_content(array $u, string $where, string $title, string $text, array $signals): string {
  $age = (int) floor((now_ms() - (int) ($u['joined'] ?? now_ms())) / DAY_MS);
  return "Where: $where\nAuthor: account $age days old, " . (int) ($u['posts'] ?? 0) . " posts, role " . ($u['role'] ?? 'member') . "\n"
    . 'Automatic signals found: ' . ($signals ? implode('; ', array_column($signals, 'label')) : 'none') . "\n"
    . ($title !== '' ? "Title: $title\n" : '') . "Content:\n<<<\n" . mb_substr($text, 0, 4000) . "\n>>>";
}
function am_process(array $item): void {
  $c = am_cfg(); $signals = jdec((string) $item['signals'], []); $score = (int) $item['score'];
  $done = function (string $st) use ($item) { q("UPDATE automod_queue SET status = ?, tries = tries + 1 WHERE id = ?", [$st, $item['id']]); };
  if ($item['kind'] === 'post') {
    $p = row("SELECT * FROM posts WHERE id = ?", [(int) $item['ref']]); if (!$p) { $done('gone'); return; }
    $u = am_user((string) $p['author']); if (!$u) { $done('gone'); return; }
    $ctx = am_ctx_for_topic((int) $p['topic_id']); if (!$ctx['topic']) { $done('gone'); return; }
    $first = (int) val("SELECT MIN(id) FROM posts WHERE topic_id = ?", [(int) $p['topic_id']]) === (int) $p['id'];
    $where = ($ctx['board']['name'] ?? $ctx['topic']['board']) . ($ctx['protected'] ? ' (reviews/complaints board: criticism of operators is allowed)' : '') . ($ctx['market'] ? ' (marketplace)' : '');
    $r = am_ai_call(am_ai_content($u, $where, $first ? (string) $ctx['topic']['title'] : '', (string) $p['body'], $signals));
    if (isset($r['error'])) { if ((int) $item['tries'] >= 2) { $done('failed'); am_rules_fallback($p, $u, $ctx, $signals, $score, $first); } else q("UPDATE automod_queue SET tries = tries + 1 WHERE id = ?", [$item['id']]); return; }
    $done('done');
    $hiddenByUs = (int) $p['hidden'] === 1 ? (int) (val("SELECT id FROM automod_log WHERE post_id = ? AND action = 'hide' AND reversed_at IS NULL ORDER BY id DESC LIMIT 1", [(int) $p['id']]) ?? 0) : 0;
    $bad = in_array($r['verdict'], ['spam', 'scam', 'phishing', 'malicious'], true);
    $cat = $r['verdict'] === 'malicious' ? 'malicious_link' : $r['verdict'];
    $codes = array_column($signals, 'code');
    $linkOrScam = (bool) array_intersect($codes, ['blocked', 'lookalike', 'oddhost', 'seed', 'wallet', 'double', 'recovery']) || in_array($r['verdict'], ['phishing', 'malicious'], true);
    $why = "AI ({$r['verdict']}, " . round($r['confidence'] * 100) . "% sure): {$r['reason']}";
    $logBase = ['user' => $p['author'], 'user_id' => $u['id'], 'kind' => $first ? 'topic' : 'post', 'topic_id' => (int) $p['topic_id'], 'post_id' => (int) $p['id'], 'board' => $ctx['topic']['board'], 'excerpt' => ($first ? $ctx['topic']['title'] . "\n" : '') . $p['body'], 'source' => 'ai', 'score' => $score];
    $allowed = !$ctx['protected'] || $linkOrScam;   // criticism on review/complaint boards is never removed
    if ($bad && $allowed && $r['confidence'] >= (float) $c['ai_remove_conf']) {
      if ($hiddenByUs) {   // it was hidden for checking: now confirmed
        q("UPDATE automod_log SET action = 'remove', reason = ?, source = 'ai' WHERE id = ?", [$why, $hiddenByUs]);
        if ($first) q("UPDATE topics SET deleted = 1, updated = ? WHERE id = ?", [now_ms(), (int) $p['topic_id']]);
        notify((string) $p['author'], 'moderator', "Our automated moderation removed your post in “{$ctx['topic']['title']}” as " . am_cat_label($cat) . ". If this is a mistake, appeal from your profile.", "/members/{$p['author']}", null);
      } else am_take_down($p, 'remove', $r['rule'], $why, 'ai', $score, $cat);
      am_strike((string) $p['author'], $cat, $r['rule']);
    } elseif ($bad && $allowed && $r['confidence'] >= (float) $c['ai_hide_conf']) {
      if (!$hiddenByUs) am_take_down($p, 'hide', $r['rule'], $why, 'ai', $score, $cat);   // hidden until a moderator looks
    } elseif ($bad || in_array($r['verdict'], ['impersonation', 'abuse', 'uncertain'], true)) {
      if (!$hiddenByUs) {
        am_log($logBase + ['rule' => $r['rule'], 'reason' => $why, 'action' => 'flag', 'details' => ['cat' => $cat]]);
        am_report($r['verdict'] === 'spam' ? 'spam' : ($r['verdict'] === 'abuse' ? 'abuse' : ($r['verdict'] === 'impersonation' || $r['verdict'] === 'uncertain' ? 'reports' : 'scam')), 'post',
          ['topic' => (int) $p['topic_id'], 'post' => (int) $p['id']], $ctx['topic']['board'], "AI moderator: please check. $why");
      }
      if ($r['verdict'] === 'impersonation') am_alert("possible impersonation of staff or a casino representative by {$p['author']}: {$r['reason']}", '/topic/' . (int) $p['topic_id']);
    } elseif ($r['verdict'] === 'ok' && $hiddenByUs) {   // hidden for checking, AI found nothing: put it back
      $hd = jdec((string) val("SELECT details FROM automod_log WHERE id = ?", [$hiddenByUs]), []);
      q("UPDATE posts SET hidden = 0 WHERE id = ?", [(int) $p['id']]);
      if (!empty($hd['whole_topic']) && empty($hd['topic_deleted_before'])) q("UPDATE topics SET deleted = 0 WHERE id = ?", [(int) $p['topic_id']]);
      touch_topic((int) $p['topic_id']);
      q("UPDATE automod_log SET reversed_at = ?, reversed_by = 'AI moderator', reverse_note = ? WHERE id = ?", [now_ms(), "AI check found nothing wrong: {$r['reason']}", $hiddenByUs]);
      am_log($logBase + ['rule' => 'Cleared by AI check', 'reason' => $why, 'action' => 'restore']);
    }
    return;
  }
  if ($item['kind'] === 'message') {
    $m = row("SELECT * FROM msgs WHERE id = ?", [(int) $item['ref']]); if (!$m) { $done('gone'); return; }
    $u = am_user((string) $m['from_user']); if (!$u || is_staff($u)) { $done('done'); return; }
    $r = am_ai_ready() ? am_ai_call(am_ai_content($u, 'a private message that the recipient reported', '', (string) $m['body'], $signals)) : ['error' => 'no ai'];
    if (isset($r['error']) && am_ai_ready() && (int) $item['tries'] < 2) { q("UPDATE automod_queue SET tries = tries + 1 WHERE id = ?", [$item['id']]); return; }
    $done(isset($r['error']) ? 'failed' : 'done');
    $bad = !isset($r['error']) && in_array($r['verdict'], ['scam', 'phishing', 'malicious'], true) && $r['confidence'] >= (float) $c['ai_remove_conf'];
    $rulesBad = $score >= (int) $c['remove_at'] && (bool) array_intersect(array_column($signals, 'code'), ['blocked', 'lookalike', 'oddhost', 'seed', 'wallet', 'double', 'recovery']);
    $why = isset($r['error']) ? 'Rule-based signals: ' . implode(', ', array_column($signals, 'label')) : "AI ({$r['verdict']}, " . round($r['confidence'] * 100) . "% sure): {$r['reason']}";
    $cat = isset($r['error']) ? 'scam' : ($r['verdict'] === 'malicious' ? 'malicious_link' : $r['verdict']);
    am_log(['user' => $m['from_user'], 'user_id' => $u['id'], 'kind' => 'message', 'msg_id' => (int) $m['id'], 'excerpt' => $m['body'], 'rule' => isset($r['error']) ? 'Reported message' : $r['rule'],
      'reason' => $why, 'source' => isset($r['error']) ? 'rules' : 'ai', 'score' => $score, 'action' => ($bad || $rulesBad) ? 'flag' : 'reviewed', 'serious' => ($bad || $rulesBad) ? 1 : 0, 'details' => ['cat' => $cat]]);
    if ($bad || $rulesBad) am_strike((string) $m['from_user'], in_array($cat, ['phishing', 'malicious_link'], true) ? $cat : 'scam', 'scam private message (reported by the recipient)');
  }
}
// If the AI can't be reached, fall back to what the rules alone allow
function am_rules_fallback(array $p, array $u, array $ctx, array $signals, int $score, bool $first): void {
  $d = am_decide(['score' => $score, 'signals' => $signals], $ctx);
  if ($d['action'] === 'flag' || $d['action'] === 'hide') {
    if (!val("SELECT 1 FROM automod_log WHERE post_id = ? AND reversed_at IS NULL", [(int) $p['id']])) {
      am_log(['user' => $p['author'], 'user_id' => $u['id'], 'kind' => $first ? 'topic' : 'post', 'topic_id' => (int) $p['topic_id'], 'post_id' => (int) $p['id'], 'board' => $ctx['topic']['board'], 'excerpt' => $p['body'],
        'rule' => 'warning signs', 'reason' => 'AI check unavailable; rule-based signals: ' . implode(', ', array_column($signals, 'label')), 'source' => 'rules', 'score' => $score, 'action' => 'flag']);
      am_report('spam', 'post', ['topic' => (int) $p['topic_id'], 'post' => (int) $p['id']], $ctx['topic']['board'], 'AI moderator: please check (AI check unavailable).');
    }
  }
}
function am_run_queue(int $max, float $seconds, ?array $only = null): void {
  if (!am_ready()) return;
  $start = microtime(true);
  $items = $only ? rows("SELECT * FROM automod_queue WHERE status = 'pending' AND id IN (" . implode(',', array_map('intval', $only)) . ") ORDER BY id")
                 : rows("SELECT * FROM automod_queue WHERE status = 'pending' ORDER BY id LIMIT $max");
  foreach ($items as $it) {
    if (microtime(true) - $start > $seconds) break;
    try { am_process($it); } catch (Throwable $e) { error_log('[automod] ' . $e->getMessage()); q("UPDATE automod_queue SET tries = tries + 1, status = CASE WHEN tries >= 2 THEN 'failed' ELSE status END WHERE id = ?", [$it['id']]); }
  }
}

/* ---------- Reversing ---------- */
function am_reverse(int $id, array $admin, string $note): void {
  $l = row("SELECT * FROM automod_log WHERE id = ?", [$id]); if (!$l) fail('That entry no longer exists.');
  if ($l['reversed_at']) fail('That was already reversed.');
  $d = jdec((string) $l['details'], []);
  if (in_array($l['action'], ['remove', 'hide'], true) && $l['post_id']) {
    if (empty($d['hidden_before'])) q("UPDATE posts SET hidden = 0 WHERE id = ?", [(int) $l['post_id']]);
    if (!empty($d['whole_topic']) && empty($d['topic_deleted_before'])) q("UPDATE topics SET deleted = 0, updated = ? WHERE id = ?", [now_ms(), (int) $l['topic_id']]);
    if ($l['topic_id']) touch_topic((int) $l['topic_id']);
    notify((string) $l['user'], 'moderator', 'An admin reviewed the automated decision and restored your post.', $l['topic_id'] ? "/topic/{$l['topic_id']}" : "/members/{$l['user']}", null);
  } elseif ($l['action'] === 'warn') {
    q("UPDATE users SET warnings = CASE WHEN warnings > 0 THEN warnings - 1 ELSE 0 END, updated = ? WHERE name = ?", [now_ms(), $l['user']]);
    notify((string) $l['user'], 'moderator', 'An admin reviewed and removed the automated warning on your account.', "/members/{$l['user']}", null);
  } elseif ($l['action'] === 'suspend') {
    $u = am_user((string) $l['user']);
    if ($u && $u['status'] === 'suspended' && (int) $u['suspended_until'] === (int) ($d['until'] ?? -1)) {
      q("UPDATE users SET status = 'active', suspended_until = NULL, updated = ? WHERE id = ?", [now_ms(), $u['id']]);
      notify((string) $l['user'], 'moderator', 'An admin reviewed the automated suspension and lifted it. Your account is active again.', "/members/{$l['user']}", null);
    }
  }
  q("UPDATE automod_log SET reversed_at = ?, reversed_by = ?, reverse_note = ? WHERE id = ?", [now_ms(), $admin['name'], mb_substr($note, 0, 500), $id]);
  audit($admin, 'Reversed AI moderator decision', "automod #$id ({$l['action']} · {$l['user']})", $note ?: 'Reversed from Admin → AI moderation', $l['action'], 'reversed');
}

/* ---------- Hooks into posting ---------- */
function am_after_request(): void {
  static $on = false; if ($on) return; $on = true;
  register_shutdown_function(function () {
    $ids = $GLOBALS['AM_QUEUED'] ?? [];
    try {
      if ($ids || am_cfg()['alerts']) { if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request(); }
      if ($ids) am_run_queue(10, 25.0, $ids);
      am_flush_alerts();
    } catch (Throwable $e) { error_log('[automod] ' . $e->getMessage()); }
  });
}
(function () {
  if (!isset($GLOBALS['OPS'])) return;
  $ops = &$GLOBALS['OPS'];
  $wrapNew = function (string $name) use (&$ops) {
    if (!isset($ops[$name])) return;
    [$base, $need] = $ops[$name];
    $ops[$name] = [function (array $in, array $u) use ($base, $name) {
      $c = am_cfg();
      if ($c['enabled'] && !is_staff($u) && am_ready()) {
        // blocked links are refused before anything is posted
        $text = (string) ($in['body'] ?? '') . "\n" . (string) ($in['title'] ?? '') . "\n" . (string) ($in['desc'] ?? $in['description'] ?? '');
        $s = am_signals($u, $text, '', []);
        if (in_array('blocked', array_column($s['signals'], 'code'), true)) {
          $lab = array_values(array_filter($s['signals'], fn($x) => $x['code'] === 'blocked'))[0]['label'];
          am_log(['user' => $u['name'], 'user_id' => $u['id'], 'kind' => $name === 'post.reply' ? 'post' : 'topic', 'topic_id' => (int) ($in['topic'] ?? 0) ?: null, 'board' => (string) ($in['board'] ?? '') ?: null,
            'excerpt' => trim(((string) ($in['title'] ?? '')) . "\n" . (string) ($in['body'] ?? '')), 'rule' => 'Blocked link', 'reason' => ucfirst($lab), 'source' => 'rules', 'score' => $s['score'], 'action' => 'block']);
          am_strike($u['name'], 'malicious_link', $lab);
          am_after_request();
          fail("That post links to a site that's blocked on Pitchside to protect members. Remove the link and try again.");
        }
      }
      $max = (int) val("SELECT COALESCE(MAX(id), 0) FROM posts");
      $res = $base($in, $u);
      try {
        if ($c['enabled'] && !is_staff($u) && am_ready()) {
          foreach (rows("SELECT id FROM posts WHERE id > ? AND author = ? ORDER BY id LIMIT 3", [$max, $u['name']]) as $p) am_check_post((int) $p['id'], $name);
          am_after_request();
        }
      } catch (Throwable $e) { error_log('[automod] ' . $e->getMessage()); }
      return $res;
    }, $need];
  };
  foreach (['topic.create', 'post.reply', 'listing.create', 'listing.save', 'listing.edit'] as $n) $wrapNew($n);

  if (isset($ops['post.edit'])) {
    [$base, $need] = $ops['post.edit'];
    $ops['post.edit'] = [function (array $in, array $u) use ($base) {
      $res = $base($in, $u);
      try { if (am_cfg()['enabled'] && !is_staff($u) && am_ready() && ($pid = (int) ($in['post'] ?? 0))) {
        $p = row("SELECT author FROM posts WHERE id = ?", [$pid]);
        if ($p && $p['author'] === $u['name']) { am_check_post($pid, 'post.edit'); am_after_request(); }
      } } catch (Throwable $e) { error_log('[automod] ' . $e->getMessage()); }
      return $res;
    }, $need];
  }
  // Private messages are looked at only when a member reports one
  if (isset($ops['report.create'])) {
    [$base, $need] = $ops['report.create'];
    $ops['report.create'] = [function (array $in, array $u) use ($base) {
      $res = $base($in, $u);
      try {
        if (($in['kind'] ?? '') === 'message' && am_cfg()['enabled'] && am_ready() && ($mid = (int) ($in['msg'] ?? 0))) {
          $m = row("SELECT id, from_user, body FROM msgs WHERE id = ? AND reported = 1", [$mid]);
          $from = $m ? am_user((string) $m['from_user']) : null;
          if ($m && $from && !is_staff($from) && !val("SELECT 1 FROM automod_log WHERE msg_id = ?", [$mid])) {
            $s = am_signals($from, (string) $m['body'], '', []);
            am_queue('message', $mid, (string) $m['from_user'], $s);
            am_after_request();
          }
        }
      } catch (Throwable $e) { error_log('[automod] ' . $e->getMessage()); }
      return $res;
    }, $need];
  }
})();

/* ---------- Background (cron every 5 minutes): leftover checks, alerts, summaries ---------- */
if (PHP_SAPI === 'cli' && basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'cron.php') {
  register_shutdown_function(function () {
    try {
      if (!am_ready()) return;
      am_run_queue(25, 120.0);
      am_flush_alerts(); am_summary();
      q("DELETE FROM automod_queue WHERE status <> 'pending' AND at < ?", [now_ms() - 30 * DAY_MS]);
      q("DELETE FROM automod_log WHERE at < ?", [now_ms() - 365 * DAY_MS]);
    } catch (Throwable $e) { error_log('[automod cron] ' . $e->getMessage()); }
  });
}

/* ---------- Admin → AI moderation ---------- */
function am_need_admin(array $u): void { if (!is_admin($u)) fail('Only admins can manage the AI moderator.', 403); }
op('automod.get', function (array $in, array $u) {
  am_need_admin($u); if (!am_ready()) fail('The AI moderator tables are missing. Run the installer again.');
  $c = am_cfg(); $key = am_key();
  $f = str_in($in, 'f', 16); $page = max(0, int_in($in, 'page'));
  $where = ['1 = 1']; $args = [];
  if ($f === 'removed') $where[] = "action IN ('remove', 'block')";
  elseif ($f === 'hidden') $where[] = "action = 'hide'";
  elseif ($f === 'flagged') $where[] = "action IN ('flag', 'recommend_ban')";
  elseif ($f === 'members') $where[] = "action IN ('warn', 'suspend', 'recommend_ban')";
  elseif ($f === 'reversed') $where[] = "reversed_at IS NOT NULL";
  elseif ($f === 'serious') $where[] = "serious = 1";
  $user = str_in($in, 'user', 40); if ($user !== '') { $where[] = 'user = ?'; $args[] = $user; }
  $w = implode(' AND ', $where);
  $total = (int) val("SELECT COUNT(*) FROM automod_log WHERE $w", $args);
  $log = rows("SELECT * FROM automod_log WHERE $w ORDER BY id DESC LIMIT 50 OFFSET " . ($page * 50), $args);
  $since = now_ms() - DAY_MS; $stats = [];
  foreach (rows("SELECT action, COUNT(*) n FROM automod_log WHERE at > ? GROUP BY action", [$since]) as $r) $stats[$r['action']] = (int) $r['n'];
  return ['cfg' => $c, 'key' => ['set' => $key !== '', 'end' => $key !== '' ? substr($key, -4) : '', 'fromConfig' => (string) (meta_get('automod:key', '') ?? '') === '' && $key !== ''],
    'aiReady' => am_ai_ready(), 'aiToday' => (int) meta_get('automod:ai:' . gmdate('Ymd'), '0'), 'queue' => (int) val("SELECT COUNT(*) FROM automod_queue WHERE status = 'pending'"),
    'stats' => $stats, 'total' => $total, 'page' => $page, 'canKey' => $u['role'] === 'super_admin',
    'log' => array_map(fn($r) => ['id' => (int) $r['id'], 'at' => (int) $r['at'], 'user' => $r['user'], 'userId' => $r['user_id'] !== null ? (int) $r['user_id'] : null, 'kind' => $r['kind'],
      'topic' => $r['topic_id'] !== null ? (int) $r['topic_id'] : null, 'post' => $r['post_id'] !== null ? (int) $r['post_id'] : null, 'msg' => $r['msg_id'] !== null ? (int) $r['msg_id'] : null, 'board' => $r['board'],
      'excerpt' => mb_substr((string) $r['excerpt'], 0, 600), 'rule' => $r['rule'], 'reason' => $r['reason'], 'source' => $r['source'], 'score' => (int) $r['score'], 'action' => $r['action'], 'serious' => (int) $r['serious'],
      'reversedAt' => $r['reversed_at'] !== null ? (int) $r['reversed_at'] : null, 'reversedBy' => $r['reversed_by'], 'reverseNote' => $r['reverse_note']], $log)];
});
op('automod.reverse', function (array $in, array $u) {
  am_need_admin($u); am_reverse(int_in($in, 'id'), $u, str_in($in, 'note', 500)); return [];
});
op('automod.save', function (array $in, array $u) {
  am_need_admin($u); $c = am_cfg(true); $old = $c;
  $num = fn($k, $lo, $hi) => isset($in[$k]) && is_numeric($in[$k]) ? max($lo, min($hi, $in[$k] + 0)) : $c[$k];
  foreach (['enabled', 'ai', 'strikes', 'alerts'] as $k) if (isset($in[$k])) $c[$k] = (bool) $in[$k];
  $c['remove_at'] = (int) $num('remove_at', 3, 30); $c['hide_at'] = (int) $num('hide_at', 2, 30); $c['flag_at'] = (int) $num('flag_at', 1, 30);
  if ($c['hide_at'] > $c['remove_at']) $c['hide_at'] = $c['remove_at']; if ($c['flag_at'] > $c['hide_at']) $c['flag_at'] = $c['hide_at'];
  $c['ai_remove_conf'] = round((float) $num('ai_remove_conf', 0.5, 1), 2); $c['ai_hide_conf'] = round((float) $num('ai_hide_conf', 0.3, 1), 2);
  $c['scam_suspend_days'] = (int) $num('scam_suspend_days', 0, 7); $c['ai_daily_cap'] = (int) $num('ai_daily_cap', 0, 20000);
  if (isset($in['ai_scope']) && in_array($in['ai_scope'], ['risky', 'all'], true)) $c['ai_scope'] = $in['ai_scope'];
  if (isset($in['summary']) && in_array($in['summary'], ['daily', 'weekly', 'off'], true)) $c['summary'] = $in['summary'];
  $dom = function ($v) { $out = []; foreach (is_array($v) ? $v : preg_split('/[\s,]+/', (string) $v) as $d) { $d = strtolower(trim((string) $d)); $d = preg_replace('~^https?://~', '', $d) ?? $d; $d = explode('/', $d)[0];
    if (preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $d)) $out[] = preg_replace('/^www\./', '', $d); } return array_values(array_unique(array_slice($out, 0, 2000))); };
  if (isset($in['blocked_domains'])) $c['blocked_domains'] = $dom($in['blocked_domains']);
  if (isset($in['trusted_domains'])) $c['trusted_domains'] = $dom($in['trusted_domains']);
  if (isset($in['provider']) || isset($in['model']) || isset($in['base_url']) || array_key_exists('key', $in)) {
    if ($u['role'] !== 'super_admin') fail('Only a Super Admin can change the AI service or key.', 403);
    if (isset($in['provider']) && in_array($in['provider'], ['anthropic', 'openai'], true)) $c['provider'] = $in['provider'];
    if (isset($in['model'])) $c['model'] = mb_substr(trim((string) $in['model']), 0, 120);
    if (isset($in['base_url'])) { $b = trim((string) $in['base_url']); if ($b !== '' && !str_starts_with($b, 'https://') && !preg_match('~^http://(127\.0\.0\.1|localhost)[:/]~', $b)) fail('The AI service address must start with https://'); $c['base_url'] = mb_substr($b, 0, 200); }
    if (array_key_exists('key', $in) && is_string($in['key'])) { $k = trim($in['key']); if ($k === '' || strlen($k) >= 20) meta_set('automod:key', $k); else fail("That doesn't look like a complete key."); }
  }
  meta_set('automod:config', jenc($c)); am_cfg(true);
  $changed = []; foreach ($c as $k => $v) if (jenc($old[$k] ?? null) !== jenc($v)) $changed[] = $k;
  audit($u, 'AI moderator settings', 'automod', 'Changed: ' . (implode(', ', $changed) ?: 'nothing') . (array_key_exists('key', $in) ? ' (AI key updated)' : ''), '', '');
  return [];
});
op('automod.test', function (array $in, array $u) {
  am_need_admin($u);
  $text = str_in($in, 'text', 6000); if (trim($text) === '') fail('Paste some text to test.');
  $fake = ['name' => '__test__', 'joined' => !empty($in['newAccount']) ? now_ms() : now_ms() - 400 * DAY_MS, 'posts' => !empty($in['newAccount']) ? 0 : 300, 'role' => 'member', 'status' => 'active'];
  $ctx = ['protected' => !empty($in['review']), 'market' => !empty($in['market'])];
  $s = am_signals($fake, $text, '', []); $d = am_decide($s, $ctx);
  $out = ['score' => $s['score'], 'signals' => $s['signals'], 'decision' => $d];
  if (!empty($in['ai'])) {
    if (!am_ai_ready()) $out['ai'] = ['error' => 'Add an AI key first.'];
    else $out['ai'] = am_ai_call(am_ai_content($fake, ($ctx['protected'] ? 'reviews board' : ($ctx['market'] ? 'marketplace' : 'forum')) . ' (admin test)', '', $text, $s['signals']));
  }
  return $out;
});
