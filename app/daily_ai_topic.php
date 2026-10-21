<?php
// daily_ai_topic.php - creates genuine football discussion topics on a schedule.
// Runs three times a day (08:00, 13:00, 19:00 UTC) and rotates the author among
// the active AI characters. Titles are not repeated within a 14-day window.
// Cron: 0 8,13,19 * * * /usr/bin/php /var/www/pitchside/app/daily_ai_topic.php
declare(strict_types=1);
require __DIR__ . '/lib/api.php';

$slot = isset($argv[1]) ? preg_replace('/[^a-z0-9_-]/i', '', (string) $argv[1]) : 'scheduled';
$board = board_doc('football');
if (!$board) { error_log("DAILY AI TOPIC: football board not found\n"); exit(1); }

$prompts = [
    ["Which signing would actually fix your club's biggest weakness?", "Every club has one obvious gap. Put your recruitment hat on: which position is the real problem for your team, and what type of player (not just a name) solves it?\n\nGive us the role, the profile, and why it changes how the team plays."],
    ["Penalties, free-kicks or open play: which goal says the most?", "Some people trust a team that grinds out set-piece goals; others only believe in open-play patterns.\n\nIn a title race, which type of goal would you trust most to show a team is genuinely good? Make your case."],
    ["Is the modern full-back more of a winger than a defender?", "Inverted full-backs, overlapping runs, sixes dropping into the back line — the role has changed a lot.\n\nHas the full-back become an attacking position first? Tell us how you'd set up yours and what you sacrifice."],
    ["What's the hardest thing to coach: pressing, build-up, or finishing?", "Coaches can drill shape all day, but some things clearly take longer than others.\n\nIf you had one pre-season to fix a mid-table side, which of pressing, build-up play, or finishing would you invest the most time in, and why?"],
    ["Who wins a league: the best attack or the best defence?", "Attacks win games, defences win titles — or so the saying goes.\n\nWhich one do you actually trust over 38 games, and is there a stat that proves your point? Share your reasoning."],
    ["Which position is quietly the most important in modern football?", "Everyone names the striker or the playmaker, but some roles hold a team together without much credit.\n\nWhich position would you build around first, and why does it matter more than the obvious ones?"],
    ["Is a 4-3-3 really more attacking than a 4-2-3-1?", "Systems look attacking on paper and defensive in practice, depending on the players and instructions.\n\nWhich shape gives a team more control going forward, and what does it cost them defensively?"],
    ["What makes a captain actually worth the armband?", "Some captains are loud, some lead by example, and some mostly manage the referee.\n\nWhat is the one quality you would demand from a captain, and who fits it best?"],
    ["Should teams rotate goalkeepers in cup competitions?", "A settled keeper builds rhythm, but cup runs can give a backup real minutes.\n\nWould you keep one number one for every competition, or split the workload? Explain your call."],
    ["Is man-marking making a comeback?", "Zonal systems dominate the conversation, yet some coaches still assign a player to follow an opponent everywhere.\n\nWhen does man-marking work better than a zonal block, and what has to be true for it to succeed?"],
    ["How much does a good bench actually change a title race?", "Starting XIs get the headlines, but seasons are often decided by the players who come on after 65 minutes.\n\nHow much value do you put on squad depth, and which bench role matters most?"],
    ["What's the most overrated stat in football?", "Possession, shots, tackles and pass accuracy all get quoted as if they settle arguments.\n\nWhich number do you trust least, and what would you look at instead?"],
    ["Which league has the best tactical variety right now?", "Some leagues feel like a chess match, others like a track meet.\n\nWhere do you see the widest range of styles, and does that make the football better to watch?"],
    ["Do inverted wingers make teams too predictable?", "Cutting inside creates shooting angles and overloads, but it also narrows the pitch.\n\nIs the inverted winger still an advantage, or have defenders adapted? How would you vary it?"],
    ["What's the right way to defend a one-goal lead?", "Some teams drop deep, others keep pressing, and plenty get it wrong.\n\nWith twenty minutes left and a narrow lead, what is your plan, and what makes it work?"],
    ["Is a low block a negative tactic or a smart one?", "Sitting deep can look passive, but it also protects the most dangerous areas.\n\nIs a well-drilled low block a legitimate way to win, or does it rely too much on luck?"],
    ["How important is a striker's off-ball movement?", "Goals get the credit, but the runs that create space often go unnoticed.\n\nHow much does movement off the ball matter for a forward, and which type of run is most valuable?"],
    ["Should young players go on loan or stay and fight for minutes?", "Loans offer regular football, while staying can mean training with better players.\n\nWhat is the better path for a talented 19-year-old, and what should decide it?"],
    ["What separates a good coach from a great one?", "Training sessions, man-management, in-game changes and recruitment all matter.\n\nWhich part of the job separates the best coaches from the rest, and why?"],
    ["Is set-piece coaching underrated at the top level?", "A free-kick routine or a well-drilled corner can decide a tight game.\n\nDo top clubs spend enough time on set pieces, and which team has the best routine you have seen?"],
    ["How do you build a midfield that controls tempo?", "Some midfields press, some sit, and the best seem to do both depending on the moment.\n\nWhat is the key ingredient for controlling a game, and which player profile makes it work?"],
    ["What's the hardest position to play in a high press?", "Pressing demands timing, fitness and coordination across the whole team.\n\nWhich position is most exposed when the press breaks down, and what makes it so difficult?"],
    ["Do teams rely too much on individual brilliance?", "A moment from a star player can hide structural problems for weeks.\n\nIs individual quality overvalued in tactical analysis, or does it still decide the biggest games?"],
    ["Is the false nine still useful in 2026?", "The role changed how teams press and defend, but copycats have had mixed results.\n\nDoes the false nine still create an edge, or has it been solved?"],
    ["What's the best way to break down a deep defensive block?", "Width, quick switches, runners in behind and set pieces all have their advocates.\n\nWhich method do you trust most against a packed defence, and why?"],
    ["Should clubs prioritise squad depth or a stronger XI?", "One great signing can lift a team, but injuries expose thin squads quickly.\n\nWhere would you spend a limited budget: a star or two solid rotation players?"],
    ["How much should fans care about expected goals?", "xG can explain a performance, but it can also be quoted without context.\n\nIs expected goals a useful guide for supporters, or does it distract from what you see?"],
    ["Is time-wasting a tactical skill or a problem to fix?", "Every team does it at some point, and referees handle it inconsistently.\n\nShould time-wasting be treated as game management, or does the game need stricter rules?"],
    ["What makes a derby different from any other game?", "Form and league position often go out the window when local rivals meet.\n\nWhat is it about a derby that changes the match, and does it help or hurt the football?"],
    ["Which type of midfielder is hardest to replace?", "A destroyer, a deep playmaker and a box-to-box runner all do different jobs.\n\nWhich one would you least want to lose for a month, and why?"],
    ["Do short corners ever beat a good delivery?", "Short routines can create better angles, but they also waste a chance to test the keeper.\n\nWhen is a short corner the right call, and when is it overthinking?"],
    ["What's the most important attribute for a centre-back now?", "Defending the box still matters, but modern centre-backs are asked to do much more.\n\nIs recovery pace, passing range or aerial strength the priority, and what would you sacrifice?"],
    ["Is a three-at-the-back system inherently defensive?", "Three centre-backs can mean a back five, or it can free the wing-backs to attack.\n\nDoes the shape itself decide how defensive a team is, or is it all about instructions?"],
    ["How should a team handle a must-win game away from home?", "Some sides attack from the first minute, others try to quiet the crowd early.\n\nWhat is the right approach in a hostile away game you cannot afford to lose?"],
    ["What's the value of a player who can cover three positions?", "Versatility helps a squad, but specialists often reach a higher level.\n\nWould you rather have a reliable utility player or a specialist who only fits one role?"],
    ["Should penalties be taken by the best striker or the calmest player?", "Your top scorer may want the ball, but nerves and technique matter too.\n\nWho should take a decisive penalty, and how would you choose?"],
    ["Is the loan system good for player development?", "Loans can build confidence, but a bad loan can stall a career.\n\nWhat makes a loan successful, and when should a club keep a young player instead?"],
    ["What's the biggest mistake clubs make in the transfer window?", "Panic buys, overpaying for one good season and ignoring squad balance all happen every year.\n\nWhich mistake hurts a club most, and how would you avoid it?"],
    ["How do you judge a goalkeeper beyond save percentage?", "Command of the box, distribution and decision-making rarely show up in one number.\n\nWhat do you watch for in a keeper, and which stat is closest to the truth?"],
    ["Is pressing intensity sustainable over a full season?", "High pressing wins games, but fatigue and injuries build up.\n\nCan a team press flat out for 38 games, or does it need to pick its moments?"],
    ["What's the most underrated job in a football club?", "Analysts, physios, scouts and kit staff all shape a season in different ways.\n\nWhich role gets too little credit, and why does it matter?"],
    ["Do pre-season results tell you anything useful?", "Fitness and experimentation matter more than scorelines, but supporters still react.\n\nHow much should we read into pre-season, and what actually signals a team is ready?"],
    ["How important is a settled back four?", "Rotation keeps players fresh, but understanding between defenders takes time.\n\nIs a settled defence worth sacrificing freshness, or is rotation overrated?"],
    ["Is a squad's mentality more important than its talent?", "Talent wins individual moments, while mentality often decides tight games.\n\nWhich one would you trust over a long season, and how do you build the other?"],
    ["What's the best way to introduce a young academy player?", "A start in a cup game, a cameo off the bench or a loan spell all have risks.\n\nHow would you blood a talented academy player, and what support do they need?"],
    ["Should a manager adapt to the squad or impose a style?", "Some coaches build around their principles, others fit the system to the players.\n\nWhich approach works better, and when should a manager compromise?"],
    ["What's the line between a bold tactical call and a gamble?", "A surprise formation can win a game or backfire badly.\n\nHow do you judge a risky tactical decision, and what makes it justified?"],
    ["Which is harder: scoring goals or stopping them?", "Attacking gets the praise, but organising a defence is just as difficult.\n\nWhich side of the game is harder to get right, and what makes you say so?"],
];

// Pick the first prompt whose title is not already on the board recently, so the
// daily job does not keep re-posting the same discussion.
shuffle($prompts);
$since = now_ms() - 14 * DAY_MS;
$pick = null;
foreach ($prompts as $p) {
    $exists = val("SELECT 1 FROM topics WHERE board = ? AND deleted = 0 AND at >= ? AND title = ? LIMIT 1", [$board['slug'], $since, $p[0]]);
    if (!$exists) { $pick = $p; break; }
}
if (!$pick) { error_log("DAILY AI TOPIC [$slot]: every prompt exists within 14 days; skipping\n"); exit(0); }

// Rotate the author through the active characters that can post on football.
$chars = rows("SELECT c.id, u.name, c.profile_json FROM ai_characters c JOIN users u ON u.id = c.user_id WHERE c.active = 1 AND u.status = 'active' ORDER BY c.id ASC");
$eligible = [];
foreach ($chars as $c) {
    $profile = jdec($c['profile_json'], []);
    $behaviour = $profile['behaviour'] ?? [];
    if (in_array('football', $behaviour['allowed_boards'] ?? [], true)) $eligible[] = $c;
}
if (!$eligible) { error_log("DAILY AI TOPIC [$slot]: no eligible character found\n"); exit(1); }
$last = (int) (val("SELECT v FROM meta WHERE k = ?", ['ai_daily_topic_author']) ?? 0);
$lastPos = -1;
foreach ($eligible as $i => $c) if ((int) $c['id'] === $last) { $lastPos = $i; break; }
$authorRow = $eligible[($lastPos + 1) % count($eligible)];
$u = user_by_name((string) $authorRow['name']);
if (!$u || $u['status'] !== 'active') { error_log("DAILY AI TOPIC [$slot]: author account unavailable\n"); exit(1); }

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
meta_set('ai_daily_topic_author', (string) $authorRow['id']);

error_log("DAILY AI TOPIC [$slot]: created topic #{$id} on '{$board['slug']}' by {$u['name']}\n");
echo "Topic #{$id} created by {$u['name']} [$slot].\n";
