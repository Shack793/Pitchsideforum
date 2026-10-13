<?php
// Your profile, avatar, signature, privacy and notification settings.
declare(strict_types=1);

// Suspended or banned accounts can't change what others see (profile, signature, avatar)
function need_active(array $u): void { if ($u['status'] !== 'active') fail("Your account is {$u['status']}. You can't change your public profile right now.", 403); }

op('profile.update', function (array $in, array $u) {
  need_active($u);
  $p = $u['profile'];
  $p['about'] = str_in($in, 'about', 1000);
  $w = str_in($in, 'website', 200);
  if ($w !== '' && (preg_match('/^\s*(javascript|data|vbscript):/i', $w) || preg_match('/["\'<>\s]/', $w))) fail('Enter a plain web address for your website.');
  if ($w !== '' && restricted($u, 'links')) fail("New members can't add a website yet.");
  $p['website'] = $w;
  $teams = array_column(doc('TEAMS'), 'slug');
  $p['favTeams'] = array_values(array_slice(array_intersect(array_map('strval', arr_in($in, 'favTeams')), $teams), 0, 10));
  if (isset($in['favSports'])) $p['favSports'] = array_values(array_slice(array_map(fn($s) => slugify((string) $s), arr_in($in, 'favSports')), 0, 10));
  save_profile($u, $p);
  return [];
});

op('signature.update', function (array $in, array $u) {
  need_active($u);
  $sig = str_in($in, 'sig', 200);
  if (substr_count($sig, "\n") > 2) fail('Signatures can be 3 lines at most.');
  if ($sig !== '') need_ok(content_problem($u, $sig));
  $p = $u['profile']; $p['sig'] = $sig; save_profile($u, $p);
  return [];
});

op('avatar.set', function (array $in, array $u) {
  need_active($u);
  rate_limit('avatar:' . $u['name'], 20, 3600);
  $data = (string) ($in['data'] ?? '');
  if (!preg_match('#^data:image/(png|jpe?g|gif|webp);base64,#', $data)) fail('Choose a JPG, PNG, WebP or GIF image.');
  $bin = base64_decode(substr($data, strpos($data, ',') + 1), true);
  if ($bin === false || strlen($bin) > 5000000) fail('Avatars must be under 5 MB.');
  $p = $u['profile']; $p['avatar'] = save_image_bytes($bin, 'avatars', null, 160); save_profile($u, $p);
  return ['url' => $p['avatar']];
});
op('avatar.remove', function (array $in, array $u) { $p = $u['profile']; $p['avatar'] = null; save_profile($u, $p); return []; });
op('avatar.color', function (array $in, array $u) {
  need_active($u);
  $c = str_in($in, 'c', 9); if ($c !== '' && !preg_match('/^#[0-9a-f]{6}$/i', $c)) fail('Pick a colour.');
  $p = $u['profile']; $p['avatarColor'] = $c ?: null; save_profile($u, $p); return [];
});
op('prefs.set', function (array $in, array $u) {
  $p = $u['profile']; $k = str_in($in, 'k', 24); $v = $in['v'] ?? null;
  switch ($k) {
    case 'dms': if (!in_array($v, ['everyone', 'members', 'staff', 'nobody'], true)) fail('Pick who can message you.'); $p['privacy']['dms'] = $v; break;
    case 'showActivity': $p['privacy']['showActivity'] = (bool) $v; break;
    case 'hideSigs': $p['hideSigs'] = (bool) $v; break;
    case 'notify.email': case 'notify.browser': case 'notify.push': $p['notify'][substr($k, 7)] = (bool) $v; break;
    case 'ageOk': $p['ageOk'] = true; break;
    default: fail('Unknown setting.');
  }
  save_profile($u, $p);
  return [];
});

// Everything we hold about you, as a JSON download (Settings → Privacy → Export my data).
function export_data(array $u): array {
  return ['exported' => gmdate('c'), 'account' => ['name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'joined' => gmdate('c', intdiv($u['joined'], 1000)), 'profile' => $u['profile']],
    'topics' => rows("SELECT id, board, title, at FROM topics WHERE author = ?", [$u['name']]),
    'posts' => rows("SELECT id, topic_id, body, at FROM posts WHERE author = ?", [$u['name']]),
    'messages' => rows("SELECT conv_id, body, at FROM msgs WHERE from_user = ?", [$u['name']]),
    'follows' => rows("SELECT k FROM follows WHERE user = ?", [$u['name']]),
    'bookmarks' => rows("SELECT topic_id FROM bookmarks WHERE user = ?", [$u['name']]),
    'reports_filed' => rows("SELECT kind, reason, at, status FROM reports WHERE by_user = ?", [$u['name']]),
    'notifications' => rows("SELECT type, text, at FROM notifs WHERE to_user = ? ORDER BY id DESC LIMIT 1000", [$u['name']])];
}
