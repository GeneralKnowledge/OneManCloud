-- OneManCloud D1 schema (SQLite-compatible)

CREATE TABLE IF NOT EXISTS configuration (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  hostname TEXT,
  arch TEXT,
  cpu_count INTEGER,
  memory_mb INTEGER,
  disk_gb INTEGER,
  agent_version TEXT,
  last_heartbeat_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_heartbeat ON nodes(last_heartbeat_at);

CREATE TABLE IF NOT EXISTS node_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_node_tokens_node ON node_tokens(node_id);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  runtime TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_repo TEXT,
  source_image TEXT,
  source_args_json TEXT,
  memory_mb INTEGER NOT NULL,
  cpu INTEGER NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  sleep INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  node_id TEXT,
  status TEXT NOT NULL,
  public_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id),
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_deployments_app ON deployments(application_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  application_id TEXT,
  node_id TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (application_id) REFERENCES applications(id),
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_node ON jobs(node_id);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  line TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id, seq);

INSERT OR IGNORE INTO configuration (key, value, updated_at)
VALUES
  ('heartbeat_timeout_seconds', '90', strftime('%s','now') * 1000),
  ('base_domain', '', strftime('%s','now') * 1000);
