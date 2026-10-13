<?php
// Email over SMTP (Brevo, Amazon SES, Postmark, Mailgun… any provider with SMTP + login).
// Without SMTP settings, emails are written to app/storage/mail.log so nothing is lost during setup.
declare(strict_types=1);

function send_mail(string $to, string $subject, string $text): bool {
  $host = cfg('smtp_host');
  if (!$host) { log_line('mail.log', "TO $to | $subject\n$text\n"); return true; }
  try { smtp_send($to, $subject, $text); return true; }
  catch (Throwable $e) { log_line('mail.log', "FAILED to $to | $subject | " . $e->getMessage()); return false; }
}

function smtp_send(string $to, string $subject, string $text): void {
  $host = (string) cfg('smtp_host'); $port = (int) cfg('smtp_port', 587); $secure = (string) cfg('smtp_secure', 'tls'); // tls = STARTTLS, ssl = implicit TLS
  $from = (string) cfg('mail_from'); $fromName = (string) cfg('mail_from_name', 'Pitchside Forum');
  if (!filter_var($to, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('bad recipient');
  $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
  $fp = stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
  if (!$fp) throw new RuntimeException("connect: $errstr");
  stream_set_timeout($fp, 20);
  $read = function () use ($fp): string { $out = ''; while (($l = fgets($fp, 1024)) !== false) { $out .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return $out; };
  $cmd = function (string $c, array $ok) use ($fp, $read): string { if ($c !== '') fwrite($fp, $c . "\r\n"); $r = $read(); if (!in_array((int) substr($r, 0, 3), $ok, true)) throw new RuntimeException(trim("$c => $r")); return $r; };
  $cmd('', [220]);
  $me = parse_url(site_url(), PHP_URL_HOST) ?: 'localhost';
  $cmd("EHLO $me", [250]);
  if ($secure === 'tls') { $cmd('STARTTLS', [220]); if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('starttls failed'); $cmd("EHLO $me", [250]); }
  if (cfg('smtp_user')) { $cmd('AUTH LOGIN', [334]); $cmd(base64_encode((string) cfg('smtp_user')), [334]); $cmd(base64_encode((string) cfg('smtp_pass')), [235]); }
  $cmd("MAIL FROM:<$from>", [250]);
  $cmd("RCPT TO:<$to>", [250, 251]);
  $cmd('DATA', [354]);
  $enc = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
  $headers = ['From: ' . $enc($fromName) . " <$from>", "To: <$to>", 'Subject: ' . $enc($subject), 'Date: ' . date('r'),
    'Message-ID: <' . rand_token(12) . "@$me>", 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  $body = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($text));
  $cmd($body . "\r\n.", [250]);
  $cmd('QUIT', [221]);
  fclose($fp);
}
