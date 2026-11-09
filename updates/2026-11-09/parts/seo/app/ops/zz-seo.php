<?php
// Pitchside Forum: search engine boost, with reviews first.
// - Review threads get their own search title ("Stakeline review: 'Paid in 2 hours' – 5/5 stars"), and rating data
//   (schema.org Review) so search engines can show stars.
// - Every forum thread gets DiscussionForumPosting data (what Google reads for forum results) and breadcrumbs.
// - The casino / sportsbook card pages and the complaints page get a readable list for search engines.
// - Team and league pages get real content: about the club, latest topics, the other clubs in the league.
// - Link previews (WhatsApp, X, Facebook…) get a picture made for each page: the title, the star rating for reviews,
//   in the site's colours. Drawn on the server the first time it's needed, then kept (app/storage/cache/share).
// - New topics, reviews and complaints are reported to Bing and Yandex straight away (IndexNow).
// Called from public/index.php through one added line. Remove this file and the pages work as before.
declare(strict_types=1);

const SEO_SITE = 'Pitchside Forum';

function seo_head(string $html): void { $GLOBALS['PS_EXTRA_HEAD'] = ($GLOBALS['PS_EXTRA_HEAD'] ?? '') . $html; }
function seo_ld(array $data): void { seo_head('<script type="application/ld+json">' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . "</script>\n"); }
function seo_iso(int $ms): string { return gmdate('c', intdiv($ms, 1000)); }
function seo_text(string $s, int $n): string {
  $s = preg_replace('/\[quote=[^\]]*\][\s\S]*?\[\/quote\]/', '', $s) ?? $s;
  $s = preg_replace('/\[(\/)?(spoiler|b|i|u|s)[^\]]*\]|\*\*|__|~~|^#+\s*/m', '', $s) ?? $s;
  return mb_strimwidth(trim(preg_replace('/\s+/', ' ', $s) ?? $s), 0, $n, '…');
}
function seo_crumbs(array $items): void {
  $list = []; $i = 1;
  foreach ($items as [$name, $path]) $list[] = ['@type' => 'ListItem', 'position' => $i++, 'name' => $name] + ($path !== null ? ['item' => site_url($path)] : []);
  seo_ld(['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $list]);
}
function seo_op_path(array $d, string $slug): string { return (($d['type'] ?? '') === 'casino' ? '/casinos/' : '/sportsbooks/') . $slug; }
function seo_stars(float $x): string { return rtrim(rtrim(number_format($x, 1), '0'), '.'); }

function seo_extend(array $seg, string $path, string $title, string $desc, string $body, int $status, callable $h): array {
  try {
    $type = 'website';
    if ($status === 200) {
      $s0 = $seg[0] ?? '';
      if ($s0 === 'topic' && isset($seg[1])) { [$title, $desc, $body] = seo_topic((int) $seg[1], $title, $desc, $body, $h); $type = 'article'; }
      elseif ($s0 === 'forum' && isset($seg[1])) [$title, $desc] = seo_board((string) $seg[1], $title, $desc);
      elseif (in_array($s0, ['casinos', 'sportsbooks'], true) && !isset($seg[1]) && feature_on('casinos')) [$title, $desc, $body] = seo_hub($s0, $title, $desc, $body, $h);
      elseif (in_array($s0, ['casinos', 'sportsbooks'], true) && isset($seg[1])) seo_crumbs([['Home', '/'], [$s0 === 'casinos' ? 'Casinos' : 'Sportsbooks', "/$s0"], [(string) (jdec((string) val("SELECT data FROM operators WHERE slug = ?", [$seg[1]]), [])['name'] ?? $seg[1]), null]]);
      elseif ($s0 === 'complaints' && !isset($seg[1]) && feature_on('complaints')) [$title, $desc, $body] = seo_complaints($title, $desc, $body, $h);
      elseif (in_array($s0, ['teams', 'leagues'], true) && isset($seg[1])) [$title, $desc, $body] = seo_club($s0, (string) $seg[1], $title, $desc, $body, $h);
      elseif ($path === '/') seo_ld(['@context' => 'https://schema.org', '@type' => 'WebSite', 'name' => SEO_SITE, 'url' => site_url('/'),
        'potentialAction' => ['@type' => 'SearchAction', 'target' => site_url('/search?q={search_term_string}'), 'query-input' => 'required name=search_term_string']]);
    }
    $share = seo_share_path($seg, $path, $status);
    $big = $share !== null;
    $img = $big ? site_url($share) : site_url('/assets/share.1.png');
    seo_head('<meta property="og:type" content="' . $type . '"><meta property="og:image" content="' . $h($img) . '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
      . '<meta property="og:image:alt" content="' . $h($title) . '"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' . $h($title) . '"><meta name="twitter:description" content="' . $h($desc) . '"><meta name="twitter:image" content="' . $h($img) . "\">\n");
  } catch (Throwable $e) { error_log('[seo] ' . $e->getMessage()); }
  return [$title, $desc, $body];
}

function seo_topic(int $id, string $title, string $desc, string $body, callable $h): array {
  $t = row("SELECT * FROM topics WHERE id = ? AND deleted = 0", [$id]); if (!$t) return [$title, $desc, $body];
  $b = board_doc((string) $t['board']); if (!$b || !can_read_board(null, $b)) return [$title, $desc, $body];
  $posts = rows("SELECT id, author, body, at FROM posts WHERE topic_id = ? AND hidden = 0 ORDER BY id LIMIT 40", [$id]);
  if (!$posts) return [$title, $desc, $body];
  $url = site_url("/topic/$id"); $first = $posts[0]; $replies = max(0, (int) val("SELECT COUNT(*) FROM posts WHERE topic_id = ? AND hidden = 0", [$id]) - 1);
  $crumb = [['Home', '/'], [(string) $b['name'], '/forum/' . $b['slug']], [(string) $t['title'], null]];
  $person = fn(string $n) => ['@type' => 'Person', 'name' => $n, 'url' => site_url('/members/' . rawurlencode($n))];
  $forum = ['@context' => 'https://schema.org', '@type' => 'DiscussionForumPosting', 'mainEntityOfPage' => $url, 'url' => $url, 'headline' => mb_substr((string) $t['title'], 0, 110),
    'text' => seo_text((string) $first['body'], 5000), 'author' => $person((string) $first['author']), 'datePublished' => seo_iso((int) $first['at']),
    'dateModified' => seo_iso((int) max($t['last_at'], $first['at'])), 'isPartOf' => ['@type' => 'WebPage', 'name' => $b['name'], 'url' => site_url('/forum/' . $b['slug'])],
    'interactionStatistic' => [['@type' => 'InteractionCounter', 'interactionType' => 'https://schema.org/CommentAction', 'userInteractionCount' => $replies]]
      + (isset($t['views']) ? [1 => ['@type' => 'InteractionCounter', 'interactionType' => 'https://schema.org/ViewAction', 'userInteractionCount' => (int) $t['views']]] : []),
    'comment' => array_map(fn($p) => ['@type' => 'Comment', 'author' => $person((string) $p['author']), 'datePublished' => seo_iso((int) $p['at']), 'text' => seo_text((string) $p['body'], 2000),
      'url' => $url . '#p' . $p['id']], array_slice($posts, 1, 20))];
  $forum['interactionStatistic'] = array_values($forum['interactionStatistic']);
  if (!$forum['comment']) unset($forum['comment']);

  // A member review: rating, the casino it's about, and a title that says so
  $rev = !empty($t['review_id']) ? row("SELECT * FROM reviews WHERE id = ? AND status <> 'removed'", [(int) $t['review_id']]) : null;
  if ($rev) {
    $o = row("SELECT slug, data FROM operators WHERE slug = ?", [$rev['op']]);
    $d = $o ? jdec((string) $o['data'], []) : []; $name = (string) ($d['name'] ?? $rev['op']); $opPath = seo_op_path($d, (string) $rev['op']);
    $stars = max(1, min(5, (int) $rev['stars']));
    $title = "$name review: “" . mb_strimwidth((string) $rev['title'], 0, 70, '…') . "” ($stars/5) | " . SEO_SITE;
    $desc = "$stars/5 stars for $name from " . $rev['user'] . ': ' . seo_text((string) $rev['body'], 120) . " Read it and $replies " . ($replies === 1 ? 'reply' : 'replies') . '.';
    $verified = ['verified transaction' => ' · Verified transaction', 'verified user' => ' · Verified reviewer'][$rev['status']] ?? '';
    $avg = (float) (val("SELECT AVG(stars) FROM reviews WHERE op = ? AND status <> 'removed'", [$rev['op']]) ?? 0); $cnt = (int) val("SELECT COUNT(*) FROM reviews WHERE op = ? AND status <> 'removed'", [$rev['op']]);
    $body = '<p><a href="' . $h($opPath) . '">' . $h($name) . '</a>: rated <strong>' . $stars . ' out of 5</strong> by ' . $h($rev['user']) . $h($verified) . '. ' . $h($name) . ' averages ' . seo_stars($avg) . "/5 from $cnt member review" . ($cnt === 1 ? '' : 's')
      . '. <a href="' . $h($opPath) . '">See every ' . $h($name) . ' review, complaint and licence detail</a>.</p>' . $body;
    $item = ['@type' => 'Organization', 'name' => $name, 'url' => site_url($opPath)];
    if (!empty($d['website'])) $item['sameAs'] = str_starts_with((string) $d['website'], 'http') ? $d['website'] : 'https://' . $d['website'];
    seo_ld(['@context' => 'https://schema.org', '@type' => 'Review', 'name' => (string) $rev['title'], 'url' => $url, 'itemReviewed' => $item,
      'reviewRating' => ['@type' => 'Rating', 'ratingValue' => $stars, 'bestRating' => 5, 'worstRating' => 1], 'author' => $person((string) $rev['user']),
      'datePublished' => seo_iso((int) $rev['at']), 'reviewBody' => seo_text((string) $rev['body'], 5000), 'publisher' => ['@type' => 'Organization', 'name' => SEO_SITE, 'url' => site_url('/')]]);
    $crumb = [['Home', '/'], [($d['type'] ?? '') === 'casino' ? 'Casinos' : 'Sportsbooks', ($d['type'] ?? '') === 'casino' ? '/casinos' : '/sportsbooks'], [$name, $opPath], [(string) $rev['title'], null]];
  }
  seo_ld($forum); seo_crumbs($crumb);
  return [$title, $desc, $body];
}

function seo_board(string $slug, string $title, string $desc): array {
  $b = board_doc($slug); if (!$b) return [$title, $desc];
  $n = (int) val("SELECT COUNT(*) FROM topics WHERE board = ? AND deleted = 0", [$slug]);
  if (($b['kind'] ?? '') === 'review') {
    $what = ($b['opType'] ?? '') === 'sportsbook' ? 'sportsbook' : 'casino';
    $title = ucfirst($what) . " reviews by real players: payouts, support and bonuses | " . SEO_SITE;
    $desc = "$n honest $what reviews from players: withdrawal times, customer support, bonus terms and verified payouts. Read them or add yours.";
  }
  $cat = (string) ($b['cat'] ?? '');
  seo_crumbs([['Home', '/'], [(string) $b['name'], null]]);
  return [$title, $desc];
}

function seo_hub(string $s0, string $title, string $desc, string $body, callable $h): array {
  $want = $s0 === 'casinos' ? 'casino' : 'sportsbook'; $year = gmdate('Y');
  $stats = []; foreach (rows("SELECT op, COUNT(*) n, AVG(stars) a FROM reviews WHERE status <> 'removed' GROUP BY op") as $r) $stats[$r['op']] = [(int) $r['n'], (float) $r['a']];
  $cmp = []; foreach (rows("SELECT op, COUNT(*) n FROM complaints GROUP BY op") as $r) $cmp[$r['op']] = (int) $r['n'];
  $ops = [];
  foreach (rows("SELECT slug, data FROM operators") as $r) {
    $d = jdec((string) $r['data'], []); $t = (string) ($d['type'] ?? '');
    if (!empty($d['blacklist'])) continue;
    if ($want === 'casino' ? !in_array($t, ['casino', 'both'], true) : !in_array($t, ['sportsbook', 'both', ''], true)) continue;
    $ops[] = ['slug' => $r['slug'], 'd' => $d, 'n' => $stats[$r['slug']][0] ?? 0, 'a' => $stats[$r['slug']][1] ?? 0, 'c' => $cmp[$r['slug']] ?? 0];
  }
  usort($ops, fn($x, $y) => [$y['n'] > 0, $y['a'], $y['n']] <=> [$x['n'] > 0, $x['a'], $x['n']]);
  $total = array_sum(array_column($ops, 'n')); $cnt = count($ops);
  $label = $want === 'casino' ? 'online casinos' : 'sportsbooks';
  $title = ($want === 'casino' ? 'Online casino' : 'Sportsbook') . " reviews $year: $cnt $label rated by real players | " . SEO_SITE;
  $desc = "Honest " . ($want === 'casino' ? 'online casino' : 'sportsbook') . " reviews from players: $total member reviews, payout speed, complaints and licences, with a Safety Index for each. Read before you deposit.";
  $li = '';
  foreach (array_slice($ops, 0, 200) as $o) {
    $p = seo_op_path($o['d'], $o['slug']);
    $li .= '<li><a href="' . $h($p) . '">' . $h($o['d']['name'] ?? $o['slug']) . ' review</a>' . ($o['n'] ? ' · ' . seo_stars($o['a']) . '/5 from ' . $o['n'] . ' review' . ($o['n'] === 1 ? '' : 's') : ' · no reviews yet')
      . ($o['c'] ? ' · ' . $o['c'] . ' complaint' . ($o['c'] === 1 ? '' : 's') : '') . (!empty($o['d']['license']) ? ' · ' . $h(mb_strimwidth((string) $o['d']['license'], 0, 80, '…')) : '') . '</li>';
  }
  $body = '<h1>' . ($want === 'casino' ? 'Online casino reviews' : 'Sportsbook reviews') . " $year</h1><p>" . $h("$cnt $label rated by Pitchside members. Each one has member reviews, complaints and licence details, and a Safety Index. Ranked by member rating.") . "</p><ul>$li</ul>";
  seo_ld(['@context' => 'https://schema.org', '@type' => 'ItemList', 'name' => ($want === 'casino' ? 'Online casino reviews' : 'Sportsbook reviews') . " $year",
    'itemListElement' => array_map(fn($o, $i) => ['@type' => 'ListItem', 'position' => $i + 1, 'url' => site_url(seo_op_path($o['d'], $o['slug'])), 'name' => (string) ($o['d']['name'] ?? $o['slug'])], array_slice($ops, 0, 50), array_keys(array_slice($ops, 0, 50)))]);
  seo_crumbs([['Home', '/'], [$want === 'casino' ? 'Casinos' : 'Sportsbooks', null]]);
  return [$title, $desc, $body];
}

function seo_complaints(string $title, string $desc, string $body, callable $h): array {
  $all = (int) val("SELECT COUNT(*) FROM complaints"); $ok = (int) val("SELECT COUNT(*) FROM complaints WHERE status IN ('Resolved', 'Partially Resolved')");
  $title = "Casino and sportsbook complaints: $all player cases, $ok resolved | " . SEO_SITE;
  $desc = "Player complaints about withdrawals, confiscated winnings, KYC and bonuses, and how each casino responded. File yours and get a public answer.";
  $names = []; foreach (rows("SELECT slug, data FROM operators") as $r) $names[$r['slug']] = (string) (jdec((string) $r['data'], [])['name'] ?? $r['slug']);
  $li = '';
  foreach (rows("SELECT id, op, title, status, cat FROM complaints ORDER BY updated DESC LIMIT 60") as $c)
    $li .= '<li><a href="/complaints/' . $h($c['id']) . '">' . $h($c['title']) . '</a> · ' . $h($names[$c['op']] ?? $c['op']) . ' · ' . $h($c['status']) . ' · ' . $h($c['cat']) . '</li>';
  $body = '<h1>Casino and sportsbook complaints</h1><p>' . $h("$all complaints filed by players, $ok resolved. Every case is public, and the casino can reply.") . "</p><ul>$li</ul>";
  seo_crumbs([['Home', '/'], ['Complaints', null]]);
  return [$title, $desc, $body];
}

/* ---------- IndexNow: tell Bing and Yandex about new pages straight away ---------- */
function seo_indexnow_key(): string { return (string) (meta_get('seo:indexnow', '') ?? ''); }
function seo_ping(array $paths): void {
  if (!$paths || !setting('siteIndexing') || seo_indexnow_key() === '' || !function_exists('curl_init')) return;
  $host = (string) parse_url(site_url('/'), PHP_URL_HOST); if ($host === '' || $host === 'localhost' || str_starts_with($host, '127.')) return;
  static $on = false; $GLOBALS['SEO_PING'] = array_merge($GLOBALS['SEO_PING'] ?? [], $paths); if ($on) return; $on = true;
  register_shutdown_function(function () use ($host) {
    try {
      if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
      $urls = array_values(array_unique(array_map('site_url', $GLOBALS['SEO_PING'] ?? []))); if (!$urls) return;
      $ch = curl_init('https://api.indexnow.org/indexnow');
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'], CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
        CURLOPT_POSTFIELDS => json_encode(['host' => $host, 'key' => seo_indexnow_key(), 'keyLocation' => site_url('/' . seo_indexnow_key() . '.txt'), 'urlList' => $urls])]);
      curl_exec($ch); curl_close($ch);
    } catch (Throwable $e) { error_log('[seo indexnow] ' . $e->getMessage()); }
  });
}
(function () {
  if (!isset($GLOBALS['OPS'])) return;
  $ops = &$GLOBALS['OPS'];
  $wrap = function (string $name, callable $paths) use (&$ops) {
    if (!isset($ops[$name])) return;
    [$base, $need] = $ops[$name];
    $ops[$name] = [function (array $in, array $u) use ($base, $paths) {
      $res = $base($in, $u);
      try { $p = $paths($in, is_array($res) ? $res : []); if ($p) seo_ping($p); } catch (Throwable $e) {}
      return $res;
    }, $need];
  };
  $wrap('topic.create', function ($in, $res) {
    if (empty($res['id'])) return [];
    $t = row("SELECT board, deleted FROM topics WHERE id = ?", [(int) $res['id']]); $b = $t ? board_doc((string) $t['board']) : null;
    return $t && !(int) $t['deleted'] && $b && can_read_board(null, $b) ? ['/topic/' . (int) $res['id'], '/forum/' . $t['board']] : [];
  });
  $wrap('review.create', function ($in, $res) {
    if (empty($res['thread'])) return [];
    $r = row("SELECT op FROM reviews WHERE id = ?", [(int) ($res['id'] ?? 0)]); $o = $r ? row("SELECT data FROM operators WHERE slug = ?", [$r['op']]) : null;
    return array_values(array_filter(['/topic/' . (int) $res['thread'], $o ? seo_op_path(jdec((string) $o['data'], []), (string) $r['op']) : null]));
  });
  $wrap('complaint.create', fn($in, $res) => !empty($res['id']) ? ['/complaints/' . $res['id'], '/complaints'] : []);
})();

/* ---------- Team and league pages ---------- */
function seo_club(string $kind, string $slug, string $title, string $desc, string $body, callable $h): array {
  $teams = doc('TEAMS'); $leagues = doc('LEAGUES');
  $lg = []; foreach ($leagues as $l) $lg[$l['slug']] = $l;
  $public = []; foreach (doc('BOARDS') as $b) if (can_read_board(null, $b)) $public[] = $b['slug'];
  if (!$public) return [$title, $desc, $body];
  $topicLi = fn(array $t) => '<li><a href="/topic/' . (int) $t['id'] . '">' . $h($t['title']) . '</a> · ' . ($rn = max(0, (int) $t['n'] - 1)) . ($rn === 1 ? ' reply · ' : ' replies · ') . gmdate('j M Y', intdiv((int) $t['last_at'], 1000)) . '</li>';
  $q = fn(string $where, array $args) => rows("SELECT t.id, t.title, t.last_at, (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id AND p.hidden = 0) n FROM topics t WHERE t.deleted = 0 AND t.board IN (" . in_list($public) . ") AND ($where) ORDER BY t.last_at DESC LIMIT 30", array_merge($public, $args));
  if ($kind === 'teams') {
    $t = null; foreach ($teams as $x) if (($x['slug'] ?? '') === $slug) $t = $x; if (!$t) return [$title, $desc, $body];
    $L = $lg[$t['league'] ?? ''] ?? null; $name = (string) $t['name'];
    $topics = $q("t.teams LIKE ?", ['%"' . $slug . '"%']);
    $facts = array_filter([$L ? "plays in the {$L['name']}" : null, !empty($t['stadium']) ? "home ground {$t['stadium']}" : null, !empty($t['founded']) ? "founded in {$t['founded']}" : null, !empty($t['country']) ? "from " . $t['country'] : null]);
    $title = "$name fans forum: match threads, transfers and predictions | " . SEO_SITE;
    $desc = "Talk $name with other fans: live match threads, transfer rumours, team news and predictions" . ($L ? " for every {$L['name']} game" : '') . '. ' . count($topics) . ' recent topics on Pitchside.';
    $others = array_filter($teams, fn($x) => ($x['league'] ?? null) === ($t['league'] ?? '#') && $x['slug'] !== $slug);
    $body = '<h1>' . $h($name) . ' fans forum</h1><p>' . $h($name . ($facts ? ' ' . implode(', ', $facts) : '') . ". Follow $name on Pitchside for match threads that open before every game, transfer talk, team news and predictions.") . '</p>'
      . ($topics ? '<h2>Latest ' . $h($name) . ' topics</h2><ul>' . implode('', array_map($topicLi, $topics)) . '</ul>' : '<p>' . $h("No $name topics yet. Start the first one.") . '</p>')
      . ($L ? '<h2>' . $h($L['name']) . '</h2><p><a href="/leagues/' . $h($L['slug']) . '">' . $h($L['name']) . ' forum</a></p>' : '')
      . ($others ? '<h2>Other ' . $h($L['name'] ?? '') . ' clubs</h2><ul>' . implode('', array_map(fn($x) => '<li><a href="/teams/' . $h($x['slug']) . '">' . $h($x['name']) . ' forum</a></li>', $others)) . '</ul>' : '');
    $ld = ['@context' => 'https://schema.org', '@type' => 'SportsTeam', 'name' => $name, 'url' => site_url("/teams/$slug"), 'sport' => ucfirst((string) ($L['sport'] ?? 'football'))];
    if (!empty($t['founded'])) $ld['foundingDate'] = (string) $t['founded'];
    if (!empty($t['stadium'])) $ld['location'] = ['@type' => 'Place', 'name' => (string) $t['stadium']];
    if ($L) $ld['memberOf'] = ['@type' => 'SportsOrganization', 'name' => (string) $L['name'], 'url' => site_url('/leagues/' . $L['slug'])];
    seo_ld($ld);
    seo_crumbs(array_values(array_filter([['Home', '/'], $L ? [(string) $L['name'], '/leagues/' . $L['slug']] : null, [$name, null]])));
  } else {
    $L = $lg[$slug] ?? null; if (!$L) return [$title, $desc, $body]; $name = (string) $L['name'];
    $clubs = array_filter($teams, fn($x) => ($x['league'] ?? null) === $slug || in_array($slug, (array) ($x['also'] ?? []), true));
    $topics = $q("t.league = ?" . (!empty($L['board']) ? " OR t.board = ?" : ''), !empty($L['board']) ? [$slug, $L['board']] : [$slug]);
    $title = "$name forum: match threads, predictions and fan talk | " . SEO_SITE;
    $desc = "$name discussion on Pitchside: live match threads, predictions, betting tips and fan talk" . ($clubs ? ' for ' . count($clubs) . ' clubs' : '') . ($L['season'] ?? '' ? ", {$L['season']} season" : '') . '.';
    $body = '<h1>' . $h($name) . ' forum</h1><p>' . $h("$name" . (!empty($L['region']) ? " ({$L['region']})" : '') . (!empty($L['season']) ? ", {$L['season']} season" : '') . ". Match threads open before every game, plus predictions, team news and fan talk.") . '</p>'
      . ($topics ? '<h2>Latest ' . $h($name) . ' topics</h2><ul>' . implode('', array_map($topicLi, $topics)) . '</ul>' : '')
      . ($clubs ? '<h2>Clubs</h2><ul>' . implode('', array_map(fn($x) => '<li><a href="/teams/' . $h($x['slug']) . '">' . $h($x['name']) . ' fans forum</a></li>', $clubs)) . '</ul>' : '');
    seo_ld(['@context' => 'https://schema.org', '@type' => 'SportsOrganization', 'name' => $name, 'url' => site_url("/leagues/$slug"), 'sport' => ucfirst((string) ($L['sport'] ?? 'football'))]);
    seo_crumbs([['Home', '/'], [$name, null]]);
  }
  return [$title, $desc, $body];
}

/* ---------- Link-preview pictures ---------- */
function seo_share_ok(): bool { return function_exists('imagecreatetruecolor') && function_exists('imagettftext') && is_file(APP_DIR . '/fonts/Inter-Bold.otf'); }
// The picture address for a page, or null to use the standard picture
function seo_share_path(array $seg, string $path, int $status): ?string {
  if ($status !== 200 || !seo_share_ok()) return null;
  $s0 = $seg[0] ?? ''; $s1 = $seg[1] ?? null;
  if ($s0 === 'topic' && $s1 !== null && ctype_digit((string) $s1)) return "/share-image/topic/$s1";
  if (in_array($s0, ['casinos', 'sportsbooks', 'teams', 'leagues', 'forum'], true) && $s1 !== null && preg_match('/^[a-z0-9-]{1,64}$/', (string) $s1)) return "/share-image/$s0/$s1";
  if (in_array($s0, ['casinos', 'sportsbooks', 'complaints'], true) && $s1 === null) return "/share-image/$s0";
  if ($s0 === 'complaints' && $s1 !== null && preg_match('/^[A-Za-z0-9-]{1,32}$/', (string) $s1)) return "/share-image/complaint/$s1";
  return null;
}
// What goes on the picture: [kicker, title, subtitle, stars or null]
function seo_share_card(string $kind, ?string $id): ?array {
  $name = fn(string $slug) => (string) (jdec((string) val("SELECT data FROM operators WHERE slug = ?", [$slug]), [])['name'] ?? $slug);
  if ($kind === 'topic' && $id !== null) {
    $t = row("SELECT * FROM topics WHERE id = ? AND deleted = 0", [(int) $id]); if (!$t) return null;
    $b = board_doc((string) $t['board']); if (!$b || !can_read_board(null, $b)) return null;
    if (!empty($t['review_id']) && ($r = row("SELECT op, user, stars, title, status FROM reviews WHERE id = ? AND status <> 'removed'", [(int) $t['review_id']])))
      return [mb_strtoupper($name((string) $r['op'])) . ' REVIEW', '“' . $r['title'] . '”', ((int) $r['stars']) . '/5 by ' . $r['user'] . ($r['status'] === 'verified transaction' ? ' · Verified transaction' : ''), (float) $r['stars']];
    $n = max(0, (int) val("SELECT COUNT(*) FROM posts WHERE topic_id = ? AND hidden = 0", [(int) $t['id']]) - 1);
    return [mb_strtoupper((string) $b['name']), (string) $t['title'], "$n " . ($n === 1 ? 'reply' : 'replies') . ' · Join the discussion', null];
  }
  if (in_array($kind, ['casinos', 'sportsbooks'], true) && $id !== null) {
    $o = row("SELECT data FROM operators WHERE slug = ?", [$id]); if (!$o) return null; $d = jdec((string) $o['data'], []);
    $r = row("SELECT COUNT(*) n, AVG(stars) a FROM reviews WHERE op = ? AND status <> 'removed'", [$id]); $n = (int) ($r['n'] ?? 0); $c = (int) val("SELECT COUNT(*) FROM complaints WHERE op = ?", [$id]);
    return [($d['type'] ?? '') === 'casino' ? 'CASINO REVIEWS' : 'SPORTSBOOK REVIEWS', ($d['name'] ?? $id) . ' review',
      ($n ? seo_stars((float) $r['a']) . "/5 from $n member review" . ($n === 1 ? '' : 's') : 'No reviews yet. Be the first') . ($c ? " · $c complaint" . ($c === 1 ? '' : 's') : ''), $n ? (float) $r['a'] : null];
  }
  if (in_array($kind, ['casinos', 'sportsbooks'], true)) return ['REAL PLAYER REVIEWS', $kind === 'casinos' ? 'Online casino reviews ' . gmdate('Y') : 'Sportsbook reviews ' . gmdate('Y'), 'Payouts, complaints and licences, rated by members', null];
  if ($kind === 'complaints') return ['PLAYER COMPLAINTS', 'Casino and sportsbook complaints', ((int) val("SELECT COUNT(*) FROM complaints")) . ' public cases · casinos can reply', null];
  if ($kind === 'complaint' && $id !== null) { $c = row("SELECT title, op, status FROM complaints WHERE id = ?", [$id]); if (!$c) return null;
    return ['COMPLAINT · ' . mb_strtoupper($name((string) $c['op'])), (string) $c['title'], 'Status: ' . $c['status'], null]; }
  if ($kind === 'teams' && $id !== null) { foreach (doc('TEAMS') as $t) if (($t['slug'] ?? '') === $id) return ['FANS FORUM', (string) $t['name'], 'Match threads, transfers and predictions', null]; return null; }
  if ($kind === 'leagues' && $id !== null) { foreach (doc('LEAGUES') as $l) if (($l['slug'] ?? '') === $id) return ['FORUM', (string) $l['name'], 'Match threads, predictions and fan talk', null]; return null; }
  if ($kind === 'forum' && $id !== null) { $b = board_doc($id); if (!$b || !can_read_board(null, $b)) return null; return ['FORUM', (string) $b['name'], mb_strimwidth((string) ($b['desc'] ?? ''), 0, 90, '…'), null]; }
  return null;
}
function seo_share_draw(?array $card, string $file, ?string $hostOverride = null): void {
  $W = 1200; $H = 630; $im = imagecreatetruecolor($W, $H); imagealphablending($im, true); imageantialias($im, true);
  $rgb = fn(string $hex) => imagecolorallocate($im, hexdec(substr($hex, 1, 2)), hexdec(substr($hex, 3, 2)), hexdec(substr($hex, 5, 2)));
  $bg = $rgb('#11171E'); $panel = $rgb('#161E27'); $line = $rgb('#2A3540'); $sky = $rgb('#A9D6F5'); $ink = $rgb('#0E3A5B'); $white = $rgb('#F2F6F9'); $soft = $rgb('#AEBBC7'); $star = $rgb('#F2B84B'); $starOff = $rgb('#3A4652');
  $B = APP_DIR . '/fonts/Inter-Bold.otf'; $M = APP_DIR . '/fonts/Inter-Medium.otf';
  imagefilledrectangle($im, 0, 0, $W, $H, $bg);
  imagefilledrectangle($im, 0, 0, 14, $H, $sky);                                                    // accent edge
  for ($i = 0; $i < 6; $i++) imageline($im, 900 + $i * 60, $H, $W, 330 + $i * 60, $line);           // pitch lines, quiet
  // logo
  $r = 14; $x0 = 72; $y0 = 60; $s = 64;
  imagefilledrectangle($im, $x0 + $r, $y0, $x0 + $s - $r, $y0 + $s, $sky); imagefilledrectangle($im, $x0, $y0 + $r, $x0 + $s, $y0 + $s - $r, $sky);
  foreach ([[$x0 + $r, $y0 + $r], [$x0 + $s - $r, $y0 + $r], [$x0 + $r, $y0 + $s - $r], [$x0 + $s - $r, $y0 + $s - $r]] as [$cx, $cy]) imagefilledellipse($im, $cx, $cy, $r * 2, $r * 2, $sky);
  $bb = imagettfbbox(34, 0, $B, 'P'); imagettftext($im, 34, 0, $x0 + (int) (($s - ($bb[2] - $bb[0])) / 2) - 1, $y0 + 47, $ink, $B, 'P');
  imagettftext($im, 30, 0, $x0 + $s + 20, $y0 + 44, $white, $B, 'Pitchside'); $bb = imagettfbbox(30, 0, $B, 'Pitchside');
  imagettftext($im, 30, 0, $x0 + $s + 20 + ($bb[2] - $bb[0]) + 12, $y0 + 44, $soft, $M, 'Forum');
  $host = $hostOverride ?? (string) (parse_url(site_url('/'), PHP_URL_HOST) ?: 'pitchsideforum.com');
  imagettftext($im, 22, 0, 72, $H - 56, $soft, $M, $host);
  if ($card) {
    [$kick, $title, $sub, $rating] = $card;
    imagettftext($im, 22, 0, 72, 222, $sky, $B, mb_strimwidth($kick, 0, 60, '…'));
    // title: biggest size that fits in 3 lines
    $maxW = 1040; $lines = []; $size = 60;
    foreach ([60, 54, 48, 42] as $size) {
      $lines = []; $cur = '';
      foreach (preg_split('/\s+/u', trim($title)) as $w) { $try = $cur === '' ? $w : "$cur $w"; $b = imagettfbbox($size, 0, $B, $try);
        if ($b[2] - $b[0] > $maxW && $cur !== '') { $lines[] = $cur; $cur = $w; } else $cur = $try; }
      if ($cur !== '') $lines[] = $cur;
      if (count($lines) <= 3) break;
    }
    if (count($lines) > 3) { $lines = array_slice($lines, 0, 3); $lines[2] = mb_strimwidth($lines[2], 0, max(1, mb_strlen($lines[2]) - 1), '…'); }
    $y = 222 + 28 + (int) ($size * 1.15);
    foreach ($lines as $ln) { imagettftext($im, $size, 0, 70, $y, $white, $B, $ln); $y += (int) ($size * 1.25); }
    $y += 6; $x = 72;
    if ($rating !== null) {                                                                          // five stars
      for ($i = 0; $i < 5; $i++) { $cx = $x + 18 + $i * 44; $cy = $y - 12; $pts = [];
        for ($k = 0; $k < 10; $k++) { $ang = -M_PI / 2 + $k * M_PI / 5; $rr = $k % 2 ? 8 : 19; $pts[] = (int) round($cx + $rr * cos($ang)); $pts[] = (int) round($cy + $rr * sin($ang)); }
        $fill = $rating >= $i + 0.5 ? $star : $starOff;   // rounded to the nearest whole star
        imagefilledpolygon($im, $pts, $fill); }
      $x += 5 * 44 + 18;
    }
    imagettftext($im, 28, 0, $x, $y, $soft, $M, mb_strimwidth($sub, 0, 70, '…'));
  } else {
    imagettftext($im, 64, 0, 70, 330, $white, $B, 'Sports, betting and');
    imagettftext($im, 64, 0, 70, 410, $white, $B, 'casino reviews by fans');
    imagettftext($im, 28, 0, 72, 486, $soft, $M, 'Match threads · Honest reviews · Public complaints');
  }
  @mkdir(dirname($file), 0750, true);
  imagepng($im, $file . '.tmp', 6); imagedestroy($im); @rename($file . '.tmp', $file);
}
function seo_share_serve(string $path): void {
  $parts = array_values(array_filter(explode('/', substr($path, strlen('/share-image')))));
  $kind = (string) ($parts[0] ?? ''); $id = isset($parts[1]) ? rawurldecode((string) $parts[1]) : null;
  if (!in_array($kind, ['topic', 'casinos', 'sportsbooks', 'teams', 'leagues', 'forum', 'complaints', 'complaint'], true) || ($id !== null && !preg_match('/^[A-Za-z0-9-]{1,64}$/', $id))) { http_response_code(404); exit; }
  $card = null; try { $card = seo_share_card($kind, $id); } catch (Throwable $e) {}
  if ($card === null) { header('Location: ' . site_url('/assets/share.1.png'), true, 302); exit; }
  $file = APP_DIR . '/storage/cache/share/' . substr(hash('sha256', jenc($card) . '|' . site_url('/') . '|v1'), 0, 32) . '.png';
  if (!is_file($file)) seo_share_draw($card, $file);
  if (!is_file($file)) { header('Location: ' . site_url('/assets/share.1.png'), true, 302); exit; }
  header('Content-Type: image/png'); header('Cache-Control: public, max-age=86400'); header('Content-Length: ' . filesize($file));
  readfile($file); exit;
}
if (PHP_SAPI !== 'cli' && basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'index.php') {
  $sp = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '');
  if (str_starts_with($sp, '/share-image/') || $sp === '/share-image') { if (seo_share_ok()) seo_share_serve($sp); http_response_code(404); exit; }
}
if (PHP_SAPI === 'cli' && basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'cron.php') {
  register_shutdown_function(function () { foreach (glob(APP_DIR . '/storage/cache/share/*.png') ?: [] as $f) if (filemtime($f) < time() - 30 * 86400) @unlink($f); });
}
