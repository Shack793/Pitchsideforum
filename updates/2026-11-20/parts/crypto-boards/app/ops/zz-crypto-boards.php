<?php
// Pitchside Forum: old crypto board addresses (/forum/bitcoin and so on) forward to the board they were merged into.
// The list is saved as BOARD_MOVED by the crypto-boards update.
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
  $cbPath = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
  if (preg_match('#^/forum/([a-z0-9-]{1,64})/?$#', $cbPath, $cbM)) {
    try { $cbTo = doc('BOARD_MOVED')[$cbM[1]] ?? null; } catch (Throwable $e) { $cbTo = null; }
    if (is_string($cbTo) && preg_match('/^[a-z0-9-]{1,64}$/', $cbTo)) { header('Location: /forum/' . $cbTo, true, 301); exit; }
  }
  unset($cbPath, $cbM, $cbTo);
}
