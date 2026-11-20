<?php
// Sends one test email with the new settings. Prints SENT or the error.
$_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['REQUEST_URI'] = '/';
require $argv[1] . '/app/lib/api.php';
try { smtp_send((string) getenv('TEST'), 'Pitchside Forum: test email', "This is a test from your Pitchside Forum server. Email is working."); echo "SENT\n"; }
catch (Throwable $e) { echo $e->getMessage(), "\n"; }
