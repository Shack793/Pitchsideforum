<?php
// Writes the SMTP settings into app/config.php (keeps everything else). Prints OK or a reason.
$f = $argv[1]; $s = (string) file_get_contents($f);
$vals = ['smtp_host' => getenv('HOST'), 'smtp_port' => (int) getenv('PORT'), 'smtp_secure' => getenv('SEC'), 'smtp_user' => getenv('USER_'),
  'smtp_pass' => getenv('PASS'), 'mail_from' => getenv('FROM'), 'require_email_verify' => true];
foreach ($vals as $k => $v) {
  $lit = var_export($v, true);
  $re = "/('" . preg_quote($k, '/') . "'\s*=>\s*)(?:'(?:[^'\\\\]|\\\\.)*'|\d+|true|false|null)/";
  if (preg_match($re, $s)) $s = preg_replace_callback($re, fn($m) => $m[1] . $lit, $s, 1);
  else { $pos = strrpos($s, '];'); if ($pos === false) { echo "no end of settings"; exit; } $before = rtrim(substr($s, 0, $pos)); $sep = (str_ends_with($before, ',') || str_ends_with($before, '[')) ? '' : ','; $s = $before . $sep . "\n  '$k' => $lit,\n" . substr($s, $pos); }
}
file_put_contents($f, $s);
$c = @include $f; if (!is_array($c) || ($c['smtp_host'] ?? '') !== getenv('HOST') || ($c['smtp_pass'] ?? '') !== getenv('PASS')) { echo "check failed"; exit; }
echo "OK";
