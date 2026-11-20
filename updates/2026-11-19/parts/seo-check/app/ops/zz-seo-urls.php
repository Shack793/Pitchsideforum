<?php
// Pitchside Forum: one address per page, so Google doesn't see duplicates.
//  - a casino or sportsbook only lives at the address the site links to (/casinos/x for casinos, /sportsbooks/x for
//    sportsbooks); the other one forwards there permanently
//  - /teams and /leagues (copies of the Sports page) forward to /sports; /reviews (a copy of Gambling) to /gambling
//  - an address ending in "/" forwards to the same address without it
//  - /live (a "live scores are on our other site" page) is not offered to search engines
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
  $suUri = (string) ($_SERVER['REQUEST_URI'] ?? '/'); $suPath = (string) parse_url($suUri, PHP_URL_PATH); $suQs = (string) parse_url($suUri, PHP_URL_QUERY);
  if (!preg_match('#^/(api|go|assets|uploads)/#', $suPath)) {
    $suTo = null;
    if ($suPath !== '/' && str_ends_with($suPath, '/') && preg_match('#^[/a-z0-9-]+$#', $suPath)) $suTo = rtrim($suPath, '/');
    $suClean = $suTo ?? $suPath;
    if (in_array($suClean, ['/teams', '/leagues'], true)) $suTo = '/sports';
    elseif ($suClean === '/reviews') $suTo = '/gambling';
    elseif (preg_match('#^/(casinos|sportsbooks)/([a-z0-9-]{1,64})$#', $suClean, $suM)) {
      try { $suR = row("SELECT data FROM operators WHERE slug = ?", [$suM[2]]); } catch (Throwable $e) { $suR = null; }
      if ($suR) { $suD = jdec((string) $suR['data'], []); $suRight = (($suD['type'] ?? '') === 'casino' ? '/casinos/' : '/sportsbooks/') . $suM[2]; if ($suRight !== $suClean) $suTo = $suRight; }
    }
    if ($suTo !== null && $suTo !== $suPath) { header('Location: ' . $suTo . ($suQs !== '' ? '?' . $suQs : ''), true, 301); exit; }
    if ($suPath === '/live') { header('X-Robots-Tag: noindex', true); ob_start(fn(string $h) => preg_replace('#<meta name="robots" content="[^"]*">#', '<meta name="robots" content="noindex">', $h, 1)); }
  }
  unset($suUri, $suPath, $suQs, $suTo, $suClean, $suM, $suR, $suD, $suRight);
}
