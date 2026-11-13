<?php
// Adds the two lines lighter pages needs to public/index.php. Prints OK, ALREADY or FAIL.
$f = $argv[1]; $s = (string) file_get_contents($f);
if (str_contains($s, 'boot_trim(')) { echo "ALREADY\n"; exit; }
$a = "  if ((\$seg[0] ?? '') === 'topic' && isset(\$seg[1])) {";
$b = "if (empty(\$boot['topics']) || !in_array(\$t['id'], array_column(\$boot['topics'], 'id'), true)) \$boot['topics'][] = \$t;";
if (substr_count($s, $a) !== 1 || substr_count($s, $b) !== 1) { echo "FAIL\n"; exit; }
$s = str_replace($a, "  if (function_exists('boot_trim')) \$boot = boot_trim(\$boot, \$u);   // lighter pages (app/ops/zz-boot-trim.php)\n" . $a, $s);
$s = str_replace($b, "\$ti = array_search(\$t['id'], array_column(\$boot['topics'] ?? [], 'id'), true); if (\$ti === false) \$boot['topics'][] = \$t; else \$boot['topics'][\$ti] = \$t;   // the opened topic always in full", $s);
file_put_contents($f, $s); echo "OK\n";
