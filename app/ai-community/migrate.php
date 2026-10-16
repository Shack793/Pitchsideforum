<?php
// Creates only the AI module tables. Safe to run on an existing forum.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../lib/api.php';
$sql = file_get_contents(__DIR__ . '/schema.sql');
if ($sql === false) { fwrite(STDERR, "Cannot read AI schema.\n"); exit(1); }
$sql = preg_replace('/^--.*$/m', '', $sql);
$statements = array_filter(array_map('trim', explode(';', $sql)));
foreach ($statements as $statement) { db()->exec($statement); echo "OK: AI module table ready\n"; }
echo "AI Community schema migration complete. No characters or jobs were created.\n";
