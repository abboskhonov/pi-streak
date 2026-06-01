-- Fix: device keypair auth system
-- Create user_devices table (github_username already added by 0004)

CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_pubkey TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_sync INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_pubkey ON user_devices(device_pubkey);
