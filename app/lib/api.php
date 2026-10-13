<?php
// Loads every library and operation. Entry points (public/api.php, cron.php, install.php) include this file.
declare(strict_types=1);
require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/docs.php';
require_once __DIR__ . '/perm.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/totp.php';
require_once __DIR__ . '/serialize.php';

$GLOBALS['OPS'] = [];
// Registers an operation the browser can call: POST /api/op {"op": name, ...}
function op(string $name, callable $fn, bool $needUser = true): void { $GLOBALS['OPS'][$name] = [$fn, $needUser]; }
function run_op(string $name, array $in) {
  $o = $GLOBALS['OPS'][$name] ?? null; if (!$o) fail('Unknown action.', 404);
  [$fn, $needUser] = $o;
  $u = viewer();
  if ($needUser && !$u) fail('Sign in to continue.', 401);
  return $fn($in, $u);
}
foreach (glob(APP_DIR . '/ops/*.php') as $f) require_once $f;
