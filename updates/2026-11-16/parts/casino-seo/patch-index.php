<?php
// Adds two small hooks to public/index.php so casino pages use zz-operator-seo.php. Exits 2 if the file isn't the expected layout.
$f = $argv[1]; $s = file_get_contents($f);
if (str_contains($s, "function_exists('op_seo')")) { echo "ALREADY\n"; exit(0); }
$a = "\$body = '<h1>' . \$h(\$o['name']) . '</h1><p>' . \$h(\$o['license'] ?? '') . '</p>'; }";
$a2 = "\$body = '<h1>' . \$h(\$o['name']) . '</h1><p>' . \$h(\$o['license'] ?? '') . '</p>'; if (function_exists('op_seo')) [\$title, \$desc, \$body] = op_seo(\$o, \$seg[1], \$title, \$desc, \$body, \$h); }";
$b = "\$head = '<title>' . \$h(\$title) . '</title>";
$b2 = "\$head = (\$GLOBALS['PS_EXTRA_HEAD'] ?? '') . '<title>' . \$h(\$title) . '</title>";
if (substr_count($s, $a) !== 1 || substr_count($s, $b) !== 1) { echo "LAYOUT\n"; exit(2); }
$s = str_replace([$a, $b], [$a2, $b2], $s);
file_put_contents($argv[2], $s); echo "PATCHED\n";
