<?php
// Puts each picture in logos/ (named after the casino's short name, e.g. justbet.png) on that casino's listing.
// Pictures are already trimmed and centred on a box-shaped background. Usage: php setup.php /var/www/pitchside /path/to/logos
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
$dir = rtrim($argv[2] ?? __DIR__ . '/logos', '/');
require $app . '/app/lib/api.php';
$folder = PUBLIC_DIR . '/uploads/media'; if (!is_dir($folder)) mkdir($folder, 0755, true);
$done = []; $missing = [];
foreach (glob("$dir/*.{png,jpg,jpeg,webp}", GLOB_BRACE) as $f) {
  $slug = strtolower(pathinfo($f, PATHINFO_FILENAME));
  $r = row("SELECT data FROM operators WHERE slug = ?", [$slug]);
  if (!$r) { $missing[] = $slug; continue; }
  $bin = (string) file_get_contents($f);
  $name = 'logo-' . $slug . '-' . substr(hash('sha256', $bin), 0, 12) . '.' . strtolower(pathinfo($f, PATHINFO_EXTENSION));
  if (!is_file("$folder/$name")) file_put_contents("$folder/$name", $bin);
  $d = jdec((string) $r['data'], []); $prev = $d['logo'] ?? null; $d['logo'] = "/uploads/media/$name";
  if ($prev !== $d['logo']) { q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [jenc($d), now_ms(), $slug]); audit(null, 'Operator logo', $d['name'] ?? $slug, 'New logo', $prev ?: 'none', $d['logo']); }
  $done[] = $d['name'] ?? $slug;
}
// Display names (brand spelling), from names.json next to the logos folder: {"short-name": "Name"}
$renamed = [];
$nf = dirname($dir) . '/names.json';
if (is_file($nf)) foreach ((array) json_decode((string) file_get_contents($nf), true) as $slug => $name) {
  $r = row("SELECT data FROM operators WHERE slug = ?", [(string) $slug]); if (!$r) continue;
  $d = jdec((string) $r['data'], []);
  if ($slug === 'justbet' && strtolower(preg_replace('#^www\.#', '', (string) ($d['website'] ?? ''))) !== 'just.bet') continue;   // only the just.bet casino
  if (($d['name'] ?? '') === $name) continue;
  $prev = $d['name'] ?? $slug; $d['name'] = (string) $name;
  q("UPDATE operators SET data = ?, updated = ? WHERE slug = ?", [jenc($d), now_ms(), (string) $slug]);
  audit(null, 'Operator renamed', (string) $name, 'Brand spelling', $prev, (string) $name);
  $renamed[] = "$prev → $name";
}
echo "RENAMED " . (implode(', ', $renamed) ?: '-') . "\n";
echo "LOGOS " . (implode(', ', $done) ?: '-') . "\nMISSING " . (implode(', ', $missing) ?: '-') . "\n";
