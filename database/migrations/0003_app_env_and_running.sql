-- App env vars (JSON object) and node running-apps snapshot from heartbeats
ALTER TABLE applications ADD COLUMN env_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE nodes ADD COLUMN running_apps_json TEXT NOT NULL DEFAULT '[]';
