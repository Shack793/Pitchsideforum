<?php
// Adds the search-engine hook to public/index.php (and the extra-head hook if an earlier update didn't).
$f = $argv[1]; $s = file_get_contents($f); $changed = false;
$b = "\$head = '<title>' . \$h(\$title) . '</title>";
$b2 = "\$head = (\$GLOBALS['PS_EXTRA_HEAD'] ?? '') . '<title>' . \$h(\$title) . '</title>";
if (!str_contains($s, "PS_EXTRA_HEAD")) { if (substr_count($s, $b) !== 1) { echo "LAYOUT\n"; exit(2); } $s = str_replace($b, $b2, $s); $changed = true; }
if (!str_contains($s, "function_exists('seo_extend')")) {
  $a = "  \$shell = file_get_contents(APP_DIR . '/shell.html');";
  if (substr_count($s, $a) !== 1) { echo "LAYOUT\n"; exit(2); }
  $s = str_replace($a, "  if (function_exists('seo_extend')) [\$title, \$desc, \$body] = seo_extend(\$seg, \$path, \$title, \$desc, \$body, \$status, \$h);\n" . $a, $s); $changed = true;
}
if (!$changed) { echo "ALREADY\n"; exit(0); }
file_put_contents($argv[2], $s); echo "PATCHED\n";
