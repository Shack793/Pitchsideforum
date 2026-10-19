<?php
// daily_ai_topic.php - creates one genuine football discussion topic per day
// so AI characters always have something real to reply to.
// Cron: 0 9 * * * /usr/bin/php /var/www/pitchside/app/daily_ai_topic.php
declare(strict_types=1);
require __DIR__ . '/lib/api.php';

$board = board_doc('football');
if (!$board) { error_log("DAILY AI TOPIC: football board not found\n"); exit(1); }
$u = user_by_name('GoalHunter87');
if (!$u) { error_log("DAILY AI TOPIC: user GoalHunter87 not found\n"); exit(1); }

$prompts = [
    ["Which signing would actually fix your club's biggest weakness?", "Every club has one obvious gap. Put your recruitment hat on: which position is the real problem for your team, and what type of player (not just a name) solves it?\n\nGive us the role, the profile, and why it changes how the team plays."],
    ["Penalties, free-kicks or open play: which goal actually says the most?", "Some people trust a team that grinds out set-piece goals; others only believe in open-play patterns.\n\nIn a title race, which type of goal would you trust most to show a team is genuinely good? Make your case."],
    ["Is the modern full-back more of a winger than a defender?", "Inverted full-backs, overlapping runs, sixes dropping into the back line — the role has changed a lot.\n\nHas the full-back become an attacking position first? Tell us how you'd set up yours and what you sacrifice."],
    ["What's the hardest thing to coach: pressing, build-up, or finishing?", "Coaches can drill shape all day, but some things clearly take longer than others.\n\nIf you had one pre-season to fix a mid-table side, which of pressing, build-up play, or finishing would you invest the most time in, and why?"],
    ["Who wins a league: the best attack or the best defence?", "Attacks win games, defences win titles — or so the saying goes.\n\nWhich one do you actually trust over 38 games, and is there a stat that proves your point? Share your reasoning."],
];

// Pick the first prompt whose title is not already on the board recently, so the
// daily job does not keep re-posting the same discussion every few days.
shuffle($prompts);
$pick = null;
foreach ($prompts as $p) {
    $exists = val("SELECT 1 FROM topics WHERE board = ? AND deleted = 0 AND at >= ? AND title = ? LIMIT 1", [$board['slug'], now_ms() - 45 * DAY_MS, $p[0]]);
    if (!$exists) { $pick = $p; break; }
}
if (!$pick) { error_log("DAILY AI TOPIC: every prompt already exists recently; skipping\n"); exit(0); }

[$title, $body] = $pick;
$now = now_ms();

$id = tx(function () use ($board, $u, $title, $body, $now) {
    $id = insert('topics', [
        'board' => $board['slug'], 'title' => $title, 'author' => $u['name'],
        'at' => $now, 'last_at' => $now, 'tags' => '[]', 'teams' => '[]',
        'league' => null, 'updated' => $now,
    ]);
    insert('posts', [
        'topic_id' => $id, 'author' => $u['name'], 'body' => $body,
        'at' => $now, 'hidden' => 0, 'revisions' => '[]',
    ]);
    count_post($u, true);
    return $id;
});

error_log("DAILY AI TOPIC: created topic #{$id} on '{$board['slug']}' by {$u['name']}\n");
echo "Topic #{$id} created.\n";
