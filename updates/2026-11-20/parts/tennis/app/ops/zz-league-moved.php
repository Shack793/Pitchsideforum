<?php
// Pitchside Forum: league pages that were merged (for example /leagues/atp and /leagues/wta into /leagues/tennis)
// forward to the page they were merged into. The list is saved as LEAGUE_MOVED.
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
  $lmPath = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
  if (preg_match('#^/leagues/([a-z0-9-]{1,64})/?$#', $lmPath, $lmM)) {
    try { $lmTo = doc('LEAGUE_MOVED')[$lmM[1]] ?? null; } catch (Throwable $e) { $lmTo = null; }
    if (is_string($lmTo) && preg_match('/^[a-z0-9-]{1,64}$/', $lmTo)) { header('Location: /leagues/' . $lmTo, true, 301); exit; }
  }
  unset($lmPath, $lmM, $lmTo);
}
