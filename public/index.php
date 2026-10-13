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
  $topicLi = fn(array $t) => '<li><a href="/topic/' . (int) $t['id'] . '">' . $h($t['title']) . '</a> <small>' . (count($t['posts']) - 1) . ' replies</small></li>';
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
  } elseif (($seg[0] ?? '') === 'teams' || ($seg[0] ?? '') === 'leagues') {
    $list = doc($seg[0] === 'teams' ? 'TEAMS' : 'LEAGUES');
    foreach ($list as $x) if (($x['slug'] ?? '') === ($seg[1] ?? '')) { $title = $x['name'] . ($seg[0] === 'teams' ? ' fans forum' : ' forum') . " | $site"; $desc = "{$x['name']} discussion, fixtures and match threads on $site."; $body = '<h1>' . $h($x['name']) . '</h1>'; }
  } elseif ($path === '/') {
    $body = '<h1>Pitchside Forum</h1><h2>Trending</h2><ul>' . implode('', array_map($topicLi, array_slice($boot['topics'] ?? [], 0, 20))) . '</ul>';
  }

  $shell = file_get_contents(APP_DIR . '/shell.html');
  $canonical = site_url($path === '/' ? '/' : rtrim($path, '/'));
  $head = '<title>' . $h($title) . '</title>
<meta name="description" content="' . $h($desc) . '">
<link rel="canonical" href="' . $h($canonical) . '">
<meta name="robots" content="' . ($index && $status === 200 ? 'index, follow' : 'noindex') . '">
<meta property="og:site_name" content="' . $site . '"><meta property="og:title" content="' . $h($title) . '"><meta property="og:description" content="' . $h($desc) . '"><meta property="og:url" content="' . $h($canonical) . '">';
  $json = json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
  http_response_code($status);
  echo str_replace(['<!--PS_HEAD-->', '<!--PS_VIEW-->', '<!--PS_BOOT-->'], [$head, $body, "<script>window.PS_BOOT=$json;</script>"], $shell);
} catch (Throwable $e) {
  error_log('[pitchside index] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  http_response_code(500);
  echo '<!doctype html><meta charset="utf-8"><title>Pitchside Forum</title><body style="font-family:system-ui;padding:40px"><h1>We\'ll be right back</h1><p>Pitchside Forum hit a problem loading this page. Try again in a minute.</p>';
}
