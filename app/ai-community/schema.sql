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
