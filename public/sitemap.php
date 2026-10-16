<?php
// /sitemap.xml: public boards, topics, leagues and teams, for search engines (only once indexing is switched on).
declare(strict_types=1);
require dirname(__DIR__) . '/app/lib/api.php';
header('Content-Type: application/xml; charset=utf-8');
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
if (setting('siteIndexing')) {
  $url = fn(string $p, ?int $ms = null) => '<url><loc>' . htmlspecialchars(site_url($p), ENT_XML1) . '</loc>' . ($ms ? '<lastmod>' . gmdate('Y-m-d', intdiv($ms, 1000)) . '</lastmod>' : '') . "</url>\n";
  echo $url('/');
  $public = [];
  foreach (doc('BOARDS') as $b) if (can_read_board(null, $b)) { $public[] = $b['slug']; echo $url('/forum/' . $b['slug']); }
  foreach (doc('LEAGUES') as $l) echo $url('/leagues/' . $l['slug']);
  foreach (doc('TEAMS') as $t) echo $url('/teams/' . $t['slug']);
  if (feature_on('casinos')) { foreach (rows("SELECT slug, data, updated FROM operators") as $o) { $d = json_decode($o['data'], true); echo $url((($d['type'] ?? '') === 'casino' ? '/casinos/' : '/sportsbooks/') . $o['slug'], (int) $o['updated']); } echo $url('/casinos') . $url('/blacklist'); }
  if (feature_on('complaints')) { echo $url('/complaints'); foreach (rows("SELECT id, updated FROM complaints ORDER BY seq DESC LIMIT 5000") as $c) echo $url('/complaints/' . $c['id'], (int) $c['updated']); }
  if ($public) foreach (rows("SELECT id, last_at FROM topics WHERE deleted = 0 AND board IN (" . in_list($public) . ") ORDER BY last_at DESC LIMIT 45000", $public) as $t) echo $url('/topic/' . $t['id'], (int) $t['last_at']);
}
echo '</urlset>';
