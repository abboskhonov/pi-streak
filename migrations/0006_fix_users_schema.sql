-- Fix: recreate users table without api_key and recovery_token
-- Data is already deleted from migration 0004

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  github_username TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO users_new (id, username, github_username, created_at)
SELECT id, username, github_username, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
