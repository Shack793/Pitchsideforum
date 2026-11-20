<?php
// Search titles and descriptions for the main section pages (they used the general site title before), and no
// "betting tips" in the description of sports league pages. Only adds an entry if that page has none yet in
// Admin → SEO, so your own edits are kept.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$want = [
  ['/sports', 'Sports forum: football, basketball, tennis, F1 and more | Pitchside Forum', 'Talk football, basketball, tennis, F1, UFC and more with other fans: match threads, predictions and a board for every major league and competition.'],
  ['/crypto', 'Crypto forum: Bitcoin, altcoins, trading and crypto casinos | Pitchside Forum', 'Discuss Bitcoin, Ethereum and altcoins, crypto trading and investing, and crypto casinos and sportsbooks with the Pitchside community.'],
  ['/gambling', 'Gambling forum: sports betting, casinos and poker | Pitchside Forum', 'Sports betting, casino and poker discussion, honest casino and sportsbook reviews, player complaints and a free raffle. 18+ only.'],
  ['/community', 'Community: announcements, general chat and help | Pitchside Forum', 'Announcements, general discussion, off-topic chat and help with Pitchside Forum.'],
  ['/forum', 'Forum index: every board on Pitchside | Pitchside Forum', 'Every board on Pitchside Forum: sports, gambling, crypto and community discussion in one list.'],
  ['/blacklist', 'Blacklisted casinos and sportsbooks to avoid | Pitchside Forum', 'Casinos and sportsbooks Pitchside warns players to avoid, with the reasons: unpaid withdrawals, unfair terms and missing licences.'],
];
foreach ([['rules', 'House rules', 'The house rules for Pitchside Forum: how to post, what is not allowed and how moderation works.'],
  ['terms', 'Terms of Service', 'The terms of service for using Pitchside Forum.'], ['privacy', 'Privacy Policy', 'How Pitchside Forum collects, uses and protects your information.'],
  ['cookies', 'Cookie controls', 'Which cookies Pitchside Forum uses and how to control them.'], ['gambling', 'Gambling disclaimer', 'Gambling on Pitchside Forum: 18+ only, play responsibly, and where to get help.'],
  ['disclosures', 'Advertising & affiliate disclosures', 'How Pitchside Forum makes money from ads and affiliate links, and how that is kept separate from ratings.'],
  ['dmca', 'Copyright / DMCA', 'How to report copyright infringement on Pitchside Forum.'], ['advertise', 'Advertise on Pitchside', 'Advertising options on Pitchside Forum for sports, betting and crypto brands.'],
  ['moderators', 'Become a moderator', 'Help run Pitchside Forum: what moderators do and how to apply.'],
  ['safety-index', 'How the Safety Index works', 'How Pitchside rates casinos and sportsbooks: licence, complaint handling, fair terms, size and player feedback. Ads never change a score.']] as [$k, $t, $d]) $want[] = ["/page/$k", "$t | Pitchside Forum", $d, true];
foreach ((array) doc('TAGS') as $tg) if (!empty($tg['slug'])) $want[] = ['/tag/' . $tg['slug'], ($tg['name'] ?? $tg['slug']) . ' topics | Pitchside Forum', (string) ($tg['desc'] ?? ''), !empty($tg['index'])];
$S = doc('SEO'); if (!is_array($S)) $S = []; $have = array_column($S, 'path'); $n = 0;
foreach ($want as $w) { [$p, $t, $d] = $w; if (!in_array($p, $have, true)) { $S[] = ['path' => $p, 'title' => $t, 'desc' => $d, 'index' => $w[3] ?? true, 'canonical' => $p]; $n++; } }
if ($n) save_doc('SEO', $S);
echo "SEO $n page titles added\n";
