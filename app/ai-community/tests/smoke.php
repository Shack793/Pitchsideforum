<?php
// Offline smoke tests for the AI module. These test pure logic and packaging only;
// they do not replace a MySQL/MariaDB + cURL provider integration test.
declare(strict_types=1);

$GLOBALS['TEST_CFG'] = [
  'ai_community_enabled' => false,
  'ai_moderation_enabled' => false,
  'ai_api_key' => '',
  'ai_model' => '',
  'ai_input_price_per_million' => 0.10,
  'ai_output_price_per_million' => 0.40,
];
function cfg(string $k, $def = null) { return $GLOBALS['TEST_CFG'][$k] ?? $def; }
if (!function_exists('mb_substr')) { function mb_substr(string $s, int $start, ?int $length = null, ?string $encoding = null): string { return $length === null ? substr($s, $start) : substr($s, $start, $length); } }
if (!function_exists('mb_strlen')) { function mb_strlen(string $s, ?string $encoding = null): int { return strlen($s); } }
if (!function_exists('mb_strtolower')) { function mb_strtolower(string $s, ?string $encoding = null): string { return strtolower($s); } }
if (!function_exists('jenc')) { function jenc($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); } }
require dirname(__DIR__) . '/service.php';

$checks = 0;
function check(bool $condition, string $message): void {
  global $checks; $checks++;
  if (!$condition) { fwrite(STDERR, "FAIL: $message\n"); exit(1); }
  echo "PASS: $message\n";
}

$persona = [
  'display_name' => 'Test Character', 'username' => 'test_character',
  'bio' => 'A fictional football discussion character.',
  'interests' => ['football', 'tactics'],
  'writing_style' => ['tone' => 'friendly', 'sentence_length' => 'short', 'slang' => 'low', 'emoji_frequency' => 'low'],
  'memory_summary' => 'Supports thoughtful football discussion.',
];
$context = ['topic' => ['title' => 'How should the team change its midfield?', 'board' => 'football'], 'posts' => [
  ['author' => 'member_a', 'body' => 'The midfield needs more pace.', 'at' => 100],
  ['author' => 'member_b', 'body' => 'I think ball retention matters more.', 'at' => 101],
]];
$reply = ai_prompt_messages($persona, $context);
check(count($reply) === 2 && $reply[0]['role'] === 'system' && $reply[1]['role'] === 'user', 'reply prompt has system/user message structure');
check(str_contains($reply[0]['content'], 'fictional AI community character'), 'reply prompt identifies fictional character context');
check(str_contains($reply[1]['content'], 'The midfield needs more pace.'), 'reply prompt includes recent discussion context');
check(str_contains($reply[0]['content'], 'respond exactly with SKIP'), 'reply prompt can skip irrelevant contributions');
$thread = ai_thread_prompt_messages($persona, $context);
check(count($thread) === 2 && str_contains($thread[0]['content'], 'new discussion topic'), 'thread prompt requests a new discussion');
check(str_contains($thread[1]['content'], 'ball retention matters more'), 'thread prompt includes the source discussion');
check(abs(ai_estimated_cost(1000000, 500000) - 0.30) < 0.000001, 'token-cost calculation uses configured per-million prices');
$GLOBALS['TEST_CFG']['ai_input_price_per_million'] = 0;
$thrown = false;
try { ai_estimated_cost(100, 100); } catch (RuntimeException $e) { $thrown = true; }
check($thrown, 'cost calculation refuses missing/zero prices');
check(ai_configured() === false, 'generation remains disabled by default in test configuration');
check(ai_estimate_tokens('abcd') === 1, 'token estimator floors at one token');
check(ai_estimate_tokens(str_repeat('a', 9)) === 3, 'token estimator scales with text length');
$GLOBALS['TEST_CFG']['ai_free_tier'] = true;
check(ai_record_cost(0.5) === 0.0, 'free tier records zero cost');
$GLOBALS['TEST_CFG']['ai_free_tier'] = false;
check(ai_record_cost(0.5) === 0.5, 'paid tier records the priced estimate');
check(ai_moderation_configured() === false, 'moderation remains disabled by default in test configuration');

$root = dirname(__DIR__, 2); // app/
$moduleSchema = file_get_contents(dirname(__DIR__) . '/schema.sql');
$appSchema = file_get_contents($root . '/schema.sql');
$requiredTables = ['ai_characters', 'ai_jobs', 'ai_activity_log', 'ai_usage', 'ai_moderation_queue', 'ai_moderation_usage'];
foreach ($requiredTables as $table) {
  check(str_contains((string)$moduleSchema, 'CREATE TABLE IF NOT EXISTS ' . $table), "module migration defines $table");
  check(str_contains((string)$appSchema, 'CREATE TABLE IF NOT EXISTS ' . $table), "fresh-install schema defines $table");
}
$service = file_get_contents(dirname(__DIR__) . '/service.php');
$cli = file_get_contents(dirname(__DIR__) . '/cli.php');
$cron = file_get_contents($root . '/cron.php');
check(str_contains((string)$service, 'NOT EXISTS (SELECT 1 FROM ai_moderation_queue mq WHERE mq.post_id = p.id)'), 'moderation scan excludes posts already queued');
check(str_contains((string)$service, 'ORDER BY p.at ASC, p.id ASC'), 'moderation scan processes oldest unqueued posts first');
check(str_contains((string)$cli, "case 'queue-thread':") && str_contains((string)$cli, "case 'mod-scan':"), 'single CLI includes topic-generation and moderation commands');
check(str_contains((string)$cron, 'ai_community_cron();') && str_contains((string)$cron, 'ai_moderation_cron();'), 'existing cron hook contains both workers');
check(str_contains((string)$service, "cfg('ai_auto_publish', false)"), 'automatic publishing is explicitly opt-in');
check(str_contains((string)$service, 'ai_daily_publish_cap') && str_contains((string)$service, 'ai_daily_cap_reached'), 'global daily publishing ceiling is enforced');
check(str_contains((string)$service, 'ai_estimate_tokens') && str_contains((string)$service, 'usage_estimated'), 'providers omitting usage fall back to flagged local estimates');
check(str_contains((string)$service, "cfg('ai_free_tier', false)"), 'free-tier billing records zero cost while tracking tokens');
check(str_contains((string)$service, 'function ai_discover_reply_candidate'), 'cron can discover replies to recent member discussions');
check(str_contains((string)$service, 'ai_review_backlog_limit'), 'review backlog is bounded so uncertain drafts do not accumulate indefinitely');

echo "\nOffline smoke tests passed: $checks checks.\n";
echo "LIMITATION: No PDO drivers, cURL extension, or mbstring are available in this test environment; database migration and live provider calls were not run.\n";
