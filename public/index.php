<?php
// Serves every page of Pitchside Forum. The page arrives with its data already inside (no loading spinner),
// plus a plain-HTML copy of the content so search engines and link previews can read it.
declare(strict_types=1);
require dirname(__DIR__) . '/app/lib/api.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');

try {
  if ($path === '/robots.txt') {
    header('Content-Type: text/plain; charset=utf-8');
    echo setting('siteIndexing') ? "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /go/\nDisallow: /messages\nDisallow: /settings\nDisallow: /admin\nDisallow: /mod\nSitemap: " . site_url('/sitemap.xml') . "\n" : "User-agent: *\nDisallow: /\n";
    exit;
  }
  load_session(); $u = viewer();
  header('Cache-Control: no-cache, private');

  // Guests share a short-lived copy of the page data so busy moments stay fast
  $boot = null; $cache = APP_DIR . '/storage/cache/boot-guest.json';
  if (!$u && !current_session() && is_file($cache) && filemtime($cache) > time() - 20) $boot = json_decode((string) file_get_contents($cache), true);
  if (!$boot) {
    $boot = sync_payload($u, 0);
    if (!$u && !current_session()) { @mkdir(dirname($cache), 0750, true); @file_put_contents($cache . '.tmp', jenc($boot)); @rename($cache . '.tmp', $cache); }
  }

  /* ---------- Title, description and a readable copy of the page ---------- */
  $site = 'Pitchside Forum'; $title = "$site: sports, betting talk and community"; $desc = 'Match threads, team and league boards, betting and crypto discussion. A fan-run sports forum.';
  $index = (bool) setting('siteIndexing'); $status = 200; $body = '';
  $seg = array_values(array_filter(explode('/', $path)));
  $excerpt = fn(string $s, int $n = 155) => mb_strimwidth(trim(preg_replace('/\s+/', ' ', preg_replace('/\[quote=[^\]]*\][\s\S]*?\[\/quote\]/', '', $s))), 0, $n, '…');
  $postHtml = fn(string $s) => nl2br($h(preg_replace('/\[quote=([^\]]*)\]([\s\S]*?)\[\/quote\]/', "“$2” ($1)\n", $s)));
  $showReplies = (doc('LAYOUT')['statReplies'] ?? true) !== false;
  $topicLi = fn(array $t) => '<li><a href="/topic/' . (int) $t['id'] . '">' . $h($t['title']) . '</a>' . ($showReplies ? ' <small>' . (count($t['posts']) - 1) . ' replies</small>' : '') . '</li>';
  foreach (doc('SEO') as $s) if (($s['path'] ?? '') === $path) { $title = $s['title'] ?: $title; $desc = $s['desc'] ?: $desc; if (empty($s['index'])) $index = false; }

  if (($seg[0] ?? '') === 'topic' && isset($seg[1])) {
    $t = row("SELECT * FROM topics WHERE id = ?", [(int) $seg[1]]);
    $out = $t ? topics_out([$t], $u) : [];
    if (!$out || $out[0]['deleted']) { $status = 404; $title = "Topic not found | $site"; $index = false; }
    else {
      $t = $out[0]; $b = board_doc($t['board']);
      $title = $t['title'] . ' | ' . ($b['name'] ?? 'Forum') . " | $site"; $desc = $excerpt($t['posts'][0]['body']);
      if (!can_read_board(null, $b)) $index = false;
      $body = '<article><p><a href="/forum/' . $h($t['board']) . '">' . $h($b['name'] ?? '') . '</a></p><h1>' . $h($t['title']) . '</h1>';
      foreach (array_slice(array_filter($t['posts'], fn($p) => !$p['hidden']), 0, 30) as $p)
        $body .= '<section><p><strong>' . $h($p['author']) . '</strong> · ' . gmdate('j M Y', intdiv($p['at'], 1000)) . '</p><div>' . $postHtml($p['body']) . '</div></section>';
      $body .= '</article>';
      if (empty($boot['topics']) || !in_array($t['id'], array_column($boot['topics'], 'id'), true)) $boot['topics'][] = $t;
    }
  } elseif (($seg[0] ?? '') === 'forum' && isset($seg[1])) {
    $b = board_doc($seg[1]);
    if (!$b) { $status = 404; $index = false; }
    else {
      $title = $b['name'] . " forum | $site"; $desc = ($b['desc'] ?? '') ?: $desc;
      $ts = topics_out(rows("SELECT * FROM topics WHERE board = ? AND deleted = 0 ORDER BY pinned DESC, last_at DESC LIMIT 40", [$b['slug']]), $u);
      $body = '<h1>' . $h($b['name']) . '</h1><p>' . $h($b['desc'] ?? '') . '</p><ul>' . implode('', array_map($topicLi, $ts)) . '</ul>';
    }
  } elseif (($seg[0] ?? '') === 'members' && isset($seg[1])) {
    $title = $seg[1] . " | $site member"; $index = false;
  } elseif (in_array($seg[0] ?? '', ['messages', 'settings', 'admin', 'mod', 'notifications', 'reset', 'verify', 'search'], true)) {
    $index = false;
  } elseif (in_array($seg[0] ?? '', ['casinos', 'sportsbooks'], true) && isset($seg[1]) && feature_on('casinos')) {
    $r = row("SELECT data FROM operators WHERE slug = ?", [$seg[1]]);
    if (!$r) { $status = 404; $index = false; }
    else { $o = jdec($r['data'], []); $n = (int) val("SELECT COUNT(*) FROM reviews WHERE op = ? AND status <> 'removed'", [$seg[1]]);
      $title = "{$o['name']} review: payouts, complaints, Safety Index | $site"; $desc = "Member reviews ($n), complaints and licence details for {$o['name']}. " . ($o['license'] ?? '');
      $body = '<h1>' . $h($o['name']) . '</h1><p>' . $h($o['license'] ?? '') . '</p>'; }
  } elseif (($seg[0] ?? '') === 'raffle' && !isset($seg[1])) {
    $title = "Weekly raffle: free to enter, win USDT | $site"; $desc = 'Free weekly prize draw for Pitchside members. Join, start a topic and post in the community to qualify. 18+ only.';
    $body = '<h1>Weekly raffle</h1><p>' . $h($desc) . '</p>';
  } elseif (($seg[0] ?? '') === 'promotions' && !isset($seg[1])) {
    $title = "Casino & sportsbook promotions and bonuses | $site"; $desc = 'The latest welcome offers, free spins, free bets and reload bonuses from casinos and sportsbooks, with the key terms. 18+ only.';
    $body = '<h1>Promotions &amp; bonuses</h1><p>' . $h($desc) . '</p>';
  } elseif (($seg[0] ?? '') === 'complaints' && isset($seg[1]) && feature_on('complaints')) {
    $c = row("SELECT * FROM complaints WHERE id = ?", [$seg[1]]);
    if (!$c) { $status = 404; $index = false; }
    else { $title = "{$c['title']} ({$c['id']}) | Complaints | $site"; $desc = $excerpt($c['statement']);
      $body = '<article><h1>' . $h($c['title']) . '</h1><p>' . $h($c['id']) . ' · ' . $h($c['status']) . '</p><div>' . $postHtml($c['statement']) . '</div></article>'; }
  } elseif (($seg[0] ?? '') === 'teams' || ($seg[0] ?? '') === 'leagues') {
    $list = doc($seg[0] === 'teams' ? 'TEAMS' : 'LEAGUES');
    foreach ($list as $x) if (($x['slug'] ?? '') === ($seg[1] ?? '')) { $title = $x['name'] . ($seg[0] === 'teams' ? ' fans forum' : ' forum') . " | $site"; $desc = "{$x['name']} discussion, fixtures and match threads on $site."; $body = '<h1>' . $h($x['name']) . '</h1>'; }
  } elseif ($path === '/') {
    // The homepage arrives already drawn with the site's own styles (Live Scores bar, space for the banner,
    // Trending list), so visitors see the real page at once; the app then fills in the rest in the same places.
    $lay = doc('LAYOUT'); $boards = array_column(doc('BOARDS'), 'name', 'slug');
    $ago = function (int $ms): string { $s = max(0, intdiv(now_ms() - $ms, 1000));
      return $s < 60 ? 'just now' : ($s < 3600 ? intdiv($s, 60) . 'm ago' : ($s < 86400 ? intdiv($s, 3600) . 'h ago' : intdiv($s, 86400) . 'd ago')); };
    $ts = array_values(array_filter($boot['topics'] ?? [], fn($t) => empty($t['archived']) && empty($t['deleted'])));
    $lastAt = fn($t) => (int) (end($t['posts'])['at'] ?? $t['at']);
    usort($ts, fn($a, $b) => ((int) !empty($b['pinned']) <=> (int) !empty($a['pinned'])) ?: ($lastAt($b) <=> $lastAt($a)));
    $rowsHtml = '';
    foreach (array_slice($ts, 0, 8) as $t) {
      $replies = max(0, count($t['posts'] ?? []) - 1);
      $counts = array_filter([($lay['statReplies'] ?? true) !== false ? "<strong class=\"num\">$replies</strong> replies" : '', ($lay['statViews'] ?? true) !== false ? '<span class="num">' . number_format((int) ($t['views'] ?? 0)) . '</span> views' : '']);
      $stats = ($counts ? '<div>' . implode(' · ', $counts) . '</div>' : '') . (($lay['statLast'] ?? true) !== false ? '<div>last ' . $ago($lastAt($t)) . '</div>' : '');
      $rowsHtml .= '<li' . (!empty($t['pinned']) ? ' class="pinned"' : '') . '><div style="min-width:0"><h4><a href="/topic/' . (int) $t['id'] . '">' . $h($t['title']) . '</a></h4><div class="meta">'
        . (isset($boards[$t['board']]) ? '<a href="/forum/' . $h($t['board']) . '">' . $h($boards[$t['board']]) . '</a>' : '') . (!empty($t['pinned']) ? '<span class="pill solid">Pinned</span>' : '')
        . '<span>by ' . $h($t['author']) . '</span></div></div>' . ($stats ? '<div class="stats">' . $stats . '</div>' : '') . '</li>';
    }
    $scores = (string) setting('scoresUrl', 'https://livescorenow.xyz');
    $body = '<div class="ssr-rich"><h1 class="sr">Pitchside Forum</h1>'
      . '<section class="ls-cta" aria-label="Live scores"><div class="ls-cta-txt"><span class="ls-dot" aria-hidden="true"></span><div><strong>Live Scores</strong><span>Scores, stats, lineups and odds on LiveScoreNow.</span></div></div>'
      . '<a class="ls-cta-btn" href="' . $h($scores) . '" target="_blank" rel="noopener">Open Live Scores <span aria-hidden="true">↗</span></a></section>'
      . (!empty($lay['homeBanner']) && empty($lay['clean']) ? '<div class="ssr-hero" aria-hidden="true"></div>' : '')
      . '<div class="cols"><div class="stack"><section><div class="spread" style="margin-bottom:10px"><h2 class="sec" style="margin:0">Trending right now</h2><a href="/forum">Forum index</a></div>'
      . '<div class="panel flush">' . ($rowsHtml ? '<ul class="tlist">' . $rowsHtml . '</ul>' : '<div class="empty">No topics yet.</div>') . '</div></section></div><aside class="stack"></aside></div></div>';
  }

  $shell = file_get_contents(APP_DIR . '/shell.html');
  $canonical = site_url($path === '/' ? '/' : rtrim($path, '/'));
  $head = '<title>' . $h($title) . '</title>
<meta name="description" content="' . $h($desc) . '">
<link rel="canonical" href="' . $h($canonical) . '">
<meta name="robots" content="' . ($index && $status === 200 ? 'index, follow' : 'noindex') . '">
<meta property="og:site_name" content="' . $site . '"><meta property="og:title" content="' . $h($title) . '"><meta property="og:description" content="' . $h($desc) . '"><meta property="og:url" content="' . $h($canonical) . '">';
  // The menu and the sign-in buttons, filled in on the server so the header is complete before the app script runs
  // (the app redraws them with the same look a moment later)
  $cur = '/' . ($seg[0] ?? '');
  $caret = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  $navHtml = '';
  foreach (doc('NAV') as $n) {
    if (empty($n['on'])) continue;
    $label = $h((string) ($n['label'] ?? ''));
    if (!empty($n['ext'])) $navHtml .= '<a href="' . $h((string) setting('scoresUrl', '#')) . '" target="_blank" rel="noopener">' . $label . ' <span aria-hidden="true">↗</span></a>';
    elseif (!empty($n['children'])) $navHtml .= '<button type="button" class="dd"' . (in_array($cur, $n['match'] ?? [], true) ? ' aria-current="page"' : '') . '>' . $label . $caret . '</button>';
    else $navHtml .= '<a href="' . $h((string) ($n['path'] ?? '/')) . '"' . ((($n['path'] ?? '') === $cur) ? ' aria-current="page"' : '') . '>' . $label . '</a>';
  }
  $userHtml = $u ? '<a class="who" href="/members/' . $h($u['name']) . '"><span class="avatar" aria-hidden="true">' . $h(strtoupper(mb_substr($u['name'], 0, 1))) . '</span><span>' . $h($u['name']) . '</span></a>'
    : '<button class="btn" type="button" data-act="signIn">Sign in</button><button class="btn primary" type="button" data-act="register">Join free</button>';
  // Will a side ad show? Then the page starts in the side-ad layout, so nothing shifts when the app takes over
  $lay = doc('LAYOUT'); $nowMs = now_ms(); $railL = false; $railR = false;
  if (!empty($lay['sideAds']) && empty($lay['clean'])) foreach (doc('SIDE_SLOTS') as $sl) {
    if (empty($sl['on'])) continue;
    foreach (doc('SIDE_ADS') as $ad) if (($ad['slot'] ?? '') === ($sl['id'] ?? '') && empty($ad['paused']) && (empty($ad['start']) || $ad['start'] <= $nowMs) && (empty($ad['end']) || $ad['end'] > $nowMs) && (empty($ad['gambling']) || $u)) {
      if ($sl['id'] === 'left') $railL = true; else $railR = true;
    }
  }
  $layoutCls = $railL || $railR ? ' has-rails' . ($railL ? '' : ' right-only') . ($railL && !$railR ? ' left-only' : '') : '';
  $json = json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
  http_response_code($status);
  echo str_replace(['<!--PS_HEAD-->', '<!--PS_VIEW-->', '<!--PS_BOOT-->', '<!--PS_NAV-->', '<!--PS_USER-->', '<!--PS_LAYOUT-->'],
    [$head, '<div class="ssr-copy">' . $body . '</div>', "<script>window.PS_BOOT=$json;</script>", $navHtml, $userHtml, $layoutCls], $shell);
} catch (Throwable $e) {
  error_log('[pitchside index] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  http_response_code(500);
  echo '<!doctype html><meta charset="utf-8"><title>Pitchside Forum</title><body style="font-family:system-ui;padding:40px"><h1>We\'ll be right back</h1><p>Pitchside Forum hit a problem loading this page. Try again in a minute.</p>';
}
