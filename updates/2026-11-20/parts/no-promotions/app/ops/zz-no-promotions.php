<?php
// Pitchside Forum: the Promotions & bonuses page is switched off. Its address (/promotions) sends visitors and
// search engines to the Gambling page instead (a permanent redirect), so old links and Google results still work.
declare(strict_types=1);

(function () {
  if (PHP_SAPI === 'cli' || headers_sent()) return;
  $path = (string) (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
  if (preg_match('#^/promotions/?$#i', $path)) { header('Location: /gambling', true, 301); exit; }
})();
