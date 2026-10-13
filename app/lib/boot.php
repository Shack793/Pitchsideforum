<?php
// Pitchside Forum: shared bootstrap (config, database, helpers). Every entry point requires this file.
declare(strict_types=1);

define('APP_DIR', dirname(__DIR__));
define('PUBLIC_DIR', dirname(APP_DIR) . '/public');

$cfgFile = getenv('PITCHSIDE_CONFIG') ?: APP_DIR . '/config.php';
if (!is_file($cfgFile)) { http_response_code(500); exit("Pitchside isn't installed yet: config.php is missing. Run setup.sh."); }
$GLOBALS['CFG'] = require $cfgFile;
function cfg(string $k, $def = null) { return $GLOBALS['CFG'][$k] ?? $def; }

date_default_timezone_set('UTC');
error_reporting(E_ALL);
ini_set('display_errors', cfg('debug') ? '1' : '0');
ini_set('log_errors', '1');
if (!ini_get('error_log')) ini_set('error_log', APP_DIR . '/storage/php-error.log');

function now_ms(): int { return (int) floor(microtime(true) * 1000); }
const DAY_MS = 86400000;

/* ---------- Database ---------- */
function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $driver = cfg('db_driver', 'mysql');
  if ($driver === 'sqlite') {
    $pdo = new PDO('sqlite:' . cfg('db_path'));
    $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;');
  } else {
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', cfg('db_host', '127.0.0.1'), (int) cfg('db_port', 3306), cfg('db_name'));
    $pdo = new PDO($dsn, cfg('db_user'), cfg('db_pass'), [PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+00:00', sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO'",
      PDO::MYSQL_ATTR_FOUND_ROWS => true]);   // rowCount() = rows matched, like SQLite
  }
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
  return $pdo;
}
function q(string $sql, array $args = []): PDOStatement { $st = db()->prepare($sql); $st->execute($args); return $st; }
function row(string $sql, array $args = []): ?array { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function rows(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }
function val(string $sql, array $args = []) { $r = q($sql, $args)->fetchColumn(); return $r === false ? null : $r; }
function insert(string $table, array $data): int {
  $cols = array_keys($data);
  q("INSERT INTO $table (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")", array_values($data));
  return (int) db()->lastInsertId();
}
// Insert, or do nothing if the primary key already exists (portable INSERT IGNORE).
function insert_ignore(string $table, array $data): bool {
  try { insert($table, $data); return true; }
  catch (PDOException $e) { if (is_dup($e)) return false; throw $e; }
}
function is_dup(PDOException $e): bool { $c = (string) $e->getCode(); return $c === '23000' || $c === '23505' || str_contains($e->getMessage(), 'UNIQUE'); }
function in_list(array $xs): string { return $xs ? implode(',', array_fill(0, count($xs), '?')) : 'NULL'; }
function tx(callable $fn) {
  $pdo = db(); if ($pdo->inTransaction()) return $fn();
  $pdo->beginTransaction();
  try { $r = $fn(); $pdo->commit(); return $r; } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}
function jdec(?string $s, $def = null) { if ($s === null || $s === '') return $def; $v = json_decode($s, true); return $v === null ? $def : $v; }
function jenc($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

/* ---------- Requests and responses ---------- */
final class ApiError extends Exception {
  public int $status; public array $extra;
  public function __construct(string $msg, int $status = 400, array $extra = []) { parent::__construct($msg); $this->status = $status; $this->extra = $extra; }
}
function fail(string $msg, int $status = 400, array $extra = []): never { throw new ApiError($msg, $status, $extra); }
function json_out($data, int $status = 200): never {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo jenc($data);
  exit;
}
function client_ip(): string {
  // Behind Nginx on the same box REMOTE_ADDR is the visitor. If you add Cloudflare, set trust_cf_ip in config.php.
  if (cfg('trust_cf_ip') && !empty($_SERVER['HTTP_CF_CONNECTING_IP'])) return substr($_SERVER['HTTP_CF_CONNECTING_IP'], 0, 64);
  return substr($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', 0, 64);
}
function str_in(array $in, string $k, int $max = 10000, string $def = ''): string {
  $v = $in[$k] ?? $def; if (!is_string($v) && !is_numeric($v)) $v = $def;
  $v = trim((string) $v);
  $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
  if (mb_strlen($v) > $max) fail("That's too long (the limit is $max characters).");
  return $v;
}
function int_in(array $in, string $k, int $def = 0): int { return isset($in[$k]) && is_numeric($in[$k]) ? (int) $in[$k] : $def; }
function bool_in(array $in, string $k): bool { return !empty($in[$k]) && $in[$k] !== 'false'; }
function arr_in(array $in, string $k): array { return isset($in[$k]) && is_array($in[$k]) ? $in[$k] : []; }

/* ---------- Rate limits ---------- */
// Allows $max hits per $windowSec for key; throws a friendly 429 otherwise.
function rate_limit(string $key, int $max, int $windowSec, string $msg = "You're doing that too often. Wait a little and try again."): void {
  if (strlen($key) > 150) $key = substr($key, 0, 100) . ':' . sha1($key);
  $win = intdiv(time(), $windowSec) * $windowSec;   // window start, in seconds
  $n = q("UPDATE rate_hits SET n = n + 1 WHERE k = ? AND win = ?", [$key, $win])->rowCount();
  if (!$n && !insert_ignore('rate_hits', ['k' => $key, 'win' => $win, 'n' => 1])) q("UPDATE rate_hits SET n = n + 1 WHERE k = ? AND win = ?", [$key, $win]);
  $c = (int) val("SELECT n FROM rate_hits WHERE k = ? AND win = ?", [$key, $win]);
  if ($c > $max) fail($msg, 429);
}

function meta_get(string $k, ?string $def = null): ?string { $v = val("SELECT v FROM meta WHERE k = ?", [$k]); return $v === null ? $def : (string) $v; }
function meta_set(string $k, string $v): void { if (!q("UPDATE meta SET v = ? WHERE k = ?", [$v, $k])->rowCount() && !insert_ignore('meta', ['k' => $k, 'v' => $v])) q("UPDATE meta SET v = ? WHERE k = ?", [$v, $k]); }
function slugify(string $s): string { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)) ?? '', '-'); }
function rand_token(int $bytes = 32): string { return bin2hex(random_bytes($bytes)); }
function site_url(string $path = ''): string { return rtrim((string) cfg('site_url', ''), '/') . $path; }
function log_line(string $file, string $line): void { @file_put_contents(APP_DIR . "/storage/$file", '[' . gmdate('c') . "] $line\n", FILE_APPEND | LOCK_EX); }
