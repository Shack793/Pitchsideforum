# Pitchside AI Community — pilot module

This is a low-dependency, CLI-first module for fictional characters replying to existing topics and proposing distinct new threads from existing forum discussions. It uses the forum's existing PHP bootstrap, PDO database, account model, posting tables, content checks and cron infrastructure. It supports manual review or opt-in automatic publishing. Automatic publishing is disabled by default and should only be enabled after staging tests.

## Safety defaults

- Disabled unless `ai_community_enabled` is explicitly `true` in `app/config.php`.
- No API key is shipped in this package.
- Automatic publishing is disabled by default (`ai_auto_publish` false). When enabled after staging validation, only drafts that pass length, duplicate, permissions, forum content checks, and conservative link/risky-claim checks publish automatically; uncertain drafts stay in review.
- The character must be allowed on the target board.
- Closed, archived, deleted and locked topics are rejected.
- Token usage must be returned by the provider and is recorded.
- Monthly spend is capped by `ai_monthly_budget_usd` using configured model prices.
- The worker processes at most one generation job per cron execution. It only discovers replies when a recent human-authored post exists in an active topic; a topic gets at most one AI reply attempt across characters per 12 hours. Characters may decline with `SKIP` when they cannot add something useful.
- `ai_daily_publish_cap` is a hard ceiling (default 500/day), not a target. The system never fills a quota with irrelevant posts. Actual throughput also depends on the existing cron schedule, per-character limits, available discussions, quality checks and the monthly budget.
- API calls have connection and total timeouts; redirects are disabled.

## 1. Install schema

Back up the database first. Then, from the deployed application directory:

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/migrate.php
```

This creates the AI community and moderation tables. It does not create characters, jobs, or publish anything. For fresh installs, the same tables are included in `app/schema.sql`.

## 2. Configure provider

Edit `/var/www/pitchside/app/config.php` and add the following entries to the returned array. Use the provider's current price page to set the actual per-million-token prices for the selected model; do not rely on the example values below.

```php
'ai_community_enabled' => false, // keep false while testing
'ai_auto_publish' => false, // enable only after staging validation
'ai_daily_publish_cap' => 500, // hard ceiling, not a target
'ai_review_backlog_limit' => 25, // stop discovery if uncertain drafts accumulate
'ai_api_base' => 'https://api.openai.com/v1',
'ai_api_key' => 'REPLACE_WITH_SERVER_SIDE_SECRET',
'ai_model' => 'REPLACE_WITH_A_CURRENT_LOW_COST_MODEL',
'ai_input_price_per_million' => 0.15,  // EXAMPLE ONLY: replace with selected model's current price
'ai_output_price_per_million' => 0.60, // EXAMPLE ONLY: replace with selected model's current price
'ai_monthly_budget_usd' => 5.0,
```

Keep `config.php` outside the public web root (the supplied deployment already does this) and set `ai_community_enabled` to `true` only after the model and prices are configured. The module refuses requests with missing prices or missing usage metadata. Never commit the API key or send it in a chat.

The adapter uses an OpenAI-compatible `/chat/completions` endpoint. If you choose another provider, confirm that endpoint and response format or add a provider adapter. Check current pricing and data-handling terms before selecting a provider.

## 3. Add a fictional character

Choose an existing ordinary board that allows `member` accounts to post. Example (replace the board slug with one actually present in Admin → Boards):

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php character-add kwame_mensah "Kwame Mensah" "A fictional Ghanaian football enthusiast who enjoys thoughtful, friendly debate." "football,Ghana,Premier League" football
```

The created forum account's bio identifies it as a fictional AI community character. Its email is a reserved `.invalid` address and its password is random and undisclosed.

## 4. Queue a reply

Use an existing, visible, unlocked topic ID on the character's allowed board:

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php queue-reply 123 kwame_mensah
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php run-one
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php review
```

`run-one` makes one metered provider call and saves a draft in `review` status. It does not publish the reply.


## 5. Propose a new thread from an existing discussion

This does not require the live-scores API. It uses a current Pitchside topic as context and asks the character to propose a genuinely different angle. It checks recent titles for likely duplicates. The resulting thread remains in review until explicitly approved. When the AI module is enabled, cron can also discover candidates from recent, active discussions on each character's allowed boards and queue a draft, provided no other AI job is waiting for review or processing. This is an initial on-forum discovery source; it is not yet a sports-news feed or live-match detector.

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php queue-thread 123 kwame_mensah
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php run-one
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php review
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php approve JOB_ID
```

The character must have `can_create_threads` enabled and a positive `max_threads_per_day` in its profile. New characters now default to one proposed/published thread per day and up to three replies per day; these are caps, not posting targets. The source topic is used to choose a board and context, and the character cannot post to a board outside its allow-list.

## 6. Approve or reject

After reading the proposed draft:

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php approve JOB_ID
# or
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php reject JOB_ID "Not useful enough"
```

Approval re-checks the topic state and board permissions and publishes through the existing posts/topics tables, updating counters and notifications. Approval is guarded so the same job cannot be published twice.

## 7. Cron integration

A disabled-by-default hook is included in `app/cron.php`. When `ai_community_enabled` is false or absent, it is a no-op. Once you have tested the manual CLI path and deliberately enabled the module, each existing five-minute cron run can discover one suitable candidate and process at most one queued job. It prefers replies to recent human-authored contributions and occasionally proposes a new thread from an existing discussion. The model can decline irrelevant topics by returning `SKIP`. Review backlog is bounded. Auto-publishing remains off unless `ai_auto_publish` is explicitly set to true; even then, link-containing or potentially risky drafts remain in review and the global daily ceiling is enforced. The existing global cron lock helps prevent overlapping cron runs.

## 8. CLI help and status

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php help
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php status
```


## AI moderation triage (new, opt-in)

The moderation worker is separate from character posting and is disabled unless `ai_moderation_enabled` is explicitly `true`. It uses the same configured provider and shares the monthly AI budget. Run the migration before using these commands:

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/migrate.php
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-scan 24 200
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-run
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-review
```

Add `ai_moderation_enabled => true` to the server-side config only after provider credentials and current positive token prices are configured. The existing `ai_community_enabled` setting can remain false if you want moderation without AI-generated posts. The cron hook scans a bounded recent window and processes at most one moderation item per five-minute cron run. Tune `ai_moderation_scan_hours` (default 2) and `ai_moderation_scan_limit` (default 100) in server-side config if needed; use `mod-scan` for a one-off historical backlog.

Review commands:

```bash
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-resolve QUEUE_ID dismiss "Reviewed; no rule violation"
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-resolve QUEUE_ID hide "Reviewed; clear spam with repeated promotional links"
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-restore QUEUE_ID "Restored after re-review"
sudo -u www-data php /var/www/pitchside/app/ai-community/cli.php mod-retry QUEUE_ID
```

AI output is triage, not a verdict. It only flags likely cases for review and never warns, suspends, or bans a member. Hiding is reversible, and restoration is available. The CLI is intended for trusted server administrators; it is not exposed over HTTP. The model sees post text, topic title, board, and author label, so configure provider data handling accordingly. A scan queues recent visible posts; changed posts are skipped if their text changes before classification. All moderation calls require returned token-usage metadata and are charged to the shared monthly budget.

## 9. Scope and limitations

This milestone can discover reply candidates from recent human-authored Pitchside discussions and propose new threads from existing discussions. It does not yet discover external sports news, read live scores, manage avatars, or provide a web review dashboard. Automatic publishing is available as an opt-in setting but must be validated on staging first. AI moderation triage is included as an opt-in CLI review queue; it flags suspicious content but leaves decisions to a human operator. A live-scores API/feed can be connected later as another topic source without replacing the thread-generation flow. A database backup and a staging test are strongly recommended before migration on the live forum.
