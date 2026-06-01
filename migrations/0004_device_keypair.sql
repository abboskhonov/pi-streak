-- Migration: device keypair auth system
-- Clears old API key columns, adds github_username, creates user_devices table

DELETE FROM sync_logs;
DELETE FROM model_stats;
DELETE FROM daily_stats;
DELETE FROM users;

DROP TABLE IF EXISTS sync_logs;

ALTER TABLE users ADD COLUMN github_username TEXT;

CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_pubkey TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_sync INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_pubkey ON user_devices(device_pubkey);
