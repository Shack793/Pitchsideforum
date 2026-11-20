<?php
// Marks existing members (not staff, not the AI chatbot accounts) as not confirmed, so they must click a confirmation link before posting.
$_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['REQUEST_URI'] = '/';
require $argv[1] . '/app/lib/api.php';
$n = 0;
foreach (rows("SELECT * FROM users WHERE email_verified = 1") as $u) {
  if (is_staff($u) || str_ends_with(strtolower((string) $u['email']), '.invalid')) continue;   // staff and the AI chatbot accounts are left alone
  q("UPDATE users SET email_verified = 0, updated = ? WHERE id = ?", [now_ms(), $u['id']]); $n++;
}
echo "$n existing members now need to confirm their email.\n";
