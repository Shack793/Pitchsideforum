<?php
// Pitchside Forum: member pages and search engines.
//   - The member list (/members) and the staff list (/staff) are kept out of Google and other search engines
//     ("noindex"), so the whole list of members can't be found there.
//   - Each member's own profile (/members/name) can be found in search engines, while the site is open to them
//     (Admin → SEO) and the account is active. Banned, suspended or deleted accounts stay out.
// Nothing changes for visitors on the site itself.
declare(strict_types=1);

(function () {
  if (PHP_SAPI === 'cli' || headers_sent()) return;
  $path = rawurldecode((string) (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/'));
  if (preg_match('#^/(members|staff)/?$#i', $path)) {
    header('X-Robots-Tag: noindex, follow', true);
    ob_start(fn(string $html) => str_replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, follow">', $html));
    return;
  }
  if (preg_match('#^/members/([^/]{1,64})/?$#', $path, $m)) {
    try {
      if (!setting('siteIndexing')) return;
      $u = row("SELECT name, status FROM users WHERE name = ?", [$m[1]]);
      if (!$u || $u['status'] !== 'active') return;
      $name = htmlspecialchars((string) $u['name'], ENT_QUOTES, 'UTF-8');
      ob_start(fn(string $html) => preg_replace(
        ['#<meta name="robots" content="noindex">#', '#<meta name="description" content="[^"]*">#'],
        ['<meta name="robots" content="index, follow">', '<meta name="description" content="' . $name . ' on Pitchside Forum: posts, reviews, favourite teams and reputation.">'],
        $html, 1));
    } catch (Throwable $e) { /* leave the page as it is */ }
  }
})();
