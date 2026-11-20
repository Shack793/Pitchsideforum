<?php
// Pitchside Forum: faster page start. The page's scripts sit at the very end of the HTML, after the page data, so the
// browser only started fetching them once almost the whole page had arrived. This adds a "preload" line for each
// script at the top of the page, so they download at the same time as the rest of the page. It reads the script list
// from the page itself, so it always matches whatever scripts are installed.
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
  $spPath = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
  if (!preg_match('#^/(api|go|assets|uploads|share-image)/|^/(robots\.txt|sitemap\.xml|sitemap\.php)$#', $spPath)) {
    ob_start(function (string $html): string {
      $head = stripos($html, '</head>');
      if ($head === false || str_contains($html, 'id="ps-preload"')) return $html;
      if (!preg_match_all('#<script src="(/assets/[A-Za-z0-9._-]+\.js)"#', $html, $m)) return $html;
      $links = '';
      foreach (array_unique($m[1]) as $src) $links .= '<link rel="preload" as="script" href="' . htmlspecialchars($src, ENT_QUOTES) . '">';
      return substr($html, 0, $head) . '<meta id="ps-preload" name="x-preload" content="1">' . $links . "\n" . substr($html, $head);
    });
  }
  unset($spPath);
}
