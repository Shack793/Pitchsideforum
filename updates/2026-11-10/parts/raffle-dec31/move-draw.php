<?php
// Moves the $1,000 raffle draw to 31 December 2026 (midnight, Los Angeles time) from 1 or 24 December,
// and updates the date wording in that raffle's own text and in any site text that mentions the raffle.
// Usage: php move-draw.php /var/www/pitchside
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$tz = new DateTimeZone('America/Los_Angeles');
$ms = fn(string $d) => (new DateTimeImmutable("$d 00:00:00", $tz))->getTimestamp() * 1000;
$olds = [$ms('2026-12-01'), $ms('2026-12-24')]; $new = $ms('2026-12-31');
try { $rounds = rows("SELECT * FROM raffle_rounds"); } catch (Throwable $e) { fwrite(STDERR, "NO_TABLE\n"); exit(2); }
$fix = function (string $s): string {
  $s = preg_replace('/\b(1|24)(st|th)? December\b/', '31st December', $s) ?? $s;
  $s = preg_replace('/\bDecember (1|24)(st|th)?\b(?!\d)/', 'December 31st', $s) ?? $s;
  $s = preg_replace('/\b(1|24)(st|th)? Dec\b/', '31 Dec', $s) ?? $s;
  $s = preg_replace('/\bDec\.? (1|24)(st|th)?\b(?!\d)/', 'Dec 31', $s) ?? $s;
  return str_replace(['2026-12-01', '2026-12-24'], '2026-12-31', $s);
};
$moved = 0; $already = false;
foreach ($rounds as $r) {
  $set = []; $hit = false;
  foreach ($r as $col => $v) {
    if ($col === 'id' || $v === null) continue;
    if (is_numeric($v)) {
      $n = (int) $v;
      if (in_array($n, $olds, true)) { $set[$col] = $new; $hit = true; }
      elseif (in_array($n * 1000, $olds, true)) { $set[$col] = intdiv($new, 1000); $hit = true; }
      elseif ($n === $new || $n * 1000 === $new) $already = true;
    } elseif (is_string($v)) { $f = $fix($v); if ($f !== $v) $set[$col] = $f; }
  }
  if (!$hit) continue;
  if (array_key_exists('updated', $r)) $set['updated'] = now_ms();
  $cols = array_keys($set);
  q("UPDATE raffle_rounds SET " . implode(', ', array_map(fn($c) => "$c = ?", $cols)) . " WHERE id = ?", array_merge(array_values($set), [$r['id']]));
  $entries = null;
  foreach (['raffle_entries', 'raffle_tickets'] as $tb) { try { $entries = (int) val("SELECT COUNT(*) FROM $tb WHERE round_id = ?", [$r['id']]); break; } catch (Throwable $e) {} }
  audit(null, 'Raffle draw date changed', "raffle round #{$r['id']}", 'Draw moved to 31 December 2026', 'earlier date', '31 Dec 2026 00:00 PT');
  echo "MOVED {$r['id']} " . ($entries === null ? '?' : $entries) . "\n"; $moved++;
}
// Site text that mentions the raffle (announcements, ticker, banners): fix the date there too
$texts = 0;
foreach (rows("SELECT k, v FROM config") as $c) {
  $d = jdec((string) $c['v'], null); if (!is_array($d)) continue;
  $walk = function ($x) use (&$walk, $fix, &$texts) {
    if (is_array($x)) { foreach ($x as $k => $v) $x[$k] = $walk($v); return $x; }
    if (is_string($x) && stripos($x, 'raffle') !== false) { $f = $fix($x); if ($f !== $x) { $texts++; return $f; } }
    return $x;
  };
  $before = $texts; $nd = $walk($d);
  if ($texts > $before) save_doc((string) $c['k'], $nd);
}
// pinned/announcement topics about the raffle written by staff
foreach (rows("SELECT p.id, p.body FROM posts p JOIN topics t ON t.id = p.topic_id WHERE t.deleted = 0 AND (t.title LIKE '%raffle%' OR t.title LIKE '%Raffle%') AND p.author IN (SELECT name FROM users WHERE role IN ('super_admin','admin'))") as $p) {
  $f = $fix((string) $p['body']); if ($f !== $p['body']) { q("UPDATE posts SET body = ? WHERE id = ?", [$f, $p['id']]); $texts++; }
}
if ($moved) meta_set('raffle:2026-12-31', (string) now_ms());
if (!$moved) { echo $already ? "ALREADY\n" : "NONE\n"; exit($already ? 0 : 3); }
echo "TEXTS $texts\nOK\n";
