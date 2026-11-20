<?php
// Pitchside Forum: football has no team pages. /teams/<club> for a football club sends the visitor (and search
// engines, with a permanent redirect) to the club's league page. sports_team_listed() keeps them out of the sitemap.
declare(strict_types=1);

function sports_team_league(string $slug): ?string {
  foreach (doc('TEAMS') as $t) if (($t['slug'] ?? '') === $slug) {
    foreach (doc('LEAGUES') as $l) if (($l['slug'] ?? '') === ($t['league'] ?? '')) return ($l['sport'] ?? '') === 'football' ? (string) $l['slug'] : null;
    return null;
  }
  return null;
}
function sports_team_listed(array $t): bool { return sports_team_league((string) ($t['slug'] ?? '')) === null; }

if (PHP_SAPI !== 'cli' && in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
  $sportsTidyPath = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
  if (preg_match('#^/teams/([a-z0-9-]{1,64})/?$#', $sportsTidyPath, $m)) {
    try { $lg = sports_team_league($m[1]); } catch (Throwable $e) { $lg = null; }
    if ($lg !== null) { header('Location: /leagues/' . $lg, true, 301); exit; }
  }
  unset($sportsTidyPath, $m, $lg);
}
