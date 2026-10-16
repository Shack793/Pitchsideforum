# Pitchside AI module — offline review report

## What this package is

This is one integrated source snapshot. The earlier `topic-engine` and `moderation` ZIPs were successive snapshots, not two packages that should both be installed. The moderation snapshot already contained the topic engine plus moderation, with overlapping copies of the same service, CLI, schema and cron files.

## Changes made during this review

1. **Moderation scan starvation fixed.** The prior scan repeatedly selected the newest posts even when they already existed in the moderation queue. At busy times, that could prevent other posts in the scan window from ever being queued. The query now excludes already-queued post IDs and processes the oldest unqueued posts first. The unique key remains a second guard against duplicate queue entries.
2. **Thread approval output fixed.** The CLI now reports a published thread as a topic, rather than incorrectly calling it a reply post.
3. **Thread review output improved.** The review command displays a proposed title and body separately instead of printing the raw JSON draft.
4. **Added offline smoke tests.** These exercise prompt construction, cost calculations, default-disabled settings, schema presence, the moderation queue fix, CLI commands and cron integration.

## Checks run in this environment

- PHP syntax check: all 26 PHP files passed.
- Offline smoke tests: all 25 checks passed.
- CLI help command: ran successfully with a temporary non-secret test configuration.
- ZIP integrity: passed.

## Important limits

This environment has no PDO database drivers, no PHP cURL extension and no mbstring extension. The archive intentionally excludes the server's private `app/config.php`. Therefore, I could not run the database migration, connect to MySQL/MariaDB, execute a real provider request, or test publishing/moderation against a live or staging database. The existing forum self-test also cannot run without a real configuration and database.

**This is not a claim of production readiness.** Before enabling either worker, the package still needs a staging test on the actual hosting stack, including the database migration, a real metered AI request, approval/rejection, moderation hide/restore, permissions and rollback.

## Safe deployment notes

- Do not extract this entire archive over the live forum.
- Compare it against the currently deployed code and merge the intended changes only.
- Back up both files and database first; use staging before production.
- Keep `ai_community_enabled` and `ai_moderation_enabled` false until configuration and staging checks pass.
- Generated topics/replies remain in review; moderation triage does not automatically ban or suspend users.
