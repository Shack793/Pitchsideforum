<?php
// Accounts, sessions and sign-in security.
declare(strict_types=1);

const SESSION_COOKIE = 'ps_sid';
const SESSION_DAYS = 30;
const PROFILE_DEFAULTS = ['rep' => ['forum' => 0, 'market' => 0, 'review' => 0, 'prediction' => null], 'badges' => [], 'favTeams' => [], 'favSports' => [],
  'about' => '', 'website' => '', 'avatar' => null, 'avatarColor' => null, 'sig' => '', 'hideSigs' => false,
  'privacy' => ['dms' => 'members', 'showActivity' => true], 'notify' => ['email' => true, 'browser' => true, 'push' => false], 'wallets' => [], 'business' => null];

function user_from_row(?array $r): ?array {
  if (!$r) return null;
  $r['profile'] = array_replace(PROFILE_DEFAULTS, jdec($r['profile'] ?? null, []));
  foreach (['id', 'warnings', 'email_verified', 'posts', 'topics', 'likes', 'totp_on'] as $k) $r[$k] = (int) $r[$k];
  foreach (['joined', 'last_seen', 'updated'] as $k) $r[$k] = (int) $r[$k];
  // Suspensions end on their own
  if ($r['status'] === 'suspended' && $r['suspended_until'] && (int) $r['suspended_until'] < now_ms()) {
    q("UPDATE users SET status = 'active', suspended_until = NULL, updated = ? WHERE id = ?", [now_ms(), $r['id']]);
    $r['status'] = 'active'; $r['suspended_until'] = null;
  }
  return $r;
}
function user_by_name(string $name): ?array { return user_from_row(row("SELECT * FROM users WHERE name = ?", [$name])); }
function user_by_id(int $id): ?array { return user_from_row(row("SELECT * FROM users WHERE id = ?", [$id])); }
function save_profile(array $u, array $profile): void { q("UPDATE users SET profile = ?, updated = ? WHERE id = ?", [jenc($profile), now_ms(), $u['id']]); }
function touch_user(string $name): void { q("UPDATE users SET updated = ? WHERE name = ?", [now_ms(), $name]); }

/* ---------- Sessions ---------- */
$GLOBALS['SESSION'] = null;
function current_session(): ?array { return $GLOBALS['SESSION']; }
function load_session(): ?array {
  $sid = $_COOKIE[SESSION_COOKIE] ?? '';
  if (!preg_match('/^[a-f0-9]{64}$/', $sid)) return null;
  $s = row("SELECT * FROM sessions WHERE id = ?", [hash('sha256', $sid)]);
  if (!$s || (int) $s['last_seen'] < now_ms() - SESSION_DAYS * DAY_MS) return null;
  $u = user_by_id((int) $s['user_id']);
  if (!$u || $u['status'] === 'deleted') return null;
  if ((int) $s['last_seen'] < now_ms() - 60000) {
    q("UPDATE sessions SET last_seen = ? WHERE id = ?", [now_ms(), $s['id']]);
    q("UPDATE users SET last_seen = ? WHERE id = ?", [now_ms(), $u['id']]);
  }
  $s['user'] = $u;
  return $GLOBALS['SESSION'] = $s;
}
// The signed-in member, or null. A session waiting for its 2FA code doesn't count as signed in.
function viewer(): ?array { $s = current_session(); return $s && !(int) $s['pending_2fa'] ? $s['user'] : null; }
function need_user(): array { $u = viewer(); if (!$u) fail('Sign in to continue.', 401); return $u; }

function start_session(array $u, bool $pending2fa = false): array {
  $sid = rand_token(32); $csrf = rand_token(16);
  insert('sessions', ['id' => hash('sha256', $sid), 'user_id' => $u['id'], 'csrf' => $csrf, 'pending_2fa' => $pending2fa ? 1 : 0,
    'created' => now_ms(), 'last_seen' => now_ms(), 'ip' => client_ip(), 'ua' => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255)]);
  setcookie(SESSION_COOKIE, $sid, ['expires' => time() + SESSION_DAYS * 86400, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
  $s = row("SELECT * FROM sessions WHERE id = ?", [hash('sha256', $sid)]); $s['user'] = $u;
  return $GLOBALS['SESSION'] = $s;
}
function end_session(): void {
  $s = current_session(); if ($s) q("DELETE FROM sessions WHERE id = ?", [$s['id']]);
  setcookie(SESSION_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
  $GLOBALS['SESSION'] = null;
}
function is_https(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') || str_starts_with((string) cfg('site_url', ''), 'https://'); }
// Every change must carry the session's CSRF token in the X-CSRF header.
function check_csrf(): void {
  $s = current_session(); if (!$s) return;
  if (!hash_equals($s['csrf'], (string) ($_SERVER['HTTP_X_CSRF'] ?? ''))) fail('Your session expired. Reload the page and try again.', 419);
}

/* ---------- Passwords ---------- */
function hash_pw(string $p): string { return password_hash($p, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT); }
function pw_problem(string $p, string $name = '', string $email = ''): ?string {
  if (mb_strlen($p) < 8) return 'Password needs at least 8 characters.';
  if (mb_strlen($p) > 200) return 'That password is too long.';
  $l = strtolower($p);
  if (in_array($l, ['password', 'password1', '12345678', '123456789', 'qwertyui', 'iloveyou', 'football', 'pitchside'], true)) return 'That password is too common. Pick something harder to guess.';
  if ($name && str_contains($l, strtolower($name))) return "Your password can't contain your username.";
  return null;
}

/* ---------- One-time links (email verification, password reset) ---------- */
function make_token(int $userId, string $kind, int $ttlMs): string {
  $t = rand_token(32);
  q("DELETE FROM tokens WHERE user_id = ? AND kind = ?", [$userId, $kind]);
  insert('tokens', ['id' => hash('sha256', $t), 'user_id' => $userId, 'kind' => $kind, 'expires' => now_ms() + $ttlMs]);
  return $t;
}
function use_token(string $t, string $kind): ?array {
  if (!preg_match('/^[a-f0-9]{64}$/', $t)) return null;
  $r = row("SELECT * FROM tokens WHERE id = ? AND kind = ?", [hash('sha256', $t), $kind]);
  if (!$r) return null;
  q("DELETE FROM tokens WHERE id = ?", [$r['id']]);
  return (int) $r['expires'] > now_ms() ? user_by_id((int) $r['user_id']) : null;
}
function send_verify_email(array $u): void {
  $t = make_token($u['id'], 'verify', 3 * DAY_MS);
  send_mail($u['email'], 'Confirm your email for Pitchside Forum',
    "Hi {$u['name']},\n\nConfirm your email address to start posting:\n" . site_url("/verify?token=$t") . "\n\nThe link works for 3 days. If you didn't sign up, ignore this email.\n\nPitchside Forum");
}

/* ---------- Human check (Cloudflare Turnstile), optional ---------- */
function turnstile_ok(string $token): bool {
  $secret = cfg('turnstile_secret'); if (!$secret) return true;
  if ($token === '') return false;
  $ch = curl_init('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
    CURLOPT_POSTFIELDS => http_build_query(['secret' => $secret, 'response' => $token, 'remoteip' => client_ip()])]);
  $res = curl_exec($ch); curl_close($ch);
  return (bool) (jdec(is_string($res) ? $res : '', [])['success'] ?? false);
}
