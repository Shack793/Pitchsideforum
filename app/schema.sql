-- Pitchside Forum database (MySQL 8 / MariaDB 10.6+). All times are milliseconds since 1970 (UTC).
-- install.php runs this file; it is safe to run again (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL,
  email VARCHAR(190) NOT NULL,
  pass VARCHAR(255) NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'new_member',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  suspended_until BIGINT NULL,
  warnings INT NOT NULL DEFAULT 0,
  email_verified TINYINT NOT NULL DEFAULT 0,
  joined BIGINT NOT NULL,
  posts INT NOT NULL DEFAULT 0,
  topics INT NOT NULL DEFAULT 0,
  likes INT NOT NULL DEFAULT 0,
  profile MEDIUMTEXT NULL,
  totp_secret VARCHAR(64) NULL,
  totp_on TINYINT NOT NULL DEFAULT 0,
  delete_after BIGINT NULL,
  last_seen BIGINT NOT NULL DEFAULT 0,
  updated BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY u_name (name),
  UNIQUE KEY u_email (email),
  KEY k_updated (updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  csrf CHAR(32) NOT NULL,
  pending_2fa TINYINT NOT NULL DEFAULT 0,
  created BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  ua VARCHAR(255) NOT NULL DEFAULT '',
  KEY k_user (user_id),
  KEY k_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tokens (
  id CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind VARCHAR(16) NOT NULL,
  expires BIGINT NOT NULL,
  KEY k_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS topics (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  board VARCHAR(64) NOT NULL,
  title VARCHAR(200) NOT NULL,
  author VARCHAR(32) NOT NULL,
  at BIGINT NOT NULL,
  last_at BIGINT NOT NULL,
  pinned TINYINT NOT NULL DEFAULT 0,
  locked TINYINT NOT NULL DEFAULT 0,
  archived TINYINT NOT NULL DEFAULT 0,
  deleted TINYINT NOT NULL DEFAULT 0,
  merged_into INT UNSIGNED NULL,
  auto TINYINT NOT NULL DEFAULT 0,
  tags TEXT NULL,
  teams TEXT NULL,
  league VARCHAR(64) NULL,
  event VARCHAR(128) NULL,
  views INT NOT NULL DEFAULT 0,
  poll MEDIUMTEXT NULL,
  updated BIGINT NOT NULL,
  KEY k_board (board, last_at),
  KEY k_updated (updated),
  KEY k_last (last_at),
  KEY k_author (author)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS posts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  topic_id INT UNSIGNED NOT NULL,
  author VARCHAR(32) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  at BIGINT NOT NULL,
  hidden TINYINT NOT NULL DEFAULT 0,
  revisions MEDIUMTEXT NULL,
  KEY k_topic (topic_id, at),
  KEY k_author (author, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INT UNSIGNED NOT NULL,
  user VARCHAR(32) NOT NULL,
  PRIMARY KEY (post_id, user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS poll_votes (
  topic_id INT UNSIGNED NOT NULL,
  user VARCHAR(32) NOT NULL,
  opt INT NOT NULL,
  PRIMARY KEY (topic_id, user, opt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follows (
  user VARCHAR(32) NOT NULL,
  k VARCHAR(160) NOT NULL,
  PRIMARY KEY (user, k),
  KEY k_key (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookmarks (
  user VARCHAR(32) NOT NULL,
  topic_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user, topic_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS topic_reads (
  user VARCHAR(32) NOT NULL,
  topic_id INT UNSIGNED NOT NULL,
  n INT NOT NULL,
  PRIMARY KEY (user, topic_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blocks (
  blocker VARCHAR(32) NOT NULL,
  blocked VARCHAR(32) NOT NULL,
  PRIMARY KEY (blocker, blocked),
  KEY k_blocked (blocked)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS convs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NULL,
  kind VARCHAR(16) NULL,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  KEY k_updated (updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conv_members (
  conv_id INT UNSIGNED NOT NULL,
  user VARCHAR(32) NOT NULL,
  read_n INT NOT NULL DEFAULT 0,
  pos INT NOT NULL DEFAULT 0,
  PRIMARY KEY (conv_id, user),
  KEY k_user (user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS msgs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conv_id INT UNSIGNED NOT NULL,
  from_user VARCHAR(32) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  at BIGINT NOT NULL,
  att TEXT NULL,
  notice TINYINT NOT NULL DEFAULT 0,
  reported TINYINT NOT NULL DEFAULT 0,
  KEY k_conv (conv_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  to_user VARCHAR(32) NOT NULL,
  type VARCHAR(24) NOT NULL,
  text VARCHAR(400) NOT NULL,
  go VARCHAR(255) NOT NULL,
  at BIGINT NOT NULL,
  is_read TINYINT NOT NULL DEFAULT 0,
  emailed TINYINT NOT NULL DEFAULT 0,
  updated BIGINT NOT NULL,
  KEY k_to (to_user, id),
  KEY k_updated (to_user, updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  queue VARCHAR(24) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  target TEXT NOT NULL,
  board VARCHAR(64) NULL,
  reason VARCHAR(1000) NOT NULL,
  by_user VARCHAR(32) NOT NULL,
  at BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  closed_by VARCHAR(32) NULL,
  closed_at BIGINT NULL,
  updated BIGINT NOT NULL,
  KEY k_status (status, queue),
  KEY k_updated (updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at BIGINT NOT NULL,
  actor VARCHAR(32) NOT NULL,
  action VARCHAR(80) NOT NULL,
  object VARCHAR(200) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  prev VARCHAR(400) NOT NULL,
  next VARCHAR(400) NOT NULL,
  KEY k_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS config (
  k VARCHAR(32) NOT NULL PRIMARY KEY,
  v MEDIUMTEXT NOT NULL,
  ver INT NOT NULL DEFAULT 1,
  updated BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS predictions (
  event VARCHAR(128) NOT NULL,
  user VARCHAR(32) NOT NULL,
  v CHAR(1) NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (event, user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ad_stats (
  kind VARCHAR(12) NOT NULL,
  ad_id INT NOT NULL,
  day CHAR(10) NOT NULL,
  imps INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, ad_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aff_clicks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  link INT NOT NULL,
  placement VARCHAR(24) NOT NULL,
  at BIGINT NOT NULL,
  visitor VARCHAR(40) NOT NULL,
  user VARCHAR(32) NULL,
  page VARCHAR(255) NOT NULL DEFAULT '',
  KEY k_link (link, at),
  KEY k_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_hits (
  k VARCHAR(190) NOT NULL,
  win BIGINT NOT NULL,
  n INT NOT NULL,
  PRIMARY KEY (k, win)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploads (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user VARCHAR(32) NOT NULL,
  path VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  bytes INT NOT NULL,
  mime VARCHAR(64) NOT NULL,
  at BIGINT NOT NULL,
  KEY k_user (user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Phase 2: casinos & sportsbooks, reviews, complaints, blacklist ----------
CREATE TABLE IF NOT EXISTS operators (
  slug VARCHAR(64) NOT NULL PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  KEY k_updated (updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  op VARCHAR(64) NOT NULL,
  user VARCHAR(32) NOT NULL,
  stars TINYINT NOT NULL,
  scores TEXT NULL,
  title VARCHAR(200) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'unverified',
  tx VARCHAR(120) NULL,
  at BIGINT NOT NULL,
  response MEDIUMTEXT NULL,
  history MEDIUMTEXT NULL,
  thread INT UNSIGNED NULL,
  updated BIGINT NOT NULL,
  KEY k_op (op, at),
  KEY k_user (user),
  KEY k_updated (updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS review_votes (
  review_id INT UNSIGNED NOT NULL,
  user VARCHAR(32) NOT NULL,
  v TINYINT NOT NULL,
  PRIMARY KEY (review_id, user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS complaints (
  id VARCHAR(16) NOT NULL PRIMARY KEY,
  seq INT NOT NULL,
  op VARCHAR(64) NOT NULL,
  user VARCHAR(32) NOT NULL,
  title VARCHAR(200) NOT NULL,
  cat VARCHAR(60) NOT NULL,
  amount INT NOT NULL DEFAULT 0,
  refunded INT NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'Open',
  at BIGINT NOT NULL,
  deadline BIGINT NULL,
  specialist VARCHAR(32) NULL,
  statement MEDIUMTEXT NOT NULL,
  evidence MEDIUMTEXT NULL,
  mod_notes MEDIUMTEXT NULL,
  support TINYINT NOT NULL DEFAULT 1,
  thread INT UNSIGNED NULL,
  updated BIGINT NOT NULL,
  UNIQUE KEY u_seq (seq),
  KEY k_op (op),
  KEY k_user (user),
  KEY k_status (status),
  KEY k_updated (updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS complaint_msgs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  complaint_id VARCHAR(16) NOT NULL,
  by_user VARCHAR(32) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  at BIGINT NOT NULL,
  role VARCHAR(16) NULL,
  KEY k_c (complaint_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS complaint_follows (
  complaint_id VARCHAR(16) NOT NULL,
  user VARCHAR(32) NOT NULL,
  PRIMARY KEY (complaint_id, user),
  KEY k_user (user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- AI community module tables. Also copied into app/schema.sql for fresh installs.
CREATE TABLE IF NOT EXISTS ai_characters (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  profile_json MEDIUMTEXT NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  UNIQUE KEY u_ai_character_user (user_id),
  KEY k_ai_character_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_jobs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_type VARCHAR(24) NOT NULL,
  character_id INT UNSIGNED NOT NULL,
  topic_id INT UNSIGNED NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  idempotency_key VARCHAR(128) NOT NULL,
  draft_body MEDIUMTEXT NULL,
  result_json MEDIUMTEXT NULL,
  error_message VARCHAR(500) NULL,
  attempts INT NOT NULL DEFAULT 0,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  UNIQUE KEY u_ai_job_idempotency (idempotency_key),
  KEY k_ai_job_queue (status, created),
  KEY k_ai_job_topic (topic_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_activity_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT UNSIGNED NULL,
  character_id INT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  result VARCHAR(40) NOT NULL,
  post_id INT UNSIGNED NULL,
  details MEDIUMTEXT NULL,
  created BIGINT NOT NULL,
  KEY k_ai_log_job (job_id),
  KEY k_ai_log_created (created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT UNSIGNED NOT NULL,
  model VARCHAR(120) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  created BIGINT NOT NULL,
  UNIQUE KEY u_ai_usage_job (job_id),
  KEY k_ai_usage_created (created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI moderation queue and metered usage.

CREATE TABLE IF NOT EXISTS ai_moderation_queue (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  topic_id INT UNSIGNED NOT NULL,
  content_hash CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  category VARCHAR(40) NULL,
  severity VARCHAR(16) NULL,
  confidence DECIMAL(5,4) NULL,
  rationale VARCHAR(1000) NULL,
  recommended_action VARCHAR(24) NULL,
  decision VARCHAR(24) NULL,
  reviewer VARCHAR(64) NULL,
  review_note VARCHAR(1000) NULL,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  UNIQUE KEY u_ai_moderation_post (post_id),
  KEY k_ai_moderation_queue (status, created),
  KEY k_ai_moderation_topic (topic_id),
  KEY k_ai_moderation_severity (severity, confidence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_moderation_usage (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  queue_id INT UNSIGNED NOT NULL,
  model VARCHAR(120) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  created BIGINT NOT NULL,
  UNIQUE KEY u_ai_moderation_usage_queue (queue_id),
  KEY k_ai_moderation_usage_created (created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Weekly raffle (free to enter; one entry per member and per device) ----------
CREATE TABLE IF NOT EXISTS raffle_rounds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  prize VARCHAR(80) NOT NULL,
  prize_note VARCHAR(300) NOT NULL DEFAULT '',
  starts BIGINT NOT NULL,
  ends BIGINT NOT NULL,
  min_members INT NOT NULL DEFAULT 100,
  min_topics INT NOT NULL DEFAULT 1,
  min_posts INT NOT NULL DEFAULT 25,
  block_ip TINYINT NOT NULL DEFAULT 0,
  wallet_days INT NOT NULL DEFAULT 14,
  rules MEDIUMTEXT NULL,
  rules_at BIGINT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  winner VARCHAR(32) NULL,
  winner_entry INT NULL,
  drawn_at BIGINT NULL,
  draw_info MEDIUMTEXT NULL,
  wallet_network VARCHAR(16) NULL,
  wallet_addr VARCHAR(120) NULL,
  wallet_at BIGINT NULL,
  paid_tx VARCHAR(140) NULL,
  paid_at BIGINT NULL,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  KEY k_raffle_status (status, ends)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raffle_entries (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  round_id INT UNSIGNED NOT NULL,
  user VARCHAR(32) NOT NULL,
  at BIGINT NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  dev_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ok',
  note VARCHAR(255) NOT NULL DEFAULT '',
  UNIQUE KEY u_raffle_entry (round_id, user),
  KEY k_raffle_ip (round_id, ip_hash),
  KEY k_raffle_dev (round_id, dev_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
