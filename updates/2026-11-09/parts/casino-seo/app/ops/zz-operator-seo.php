<?php
// Pitchside Forum: what search engines and link previews see on each casino / sportsbook page.
// Before: only the name and licence. Now: overall rating, category scores, licence and key facts, verification,
// recent member reviews (with Verified labels and the operator's official replies) and complaints with their status,
// plus structured data (Organization + AggregateRating + Review) so search engines understand the page.
// Visitors with a browser still get the normal interactive page; this is the plain-HTML copy inside it.
// Called from public/index.php (one line added by apply.sh). If this file is removed, the page falls back to before.
declare(strict_types=1);

function op_seo(array $o, string $slug, string $title, string $desc, string $body, callable $h): array {
  try {
    $name = (string) ($o['name'] ?? $slug);
    $path = rtrim((string) (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '/casinos/' . $slug), '/');
    $url = site_url($path);
    $revs = rows("SELECT id, user, stars, scores, title, body, status, at, response, thread FROM reviews WHERE op = ? AND status <> 'removed' ORDER BY at DESC LIMIT 200", [$slug]);
    $n = count($revs);
    $avg = $n ? array_sum(array_map(fn($r) => (int) $r['stars'], $revs)) / $n : 0;
    $cats = [];
    foreach ($revs as $r) foreach (jdec($r['scores'] ?? '[]', []) as $k => $v) if ((int) $v >= 1 && (int) $v <= 5) $cats[$k][] = (int) $v;
    $comps = rows("SELECT id, title, status, cat, amount, at FROM complaints WHERE op = ? ORDER BY at DESC LIMIT 200", [$slug]);
    $cn = count($comps);
    $open = count(array_filter($comps, fn($c) => in_array($c['status'], OPEN_STATUSES, true)));
    $label = fn($s) => defined('STATUS_LABEL') && isset(STATUS_LABEL[$s]) ? STATUS_LABEL[$s] : $s;
    $date = fn($ms) => date('j M Y', (int) floor(((int) $ms) / 1000));
    $stars = fn($x) => number_format($x, 1) . ' out of 5';

    // Title and description that show in search results
    $title = $n ? "$name review: {$stars($avg)} from $n member review" . ($n === 1 ? '' : 's') . " | Pitchside Forum"
                : $title;
    $bits = [];
    if ($n) $bits[] = "Rated " . number_format($avg, 1) . "/5 by $n member" . ($n === 1 ? '' : 's');
    $bits[] = $cn ? "$cn complaint" . ($cn === 1 ? '' : 's') . ($open ? " ($open open)" : '') : 'no complaints filed';
    if (!empty($o['license'])) $bits[] = 'licence: ' . mb_substr(preg_replace('/\s+/', ' ', (string) $o['license']), 0, 90);
    $desc = "$name: " . implode('; ', $bits) . '. Read player reviews, payouts and complaints before you deposit.';

    // Page content
    $out = '<article><h1>' . $h($name) . ' review</h1>';
    $out .= '<p>' . ($n ? '<strong>' . $h($stars($avg)) . "</strong> from $n member review" . ($n === 1 ? '' : 's') . '. ' : 'No member reviews yet. ')
      . ($cn ? "$cn complaint" . ($cn === 1 ? '' : 's') . " filed" . ($open ? ", $open still open" : '') . '.' : 'No complaints filed.') . '</p>';
    $verified = !empty($o['claimed']) || !empty($o['reps']);
    $out .= '<p>' . ($verified ? 'This profile is managed by ' . $h($name) . "'s verified official representatives, who can reply publicly to reviews and complaints."
                               : $h($name) . ' has not claimed this profile yet.') . '</p>';
    if (!empty($o['blacklist'])) $out .= '<p><strong>Warning:</strong> ' . $h($name) . ' is on the Pitchside blacklist.</p>';
    if (!empty($o['warning'])) $out .= '<p><strong>Warning:</strong> ' . $h(is_string($o['warning']) ? $o['warning'] : 'see the notice on this page') . '</p>';

    if ($cats) {
      $out .= '<h2>Ratings by category</h2><ul>';
      foreach ($cats as $k => $vs) $out .= '<li>' . $h($k) . ': ' . number_format(array_sum($vs) / count($vs), 1) . ' / 5</li>';
      $out .= '</ul>';
    }
    $facts = [];
    foreach (['license' => 'Licence', 'owner' => 'Operated by', 'est' => 'Founded', 'games' => 'Games', 'withdrawals' => 'Withdrawals', 'minDeposit' => 'Minimum deposit', 'withdrawalLimit' => 'Withdrawal limit', 'kyc' => 'Identity checks'] as $k => $l) {
      $v = $o[$k] ?? null; if (is_array($v)) $v = implode(', ', array_map('strval', $v)); if ($v === null || $v === '' || $v === false) continue;
      $facts[] = '<li>' . $h($l) . ': ' . $h($v) . '</li>';
    }
    if (!empty($o['crypto']) && is_array($o['crypto'])) $facts[] = '<li>Crypto: ' . $h(implode(', ', $o['crypto'])) . '</li>';
    if ($facts) $out .= '<h2>Key facts</h2><ul>' . implode('', $facts) . '</ul>';
    if (!empty($o['pros']) && is_array($o['pros'])) $out .= '<h2>Pros</h2><ul>' . implode('', array_map(fn($p) => '<li>' . $h($p) . '</li>', $o['pros'])) . '</ul>';
    if (!empty($o['cons']) && is_array($o['cons'])) $out .= '<h2>Cons</h2><ul>' . implode('', array_map(fn($p) => '<li>' . $h($p) . '</li>', $o['cons'])) . '</ul>';

    if ($n) {
      $out .= '<h2>Member reviews</h2>';
      foreach (array_slice($revs, 0, 20) as $r) {
        $badge = $r['status'] === 'verified transaction' ? ' · Verified transaction' : ($r['status'] === 'verified user' ? ' · Verified reviewer' : ($r['status'] === 'disputed' ? ' · Disputed' : ''));
        $link = $r['thread'] ? '<a href="/topic/' . (int) $r['thread'] . '">' . $h($r['title']) . '</a>' : $h($r['title']);
        $text = mb_substr(trim(preg_replace('/\s+/', ' ', (string) $r['body'])), 0, 400);
        $out .= '<section><h3>' . $link . '</h3><p>' . (int) $r['stars'] . ' out of 5 · by ' . $h($r['user']) . ' · ' . $h($date($r['at'])) . $h($badge) . '</p><p>' . $h($text) . (mb_strlen((string) $r['body']) > 400 ? '…' : '') . '</p>';
        $resp = $r['response'] ? jdec($r['response'], null) : null;
        if (is_array($resp) && !empty($resp['body'])) $out .= '<blockquote><p><strong>Official reply from ' . $h($name) . ':</strong> ' . $h(mb_substr((string) $resp['body'], 0, 600)) . '</p></blockquote>';
        $out .= '</section>';
      }
    }
    if ($cn) {
      $out .= '<h2>Complaints</h2><ul>';
      foreach (array_slice($comps, 0, 20) as $c)
        $out .= '<li><a href="/complaints/' . $h($c['id']) . '">' . $h($c['title']) . '</a> · ' . $h($label($c['status'])) . ' · ' . $h($c['cat']) . ' · ' . $h($date($c['at'])) . '</li>';
      $out .= '</ul>';
    }
    $out .= '</article>';

    // Structured data for search engines
    $ld = ['@context' => 'https://schema.org', '@type' => 'Organization', 'name' => $name, 'url' => $url];
    if (!empty($o['website'])) $ld['sameAs'] = [str_starts_with((string) $o['website'], 'http') ? $o['website'] : 'https://' . $o['website']];
    if ($n) {
      $ld['aggregateRating'] = ['@type' => 'AggregateRating', 'ratingValue' => round($avg, 1), 'bestRating' => 5, 'worstRating' => 1, 'ratingCount' => $n, 'reviewCount' => $n];
      $ld['review'] = array_map(fn($r) => ['@type' => 'Review', 'name' => (string) $r['title'], 'author' => ['@type' => 'Person', 'name' => (string) $r['user']],
        'datePublished' => date('Y-m-d', (int) floor(((int) $r['at']) / 1000)), 'reviewBody' => mb_substr(trim((string) $r['body']), 0, 500),
        'reviewRating' => ['@type' => 'Rating', 'ratingValue' => (int) $r['stars'], 'bestRating' => 5, 'worstRating' => 1]], array_slice($revs, 0, 5));
    }
    $GLOBALS['PS_EXTRA_HEAD'] = '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . '</script>' . "\n";
    return [$title, $desc, $out];
  } catch (Throwable $e) {
    error_log('[pitchside casino page] ' . $e->getMessage());
    return [$title, $desc, $body];
  }
}
