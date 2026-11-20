<?php
// Pitchside Forum: pages that don't exist answer "404 Not Found" (with noindex) instead of an indexable copy of the
// homepage, so search engines don't list empty or closed pages. Covers unknown addresses, unknown leagues, teams,
// tags and events, boards guests can't read (e.g. the closed Marketplace boards) and sections that are switched off.
// The app still draws its own "Not here" or "Opening soon" message for visitors.
declare(strict_types=1);

function ps_page_missing(string $path): bool {
  $seg = array_values(array_filter(explode('/', $path), 'strlen')); $s0 = $seg[0] ?? ''; $s1 = $seg[1] ?? null;
  foreach (doc('SEO') as $s) if (($s['path'] ?? '') === $path) return false;
  $known = ['', 'forum', 'topic', 'tag', 'tags', 'sports', 'leagues', 'teams', 'events', 'live', 'gambling', 'reviews', 'casinos', 'sportsbooks', 'blacklist', 'go',
    'complaints', 'marketplace', 'escrow', 'get-verified', 'crypto', 'community', 'members', 'staff', 'search', 'notifications', 'messages', 'mod', 'admin',
    'settings', 'page', 'raffle', 'promotions', 'reset', 'verify', 'share-image'];
  if (!in_array($s0, $known, true)) return true;
  $has = fn(string $doc, string $slug) => (bool) array_filter((array) doc($doc), fn($x) => is_array($x) && ($x['slug'] ?? '') === $slug);
  if ($s1 === null && in_array($s0, ['tag', 'events'], true)) return true;   // these only exist with a name after them
  if ($s1 !== null) {
    if ($s0 === 'leagues') return !$has('LEAGUES', $s1);
    if ($s0 === 'teams') return !$has('TEAMS', $s1);
    if ($s0 === 'events') return !$has('EVENTS', $s1);
    if ($s0 === 'tag') return !$has('TAGS', $s1);
    if ($s0 === 'page') return !in_array($s1, ['rules', 'terms', 'privacy', 'cookies', 'gambling', 'disclosures', 'dmca', 'advertise', 'moderators', 'safety-index', 'escrow'], true) || ($s1 === 'escrow' && !feature_on('escrow'));
    if ($s0 === 'forum') { $b = board_doc($s1); return $b !== null && !can_read_board(null, $b); }   // unknown boards are already 404
  }
  $off = ['marketplace' => 'marketplace', 'escrow' => 'escrow', 'get-verified' => 'verification'];
  if (isset($off[$s0]) && !feature_on($off[$s0])) return true;
  if ($s0 === 'forum' && $s1 !== null) { $b = board_doc($s1); if ($b && ($b['cat'] ?? '') === 'market' && !feature_on('marketplace')) return true; }
  return false;
}

if (PHP_SAPI !== 'cli' && in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
  $psPath = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
  if ($psPath !== '' && !preg_match('#^/(api|go|assets|uploads)/|^/(robots\.txt|sitemap\.xml|sitemap\.php|favicon\.ico|manifest\.json)$#', $psPath)) {
    $psMissing = false; try { $psMissing = ps_page_missing($psPath); } catch (Throwable $e) {}
    if ($psMissing) {
      header('X-Robots-Tag: noindex', true);
      ob_start(fn(string $html) => preg_replace('#<meta name="robots" content="[^"]*">#', '<meta name="robots" content="noindex">', $html, 1));
      register_shutdown_function(function () { if (!headers_sent() && http_response_code() === 200) http_response_code(404); });
    }
    unset($psMissing);
  }
  unset($psPath);
}
