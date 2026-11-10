<?php
// Keeps one "Casino & Sportsbook Review Guidelines" post (in Casino Reviews) and removes the second copy.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$T = 'Casino & Sportsbook Review Guidelines';
$all = rows("SELECT id, board FROM topics WHERE title = ? AND deleted = 0 ORDER BY CASE WHEN board = 'casino-reviews' THEN 0 ELSE 1 END, id", [$T]);
if (!$all) { echo "NONE\n"; exit(0); }
$keep = (int) $all[0]['id']; $gone = 0;
foreach (array_slice($all, 1) as $t) { q("UPDATE topics SET deleted = 1, pinned = 0, updated = ? WHERE id = ?", [now_ms(), (int) $t['id']]); $gone++; }
q("UPDATE topics SET pinned = 1, updated = ? WHERE id = ?", [now_ms(), $keep]);
// the older installer remembers one post per board: point both at the one we keep, so it never posts a second copy again
meta_set('post:review-guidelines-2026-11:casino-reviews', (string) $keep);
meta_set('post:review-guidelines-2026-11:sportsbook-reviews', (string) $keep);
if ($gone) audit(null, 'Merged review guidelines', "topic #$keep", "Removed $gone duplicate copy", "$gone duplicate", 'one post');
echo "KEPT $keep REMOVED $gone\n";
