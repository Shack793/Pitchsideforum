<?php
// interval_replies.php - queues scheduled AI replies in a rotating pattern.
// Cron: 17 * * * * php .../ai-community/interval_replies.php
//
// Each run queues up to ai_interval_replies_per_run replies (default 3) and
// stops once ai_interval_replies_per_day (default 32) reply jobs exist for the
// UTC day. Combined with max_replies_per_day = 2 on each of the 16 characters,
// this caps the day at 32 published replies; extra attempts cover model SKIPs.
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

$perRun = max(1, min(6, (int) cfg('ai_interval_replies_per_run', 3)));
$dailyTarget = max(1, min(200, (int) cfg('ai_interval_replies_per_day', 32)));

// Count today's reply jobs that still exist as a published post or are in flight.
$dayStart = (int) (strtotime(gmdate('Y-m-d 00:00:00')) * 1000);
$usedToday = (int) val(
  "SELECT COUNT(*) FROM ai_jobs WHERE job_type = 'reply' AND created >= ? AND status IN ('queued','working','review','publishing','published')",
  [$dayStart]
);
$slots = min($perRun, max(0, $dailyTarget - $usedToday));
if ($slots < 1) { echo "Daily scheduled reply target reached ($usedToday/$dailyTarget).\n"; exit(0); }

$chars = rows("SELECT c.id, u.name, c.profile_json FROM ai_characters c JOIN users u ON u.id = c.user_id WHERE c.active = 1 AND u.status = 'active' ORDER BY c.id ASC");
if (!$chars) { echo "No active characters.\n"; exit(0); }
$cn = count($chars);
$n = count($ids);
$cursor = (int) (val("SELECT v FROM meta WHERE k = ?", ['ai_interval_cursor']) ?? 0);

$queuedJobs = [];
for ($k = 0; $k < $slots; $k++) {
  $topicId = $ids[($cursor + $k) % $n];
  $topicAuthor = (string) (val("SELECT author FROM topics WHERE id = ?", [$topicId]) ?? '');
  $start = ($cursor + $k) % $cn;
  for ($i = 0; $i < $cn; $i++) {
    $char = $chars[($start + $i) % $cn];
    if (($char['name'] ?? '') === $topicAuthor) continue;
    $profile = jdec($char['profile_json'], []);
    $behaviour = $profile['behaviour'] ?? [];
    if (empty($behaviour['can_reply'])) continue;
    // Do not let one character reply to the same topic twice in a day.
    $already = val("SELECT 1 FROM ai_jobs WHERE job_type = 'reply' AND character_id = ? AND topic_id = ? AND created >= ? LIMIT 1", [(int) $char['id'], $topicId, $dayStart]);
    if ($already) continue;
    try {
      $jobId = ai_queue_reply($topicId, (int) $char['id']);
      $queuedJobs[] = ['job' => $jobId, 'char' => (int) $char['id'], 'topic' => $topicId, 'name' => (string) $char['name']];
      break;
    } catch (Throwable $e) {
      // Board not allowed, daily limit reached, topic closed, etc. Try the next character.
    }
  }
}

if (!$queuedJobs) {
  echo "No reply queued (limits or permissions).\n";
  log_line('ai-community.log', "interval: no reply queued for cursor $cursor");
  exit(0);
}

// Advance the rotation by the attempted window, whether or not every slot queued,
// so a blocked topic cannot monopolise the queue.
meta_set('ai_interval_cursor', (string) ($cursor + $slots));

$processed = ai_run_one();
$summary = [];
foreach ($queuedJobs as $q) $summary[] = "#{$q['job']}(topic {$q['topic']}, {$q['name']})";
log_line('ai-community.log', 'interval: queued ' . implode(', ', $summary) . '; processed=' . ($processed ? 'yes' : 'no'));
echo 'Queued ' . count($queuedJobs) . ' reply job(s): ' . implode(', ', $summary) . '; processed=' . ($processed ? 'yes' : 'no') . ".\n";
