<?php
// Two-factor sign-in codes (RFC 6238, the 6-digit codes from Google Authenticator, Authy, 1Password…).
declare(strict_types=1);

function b32_encode(string $bin): string {
  $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
  foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
  foreach (str_split($bits, 5) as $chunk) $out .= $a[bindec(str_pad($chunk, 5, '0'))];
  return $out;
}
function b32_decode(string $s): string {
  $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
  foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s))) as $c) $bits .= str_pad(decbin(strpos($a, $c)), 5, '0', STR_PAD_LEFT);
  foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
  return $out;
}
function totp_new_secret(): string { return b32_encode(random_bytes(20)); }
function totp_code(string $secret, int $step): string {
  $h = hash_hmac('sha1', pack('N2', 0, $step), b32_decode($secret), true);
  $o = ord($h[19]) & 0xf;
  $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
  return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
}
function totp_check(string $secret, string $code): bool {
  if (!preg_match('/^\d{6}$/', $code)) return false;
  $step = intdiv(time(), 30);
  for ($i = -1; $i <= 1; $i++) if (hash_equals(totp_code($secret, $step + $i), $code)) return true;
  return false;
}
