<?php
// Pitchside Forum: lighter pages. Every page arrives with the forum's recent topics inside it, so the site works
// instantly once loaded. Until now that included the full text of every post from the last six months, which made
// every page slow to arrive. Now long posts are cut to a short preview in that first download; a topic's full posts
// load when the topic is opened (public/assets/lighter-pages.1.js). Nothing is removed: counts, likes, authors and dates
// stay complete, and opening a topic page directly still sends it in full.
// Not trimmed: staff (moderators and admins, who need full text in the queues), and the discussion threads of reviews,
// complaints and marketplace listings (shown on their own pages).
// Casino listings: pages outside the gambling section get each casino without its long details (pros and cons,
// licence text, owner, payment methods, countries, gallery...). Names, logos, scores and badges stay. The full details
// load in the background once the page is showing, and the gambling pages wait for them (lighter-pages.2.js).
// Gambling pages opened directly, and staff, always get everything.
// Called from public/index.php through one added line. Remove this file and pages work exactly as before.
declare(strict_types=1);

const BOOT_TRIM_KEEP = 240;   // characters of each long post kept in the first download

function boot_trim(array $boot, ?array $u): array {
  try {
    if ($u && function_exists('is_staff') && is_staff($u)) return $boot;
    $boot = boot_slim_ops($boot);
    if (empty($boot['topics']) || !is_array($boot['topics'])) return $boot;
    $keep = [];
    foreach (['reviews', 'complaints', 'listings'] as $k) foreach ((array) ($boot[$k] ?? []) as $r) if (is_array($r) && !empty($r['thread'])) $keep[(int) $r['thread']] = true;
    foreach ($boot['topics'] as &$t) {
      if (!is_array($t) || empty($t['posts']) || isset($keep[(int) ($t['id'] ?? 0)]) || !empty($t['review']) || !empty($t['complaint'])) continue;
      $cut = false;
      foreach ($t['posts'] as &$p) {
        if (!empty($p['revisions'])) { $p['revisions'] = []; $cut = true; }
        $b = (string) ($p['body'] ?? '');
        if (mb_strlen($b) > BOOT_TRIM_KEEP + 40) {
          $s = mb_substr($b, 0, BOOT_TRIM_KEEP);
          $s = preg_replace('/\[[^\]]*$/u', '', $s) ?? $s;            // no half-cut [quote] / [img] tags
          $sp = mb_strrpos($s, ' '); if ($sp !== false && $sp > BOOT_TRIM_KEEP * 0.6) $s = mb_substr($s, 0, $sp);
          $p['body'] = rtrim($s) . '…'; $cut = true;
        }
      }
      unset($p);
      if ($cut) $t['part'] = true;
    }
    unset($t);
  } catch (Throwable $e) { /* never block the page */ }
  return $boot;
}

const BOOT_OP_DETAILS = ['pros', 'cons', 'license', 'owner', 'withdrawals', 'withdrawalLimit', 'games', 'languages', 'kyc', 'minDeposit', 'countries', 'images'];

function boot_slim_ops(array $boot): array {
  $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  if (preg_match('#^/(casinos|sportsbooks|gambling|blacklist|complaints|compare|admin)(/|$)#', $path)) return $boot;
  if (empty($boot['operators']) || !is_array($boot['operators'])) return $boot;
  foreach ($boot['operators'] as &$o) if (is_array($o)) foreach (BOOT_OP_DETAILS as $k) unset($o[$k]);
  unset($o);
  $boot['opSlim'] = BOOT_OP_DETAILS;
  return $boot;
}

// The full casino details, fetched by lighter-pages.2.js
op('ops.full', function (array $in, ?array $u) {
  if (!(feature_on('casinos') || feature_on('complaints') || is_staff($u))) return ['operators' => []];
  return ['operators' => operators_out(0)];
}, false);
