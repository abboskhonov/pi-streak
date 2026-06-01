-- Migration: add recovery_token to users for secure key rotation
ALTER TABLE users ADD COLUMN recovery_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_token ON users(recovery_token);
