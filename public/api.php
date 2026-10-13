<?php
// Pitchside Forum API. Nginx sends every /api/… request here.
declare(strict_types=1);
require dirname(__DIR__) . '/app/lib/api.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
$path = trim(preg_replace('#^/api#', '', parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/'), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
  load_session();
  $u = viewer();

  if ($method === 'GET' && ($path === 'boot' || $path === 'sync')) {
    json_out(sync_payload($u, $path === 'sync' ? max(0, (int) ($_GET['since'] ?? 0)) : 0));
  }

  if ($method === 'POST' && $path === 'op') {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'pitchside') fail('Bad request.', 400);
    check_csrf();
    $in = json_decode(file_get_contents('php://input') ?: '{}', true);
    if (!is_array($in)) fail('Bad request.', 400);
    $result = run_op((string) ($in['op'] ?? ''), $in);
    if (!empty($in['_nosync'])) json_out(['ok' => true, 'result' => $result]);
    $since = max(0, (int) ($in['_since'] ?? 0));
    // The session may have changed (signed in or out), so read it again before syncing
    $after = viewer();
    $identityChanged = ($u['id'] ?? null) !== ($after['id'] ?? null);
    json_out(['ok' => true, 'result' => $result, 'sync' => sync_payload($after, $identityChanged ? 0 : $since)]);
  }

  if ($method === 'POST' && $path === 'upload') {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'pitchside') fail('Bad request.', 400);
    check_csrf();
    $u = need_user();
    if (!can($u, 'read') || $u['status'] !== 'active') fail("Your account can't upload files right now.", 403);
    rate_limit('upload:' . $u['name'], 60, 3600, "You've uploaded a lot of files this hour. Try again later.");
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('The upload failed. Files can be up to 10 MB.');
    if ($f['size'] > 10 * 1024 * 1024) fail('Files can be up to 10 MB.');
    $bin = file_get_contents($f['tmp_name']);
    $name = mb_substr(preg_replace('/[^\w .()-]+/u', '_', basename((string) $f['name'])) ?: 'file', 0, 120);
    if (substr($bin, 0, 5) === '%PDF-') { $ext = 'pdf'; $mime = 'application/pdf'; $out = $bin; }
    elseif (@getimagesizefromstring($bin)) {
      $url = save_image_bytes($bin, '../../app/storage/files', 2400);   // re-encoded copy, stored outside the public folder
      $out = null; $stored = basename($url); $mime = 'image/' . pathinfo($stored, PATHINFO_EXTENSION);
    } else fail('Attach images (JPG, PNG, GIF, WebP) or PDFs.');
    $dir = APP_DIR . '/storage/files'; if (!is_dir($dir)) mkdir($dir, 0750, true);
    if ($out !== null) { $stored = rand_token(16) . '.pdf'; file_put_contents("$dir/$stored", $out); }
    $id = insert('uploads', ['user' => $u['name'], 'path' => $stored, 'name' => $name, 'bytes' => (int) filesize("$dir/$stored"), 'mime' => $mime, 'at' => now_ms()]);
    json_out(['ok' => true, 'id' => $id, 'name' => $name, 'bytes' => (int) filesize("$dir/$stored")]);
  }

  if ($method === 'GET' && preg_match('#^file/(\d+)$#', $path, $m)) {
    $u = need_user();
    $f = row("SELECT * FROM uploads WHERE id = ?", [(int) $m[1]]); if (!$f) fail('Not found.', 404);
    $ok = $f['user'] === $u['name'] || is_staff($u)
      || (bool) val("SELECT 1 FROM msgs m JOIN conv_members c ON c.conv_id = m.conv_id AND c.user = ? WHERE m.att LIKE ? LIMIT 1", [$u['name'], '%"id":' . (int) $f['id'] . ',%']);
    if (!$ok) fail('Not found.', 404);
    $file = APP_DIR . '/storage/files/' . basename($f['path']); if (!is_file($file)) fail('Not found.', 404);
    header('Content-Type: ' . $f['mime']); header('Content-Length: ' . filesize($file)); header('Cache-Control: private, max-age=3600');
    header('Content-Disposition: ' . ($f['mime'] === 'application/pdf' ? 'attachment' : 'inline') . '; filename="' . addcslashes($f['name'], '"\\') . '"');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    readfile($file); exit;
  }

  if ($method === 'GET' && preg_match('#^topic/(\d+)$#', $path, $m)) {
    $t = row("SELECT * FROM topics WHERE id = ?", [(int) $m[1]]);
    $out = $t ? topics_out([$t], $u) : [];
    if (!$out) fail("That topic doesn't exist or you can't see it.", 404);
    $names = [$out[0]['author']]; foreach ($out[0]['posts'] as $p) $names[] = $p['author'];
    json_out(['topic' => $out[0], 'users' => (object) users_out($names, $u)]);
  }

  if ($method === 'GET' && preg_match('#^user/([A-Za-z0-9_]{1,40})$#', $path, $m)) {
    $t = user_by_name($m[1]); if (!$t || $t['status'] === 'deleted') fail("There's no member called {$m[1]}.", 404);
    $recent = topics_out(rows("SELECT * FROM topics WHERE author = ? AND deleted = 0 ORDER BY last_at DESC LIMIT 30", [$t['name']]), $u);
    json_out(['user' => user_out($t, $u), 'topics' => $recent]);
  }

  if ($method === 'GET' && $path === 'export') {
    $u = need_user(); require_once APP_DIR . '/ops/me.php';
    rate_limit('export:' . $u['name'], 5, 3600);
    header('Content-Disposition: attachment; filename="pitchside-' . $u['name'] . '-data.json"');
    json_out(export_data($u));
  }

  // Partners report conversions here: /api/aff/postback?link=stakeline&sub={placement}&event=deposit&amount=40&key=SECRET
  if ($method === 'GET' && $path === 'aff/postback') {
    $key = (string) cfg('postback_key', '');
    if ($key === '' || !hash_equals($key, (string) ($_GET['key'] ?? ''))) fail('Bad key.', 403);
    $links = doc('AFF_LINKS'); $found = false;
    foreach ($links as &$l) if ((string) ($l['slug'] ?? '') === (string) ($_GET['link'] ?? '') || (string) ($l['id'] ?? '') === (string) ($_GET['link'] ?? '')) {
      $l['conversions'][] = ['at' => now_ms(), 'event' => mb_substr((string) ($_GET['event'] ?? 'Conversion'), 0, 40), 'amount' => round((float) ($_GET['amount'] ?? 0), 2),
        'placement' => preg_replace('/[^a-z-]/', '', (string) ($_GET['sub'] ?? 'direct')) ?: 'direct', 'source' => 'postback']; $found = true; }
    unset($l);
    if (!$found) fail('Unknown link.', 404);
    save_doc('AFF_LINKS', $links);
    json_out(['ok' => true]);
  }

  fail('Not found.', 404);
} catch (ApiError $e) {
  json_out(['ok' => false, 'error' => $e->getMessage()] + $e->extra, $e->status);
} catch (Throwable $e) {
  error_log('[pitchside] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  json_out(['ok' => false, 'error' => 'Something went wrong on our side. Try again in a moment.'], 500);
}
