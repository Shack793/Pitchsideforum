<?php
// CLI controls for the AI Community pilot. Never callable over HTTP.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../lib/api.php';
require_once __DIR__ . '/service.php';

$args = $argv; array_shift($args); $command = $args[0] ?? 'help';
function ai_cli_help(): void {
  echo <<<TXT
Pitchside AI Community pilot CLI

Commands:
  php app/ai-community/migrate.php
  php app/ai-community/cli.php character-add <username> <display-name> <bio> <comma-separated-interests> <board-slug>
  php app/ai-community/cli.php queue-reply <topic-id> <character-username>
  php app/ai-community/cli.php queue-thread <source-topic-id> <character-username>
  php app/ai-community/cli.php run-one
  php app/ai-community/cli.php review
  php app/ai-community/cli.php approve <job-id>
  php app/ai-community/cli.php reject <job-id> [reason]
  php app/ai-community/cli.php status
  php app/ai-community/cli.php mod-scan [hours=24] [limit=200]
  php app/ai-community/cli.php mod-run
  php app/ai-community/cli.php mod-review
  php app/ai-community/cli.php mod-retry <queue-id>
  php app/ai-community/cli.php mod-resolve <queue-id> <dismiss|hide> <reason>
  php app/ai-community/cli.php mod-restore <queue-id> <reason>

AI generation is disabled unless ai_community_enabled is true in app/config.php.
Generated replies enter review; they are not published automatically.
TXT;
}
try {
  switch ($command) {
    case 'character-add':
      if (count($args) < 6) throw new RuntimeException('Usage: character-add <username> <display-name> <bio> <comma-separated-interests> <board-slug>');
      $id = ai_add_character($args[1], $args[2], $args[3], explode(',', $args[4]), $args[5]);
      echo "Created character ID $id and forum account {$args[1]}.\n"; break;
    case 'queue-reply':
      if (count($args) !== 3 || !ctype_digit($args[1])) throw new RuntimeException('Usage: queue-reply <topic-id> <character-username>');
      $c = ai_character_by_username($args[2]); if (!$c) throw new RuntimeException('Character username not found.');
      $id = ai_queue_reply((int) $args[1], (int) $c['id']); echo "Queued reply job #$id. It will generate a draft for review.\n"; break;
    case 'queue-thread':
      if (count($args) !== 3 || !ctype_digit($args[1])) throw new RuntimeException('Usage: queue-thread <source-topic-id> <character-username>');
      $c = ai_character_by_username($args[2]); if (!$c) throw new RuntimeException('Character username not found.');
      $id = ai_queue_thread((int) $args[1], (int) $c['id']); echo "Queued new-thread draft job #$id. It will generate a proposed thread for review, not publish it.\n"; break;
    case 'run-one':
      if (!ai_configured()) throw new RuntimeException('AI generation is disabled or not configured. See app/ai-community/README.md.');
      ai_recover_stale_jobs(); echo ai_run_one() ? "Processed one job. Check review/status.\n" : "No queued job processed (empty queue, budget reached, or another worker claimed it).\n"; break;
    case 'review':
      foreach (rows("SELECT j.id, j.job_type, j.topic_id, u.name AS character_name, j.status, j.draft_body, j.error_message, j.updated FROM ai_jobs j JOIN ai_characters c ON c.id = j.character_id JOIN users u ON u.id = c.user_id WHERE j.status IN ('review','failed','rejected') ORDER BY j.id DESC LIMIT 50") as $r) {
        echo "\n#{$r['id']} {$r['status']} / {$r['character_name']} / topic {$r['topic_id']}\n";
        if ($r['draft_body']) {
          if ($r['job_type'] === 'thread') {
            $draft = json_decode((string)$r['draft_body'], true);
            if (is_array($draft)) {
              echo 'Proposed title: ' . ($draft['title'] ?? '[missing title]') . "\n";
              echo 'Proposed body: ' . ($draft['body'] ?? '[missing body]') . "\n";
            } else echo $r['draft_body'] . "\n";
          } else echo $r['draft_body'] . "\n";
        }
        if ($r['error_message']) echo 'Error: ' . $r['error_message'] . "\n";
      } break;
    case 'approve':
      if (count($args) !== 2 || !ctype_digit($args[1])) throw new RuntimeException('Usage: approve <job-id>');
      $jobType = val("SELECT job_type FROM ai_jobs WHERE id = ? AND status = 'review'", [(int) $args[1]]);
      $publishedId = ai_publish_job((int) $args[1]);
      echo $jobType === 'thread' ? "Published reviewed thread as topic #$publishedId.\n" : "Published reviewed reply as post #$publishedId.\n";
      break;
    case 'reject':
      if (count($args) < 2 || !ctype_digit($args[1])) throw new RuntimeException('Usage: reject <job-id> [reason]');
      $reason = mb_substr(implode(' ', array_slice($args, 2)) ?: 'Rejected during review', 0, 480);
      $st = q("UPDATE ai_jobs SET status = 'rejected', error_message = ?, updated = ? WHERE id = ? AND status = 'review'", [$reason, now_ms(), (int) $args[1]]);
      if ($st->rowCount() !== 1) throw new RuntimeException('Job is not awaiting review.');
      ai_log((int) $args[1], null, 'reply.review', 'rejected', null, ['reason' => $reason]); echo "Rejected job #{$args[1]}.\n"; break;
    case 'mod-scan':
      $hours = isset($args[1]) && ctype_digit($args[1]) ? (int)$args[1] : 24;
      $limit = isset($args[2]) && ctype_digit($args[2]) ? (int)$args[2] : 200;
      echo 'Queued ' . ai_moderation_scan($hours, $limit) . " new posts for moderation triage.\n"; break;
    case 'mod-run':
      if (!ai_moderation_configured()) throw new RuntimeException('AI moderation is disabled or not configured. Set ai_moderation_enabled, provider credentials and pricing in app/config.php.');
      echo ai_moderation_run_one() ? "Processed one moderation item. Check mod-review.\n" : "No moderation item processed (empty queue, budget reached, or worker error). Check ai-moderation.log.\n"; break;
    case 'mod-review':
      foreach (rows("SELECT q.id,q.post_id,q.topic_id,q.status,q.category,q.severity,q.confidence,q.rationale,q.created,p.author,t.title,t.board FROM ai_moderation_queue q LEFT JOIN posts p ON p.id=q.post_id LEFT JOIN topics t ON t.id=q.topic_id WHERE q.status IN ('review','failed','working') ORDER BY CASE q.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, q.confidence DESC, q.id DESC LIMIT 100") as $r) {
        echo "\n#{$r['id']} post #{$r['post_id']} / {$r['status']} / {$r['severity']} / {$r['category']} / confidence {$r['confidence']}\n";
        echo 'Board/topic: ' . ($r['board'] ?? '?') . ' / ' . ($r['title'] ?? '[missing topic]') . "\nAuthor: " . ($r['author'] ?? '?') . "\nReason: " . ($r['rationale'] ?? '') . "\n";
      } break;
    case 'mod-retry':
      if (count($args) !== 2 || !ctype_digit($args[1])) throw new RuntimeException('Usage: mod-retry <queue-id>');
      $st=q("UPDATE ai_moderation_queue SET status='queued',category=NULL,severity=NULL,confidence=NULL,rationale=NULL,recommended_action=NULL,updated=? WHERE id=? AND status='failed'",[now_ms(),(int)$args[1]]);
      if ($st->rowCount()!==1) throw new RuntimeException('Item is not in failed status.');
      echo "Requeued moderation item #{$args[1]}.\n"; break;
    case 'mod-resolve':
      if (count($args) < 4 || !ctype_digit($args[1]) || !in_array($args[2], ['dismiss','hide'], true)) throw new RuntimeException('Usage: mod-resolve <queue-id> <dismiss|hide> <reason>');
      $qid=(int)$args[1]; $decision=$args[2]; $reason=mb_substr(implode(' ',array_slice($args,3)),0,1000);
      if (mb_strlen($reason)<3) throw new RuntimeException('Provide a meaningful reason.');
      $item=row("SELECT q.*,p.hidden FROM ai_moderation_queue q LEFT JOIN posts p ON p.id=q.post_id WHERE q.id=?",[$qid]);
      if (!$item || $item['status']!=='review') throw new RuntimeException('Item is not awaiting moderation review.');
      if ($decision==='hide') {
        if ($item['hidden']===null) throw new RuntimeException('The post no longer exists.');
        q("UPDATE posts SET hidden=1 WHERE id=?",[(int)$item['post_id']]); touch_topic((int)$item['topic_id']);
      }
      q("UPDATE ai_moderation_queue SET status=?,decision=?,reviewer='cli-admin',review_note=?,updated=? WHERE id=? AND status='review'",[$decision==='hide'?'hidden':'dismissed',$decision,$reason,now_ms(),$qid]);
      echo "Moderation item #$qid marked $decision.\n"; break;
    case 'mod-restore':
      if (count($args) < 3 || !ctype_digit($args[1])) throw new RuntimeException('Usage: mod-restore <queue-id> <reason>');
      $qid=(int)$args[1]; $reason=mb_substr(implode(' ',array_slice($args,2)),0,1000);
      $item=row("SELECT * FROM ai_moderation_queue WHERE id=? AND status='hidden' AND decision='hide'",[$qid]);
      if (!$item) throw new RuntimeException('Item is not a post hidden by this AI moderation queue.');
      q("UPDATE posts SET hidden=0 WHERE id=?",[(int)$item['post_id']]); touch_topic((int)$item['topic_id']);
      q("UPDATE ai_moderation_queue SET status='restored',decision='restore',reviewer='cli-admin',review_note=?,updated=? WHERE id=?",[$reason,now_ms(),$qid]);
      echo "Post restored for moderation item #$qid.\n"; break;
    case 'status':
      echo 'AI enabled: ' . (cfg('ai_community_enabled', false) ? 'yes' : 'no') . "\n";
      echo 'AI configured: ' . (ai_configured() ? 'yes' : 'no') . "\n";
      echo 'Monthly spend estimate: $' . number_format(ai_monthly_cost(), 6) . "\n";
      foreach (rows("SELECT status, COUNT(*) AS n FROM ai_jobs GROUP BY status") as $r) echo $r['status'] . ': ' . $r['n'] . "\n";
      echo 'Active characters: ' . val("SELECT COUNT(*) FROM ai_characters WHERE active = 1") . "\n";
      try { foreach (rows("SELECT status,COUNT(*) AS n FROM ai_moderation_queue GROUP BY status") as $r) echo 'Moderation ' . $r['status'] . ': ' . $r['n'] . "\n"; } catch (Throwable $e) {}
      break;
    default: ai_cli_help();
  }
} catch (Throwable $e) { fwrite(STDERR, 'ERROR: ' . $e->getMessage() . "\n"); exit(1); }
