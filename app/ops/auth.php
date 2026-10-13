<?php
// Sign-in, sign-up, password reset, email verification, two-factor and account deletion.
declare(strict_types=1);

const RESERVED_NAMES = ['admin', 'administrator', 'system', 'pitchside', 'pitchside_forum', 'moderator', 'mod', 'staff', 'root', 'support', 'help', 'official', 'deleted_user', 'guest', 'null', 'undefined'];

op('auth.login', function (array $in) {
  $id = strtolower(str_in($in, 'u', 190)); $p = (string) ($in['p'] ?? '');
  rate_limit('login-ip:' . client_ip(), 30, 900, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  rate_limit('login-user:' . $id, 10, 900, 'Too many sign-in attempts for this account. Wait 15 minutes, or reset your password.');
  $u = user_from_row(row("SELECT * FROM users WHERE LOWER(name) = ? OR LOWER(email) = ?", [$id, $id]));
  if (!$u || $u['status'] === 'deleted' || !password_verify($p, $u['pass'])) { usleep(random_int(150000, 350000)); fail('That username or password is wrong.', 401); }
  if (password_needs_rehash($u['pass'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT)) q("UPDATE users SET pass = ? WHERE id = ?", [hash_pw($p), $u['id']]);
  if ($u['delete_after']) { q("UPDATE users SET delete_after = NULL, updated = ? WHERE id = ?", [now_ms(), $u['id']]); }
  if ($u['totp_on']) { start_session($u, true); return ['need2fa' => true]; }
  start_session($u);
  return ['name' => $u['name'], 'restored' => (bool) $u['delete_after']];
}, false);

op('auth.2fa', function (array $in) {
  $s = current_session(); if (!$s || !(int) $s['pending_2fa']) fail('Sign in first.', 401);
  rate_limit('2fa:' . $s['id'], 8, 900, 'Too many wrong codes. Sign in again in 15 minutes.');
  $u = $s['user'];
  if (!$u['totp_secret'] || !totp_check($u['totp_secret'], str_in($in, 'code', 12))) fail("That code didn't match. Use the current 6-digit code from your authenticator app.");
  q("UPDATE sessions SET pending_2fa = 0 WHERE id = ?", [$s['id']]);
  $GLOBALS['SESSION']['pending_2fa'] = 0;
  return ['name' => $u['name']];
}, false);

op('auth.register', function (array $in) {
  rate_limit('register-ip:' . client_ip(), 5, 3600, 'Too many new accounts from your connection. Try again in an hour.');
  if (!turnstile_ok(str_in($in, 'ts', 4000))) fail("Please complete the human check.");
  $name = str_in($in, 'u', 40); $email = strtolower(str_in($in, 'e', 190)); $p = (string) ($in['p'] ?? '');
  $name = strtolower(preg_replace('/[^A-Za-z0-9_]+/', '_', $name) ?? ''); $name = trim($name, '_');
  if (strlen($name) < 3 || strlen($name) > 24) fail('Pick a username with 3 to 24 letters, numbers or underscores.');
  if (in_array($name, RESERVED_NAMES, true) || str_starts_with($name, 'deleted_user')) fail('That username is reserved. Pick another.');
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
  if ($pr = pw_problem($p, $name, $email)) fail($pr);
  if (!bool_in($in, 'tos')) fail('Accept the Terms to continue.');
  if (val("SELECT 1 FROM users WHERE name = ?", [$name])) fail('That username is taken.');
  if (val("SELECT 1 FROM users WHERE email = ?", [$email])) fail('There is already an account with that email. Sign in, or reset your password.');
  $now = now_ms();
  $profile = PROFILE_DEFAULTS; $profile['ageOk'] = bool_in($in, 'age');
  $id = insert('users', ['name' => $name, 'email' => $email, 'pass' => hash_pw($p), 'role' => 'new_member', 'status' => 'active', 'warnings' => 0,
    'email_verified' => mail_ready() ? 0 : 1, 'joined' => $now, 'posts' => 0, 'topics' => 0, 'likes' => 0, 'profile' => jenc($profile), 'totp_on' => 0,
    'last_seen' => $now, 'updated' => $now]);
  $u = user_by_id($id);
  if (mail_ready()) send_verify_email($u);
  start_session($u);
  return ['name' => $name, 'verify' => mail_ready()];
}, false);

op('auth.logout', function () { end_session(); return []; }, false);

op('auth.logoutAll', function (array $in, array $u) {
  $s = current_session();
  $n = q("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [$u['id'], $s['id']])->rowCount();
  return ['ended' => $n];
});

op('auth.sessions', function (array $in, array $u) {
  $s = current_session();
  return ['sessions' => array_map(fn($r) => ['current' => $r['id'] === $s['id'], 'created' => (int) $r['created'], 'lastSeen' => (int) $r['last_seen'], 'ip' => $r['ip'], 'ua' => $r['ua']],
    rows("SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 20", [$u['id']]))];
});

op('auth.resetRequest', function (array $in) {
  rate_limit('reset-ip:' . client_ip(), 5, 3600);
  $email = strtolower(str_in($in, 'e', 190));
  $u = user_from_row(row("SELECT * FROM users WHERE email = ? AND status <> 'deleted'", [$email]));
  if ($u) {
    rate_limit('reset-user:' . $u['id'], 3, 3600);
    $t = make_token($u['id'], 'reset', 3600000);
    send_mail($u['email'], 'Reset your Pitchside Forum password', "Hi {$u['name']},\n\nSomeone (hopefully you) asked to reset your password. Choose a new one here:\n" . site_url("/reset?token=$t") .
      "\n\nThe link works for 1 hour. If you didn't ask, ignore this email; your password stays the same.\n\nPitchside Forum");
  }
  return [];
}, false);

op('auth.resetConfirm', function (array $in) {
  rate_limit('reset-confirm:' . client_ip(), 10, 3600);
  $p = (string) ($in['p'] ?? '');
  $u = use_token(str_in($in, 'token', 100), 'reset');
  if (!$u) fail('That reset link has expired or was already used. Ask for a new one.');
  if ($pr = pw_problem($p, $u['name'])) fail($pr);
  q("UPDATE users SET pass = ?, email_verified = 1, updated = ? WHERE id = ?", [hash_pw($p), now_ms(), $u['id']]);
  q("DELETE FROM sessions WHERE user_id = ?", [$u['id']]);
  $u = user_by_id($u['id']);
  if ($u['totp_on']) { start_session($u, true); return ['need2fa' => true]; }
  start_session($u);
  return ['name' => $u['name']];
}, false);

op('auth.verify', function (array $in) {
  $u = use_token(str_in($in, 'token', 100), 'verify');
  if (!$u) fail('That confirmation link has expired or was already used. Sign in and ask for a new one.');
  q("UPDATE users SET email_verified = 1, updated = ? WHERE id = ?", [now_ms(), $u['id']]);
  return ['name' => $u['name']];
}, false);

op('auth.resendVerify', function (array $in, array $u) {
  rate_limit('verify-mail:' . $u['id'], 3, 3600);
  if ($u['email_verified']) return ['already' => true];
  send_verify_email($u);
  return [];
}, true, true);

op('auth.changePassword', function (array $in, array $u) {
  rate_limit('pwchange:' . $u['id'], 10, 3600);
  if (!password_verify((string) ($in['old'] ?? ''), $u['pass'])) fail('Your current password is wrong.');
  $p = (string) ($in['p'] ?? ''); if ($pr = pw_problem($p, $u['name'])) fail($pr);
  q("UPDATE users SET pass = ? WHERE id = ?", [hash_pw($p), $u['id']]);
  q("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [$u['id'], current_session()['id']]);
  return [];
});

op('auth.changeEmail', function (array $in, array $u) {
  rate_limit('emailchange:' . $u['id'], 5, 3600);
  if (!password_verify((string) ($in['p'] ?? ''), $u['pass'])) fail('Your password is wrong.');
  $e = strtolower(str_in($in, 'e', 190)); if (!filter_var($e, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
  if (val("SELECT 1 FROM users WHERE email = ? AND id <> ?", [$e, $u['id']])) fail('Another account uses that email.');
  q("UPDATE users SET email = ?, email_verified = ?, updated = ? WHERE id = ?", [$e, mail_ready() ? 0 : 1, now_ms(), $u['id']]);
  if (mail_ready()) send_verify_email(user_by_id($u['id']));
  return ['verify' => mail_ready()];
});

op('auth.totpSetup', function (array $in, array $u) {
  if ($u['totp_on']) fail('Two-factor is already on.');
  $secret = totp_new_secret();
  q("UPDATE users SET totp_secret = ? WHERE id = ?", [$secret, $u['id']]);
  $label = rawurlencode('Pitchside Forum:' . $u['name']);
  return ['secret' => $secret, 'uri' => "otpauth://totp/$label?secret=$secret&issuer=" . rawurlencode('Pitchside Forum') . '&digits=6&period=30'];
});
op('auth.totpEnable', function (array $in, array $u) {
  rate_limit('totp-enable:' . $u['id'], 10, 900);
  if (!$u['totp_secret'] || !totp_check($u['totp_secret'], str_in($in, 'code', 12))) fail("That code didn't match. Check the time on your phone is set automatically, then try the newest code.");
  q("UPDATE users SET totp_on = 1, updated = ? WHERE id = ?", [now_ms(), $u['id']]);
  q("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [$u['id'], current_session()['id']]);
  return [];
});
op('auth.totpDisable', function (array $in, array $u) {
  rate_limit('totp-disable:' . $u['id'], 10, 900);
  if (!password_verify((string) ($in['p'] ?? ''), $u['pass'])) fail('Enter your password to turn two-factor off.');
  q("UPDATE users SET totp_on = 0, totp_secret = NULL, updated = ? WHERE id = ?", [now_ms(), $u['id']]);
  return [];
});

op('account.delete', function (array $in, array $u) {
  if (str_in($in, 'u', 40) !== $u['name']) fail('Type your username exactly to confirm.');
  if (!password_verify((string) ($in['p'] ?? ''), $u['pass'])) fail('Your password is wrong.');
  if ($u['role'] === 'super_admin' && (int) val("SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND status = 'active'") < 2) fail("You're the only Super Admin. Make someone else Super Admin first.");
  q("UPDATE users SET delete_after = ?, updated = ? WHERE id = ?", [now_ms() + 30 * DAY_MS, now_ms(), $u['id']]);
  q("DELETE FROM sessions WHERE user_id = ?", [$u['id']]);
  end_session();
  return [];
});
