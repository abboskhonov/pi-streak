-- Migration: add last_sync to users for rate limiting
ALTER TABLE users ADD COLUMN last_sync INTEGER DEFAULT 0;
