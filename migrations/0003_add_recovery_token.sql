-- Migration: add recovery_token to users for secure key rotation
ALTER TABLE users ADD COLUMN recovery_token TEXT UNIQUE;
