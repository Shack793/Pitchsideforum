<?php
// Pitchside Forum: "Keep me signed in". The sign-in form gets a tick box.
//   Ticked:   the member stays signed in on that device for 30 days (as before).
//   Unticked: the sign-in ends when the browser is closed, or after 12 hours without using the site.
// Passwords are never stored on the device either way; only a random sign-in pass is.
declare(strict_types=1);

const RM_SHORT_IDLE_MS = 12 * 3600 * 1000;
function rm_key(string $sid): string { return 'ss:' . substr(hash('sha256', $sid), 0, 40); }

// Short sign-ins end after 12 hours without activity
(function () {
  if (PHP_SAPI === 'cli') return;
  $sid = $_COOKIE[SESSION_COOKIE] ?? '';
  if (!preg_match('/^[a-f0-9]{64}$/', $sid)) return;
  try {
    $at = meta_get(rm_key($sid)); if ($at === null) return;
    $s = row("SELECT last_seen FROM sessions WHERE id = ?", [hash('sha256', $sid)]);
    if (!$s) { q("DELETE FROM meta WHERE k = ?", [rm_key($sid)]); return; }
    if ((int) $s['last_seen'] < now_ms() - RM_SHORT_IDLE_MS) {
      q("DELETE FROM sessions WHERE id = ?", [hash('sha256', $sid)]); q("DELETE FROM meta WHERE k = ?", [rm_key($sid)]);
      unset($_COOKIE[SESSION_COOKIE]);
    }
  } catch (Throwable $e) {}
})();

(function () {
  if (!isset($GLOBALS['OPS']['auth.login'])) return;
  $ops = &$GLOBALS['OPS'];
  [$base, $need] = $ops['auth.login'];
  $ops['auth.login'] = [function (array $in, ...$rest) use ($base) {
    $res = $base($in, ...$rest);
    if (!empty($in['remember']) || headers_sent()) return $res;
    // turn the 30-day sign-in cookie into one that ends when the browser closes
    $sid = null; $others = [];
    foreach (headers_list() as $h) {
      if (stripos($h, 'Set-Cookie:') !== 0) continue;
      if (preg_match('/^Set-Cookie:\s*' . preg_quote(SESSION_COOKIE, '/') . '=([a-f0-9]{64})/i', $h, $m)) $sid = $m[1]; else $others[] = $h;
    }
    if (!$sid) return $res;
    header_remove('Set-Cookie');
    foreach ($others as $h) header($h, false);
    setcookie(SESSION_COOKIE, $sid, ['path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
    try {
      meta_set(rm_key($sid), (string) now_ms());
      if (random_int(1, 50) === 1) q("DELETE FROM meta WHERE k LIKE 'ss:%' AND CAST(v AS DECIMAL(20,0)) < ?", [now_ms() - 31 * DAY_MS]);
    } catch (Throwable $e) {}
    return $res;
  }, $need];
})();
