<?php
// interval_replies.php - one scheduled AI reply per run, rotating across the
// configured topic list. Cron: 17 */3 * * * php .../ai-community/interval_replies.php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../lib/api.php';
require_once __DIR__ . '/service.php';

if (!cfg('ai_community_enabled', false)) { echo "AI community disabled.\n"; exit(0); }
if (!ai_configured()) { echo "AI provider not configured.\n"; exit(0); }

ai_recover_stale_jobs();
ai_sync_interval_topics();

$raw = val("SELECT v FROM meta WHERE k = ?", ['ai_interval_topics']);
$ids = json_decode((string) $raw, true);
if (!is_array($ids) || !$ids) { echo "No scheduled topics configured.\n"; exit(0); }
$ids = array_values(array_filter(array_map('intval', $ids), static fn($v) => $v > 0));
if (!$ids) { echo "No valid scheduled topics.\n"; exit(0); }

$n = count($ids);
$cursor = (int) (val("SELECT v FROM meta WHERE k = ?", ['ai_interval_cursor']) ?? 0);
$topicId = $ids[$cursor % $n];

$topicAuthor = (string) (val("SELECT author FROM topics WHERE id = ?", [$topicId]) ?? '');
$chars = rows("SELECT c.id, u.name, c.profile_json FROM ai_characters c JOIN users u ON u.id = c.user_id WHERE c.active = 1 AND u.status = 'active' ORDER BY c.id ASC");
if (!$chars) { echo "No active characters.\n"; exit(0); }
$cn = count($chars);
$start = $cursor % $cn;

$queued = null;
for ($i = 0; $i < $cn; $i++) {
    $char = $chars[($start + $i) % $cn];
    if (($char['name'] ?? '') === $topicAuthor) continue;
    $profile = jdec($char['profile_json'], []);
    $behaviour = $profile['behaviour'] ?? [];
    if (empty($behaviour['can_reply'])) continue;
    try {
        $jobId = ai_queue_reply($topicId, (int) $char['id']);
        $queued = ['job' => $jobId, 'char' => (int) $char['id'], 'topic' => $topicId];
        break;
    } catch (Throwable $e) {
        // Board not allowed, daily limit reached, topic closed, etc. Try the next character.
    }
}

if (!$queued) {
    echo "No reply queued for topic #$topicId (limits or permissions).\n";
    log_line('ai-community.log', "interval: no reply queued for topic #$topicId");
    exit(0);
}

// Advance the rotation whether or not generation succeeds, so one topic cannot
// monopolise the queue.
meta_set('ai_interval_cursor', (string) ($cursor + 1));

$processed = ai_run_one();
log_line('ai-community.log', "interval: queued job #{$queued['job']} (topic #$topicId, character {$queued['char']}); processed=" . ($processed ? 'yes' : 'no'));
echo "Queued reply job #{$queued['job']} for topic #$topicId; processed=" . ($processed ? 'yes' : 'no') . ".\n";
