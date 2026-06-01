-- Migration: replace per-day rows with single user_stats row
CREATE TABLE IF NOT EXISTS user_stats (
  user_id INTEGER PRIMARY KEY,
  lifetime_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  today_tokens INTEGER NOT NULL DEFAULT 0,
  today_date TEXT NOT NULL DEFAULT '',
  week_tokens INTEGER NOT NULL DEFAULT 0,
  month_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Populate from existing daily_stats
INSERT OR IGNORE INTO user_stats (user_id, lifetime_tokens, input_tokens, output_tokens, cache_tokens, cost, streak, active_days, today_tokens, today_date, week_tokens, month_tokens, updated_at)
SELECT
  d.user_id,
  SUM(d.tokens),
  SUM(d.input_tokens),
  SUM(d.output_tokens),
  SUM(d.cache_tokens),
  SUM(d.cost),
  MAX(d.streak),
  MAX(d.active_days),
  COALESCE((SELECT SUM(d2.tokens) FROM daily_stats d2 WHERE d2.user_id = d.user_id AND d2.date = strftime('%Y-%m-%d', 'now')), 0),
  strftime('%Y-%m-%d', 'now'),
  COALESCE((SELECT SUM(d3.tokens) FROM daily_stats d3 WHERE d3.user_id = d.user_id AND d3.date BETWEEN date('now', '-6 days') AND date('now')), 0),
  COALESCE((SELECT SUM(d4.tokens) FROM daily_stats d4 WHERE d4.user_id = d.user_id AND d4.date BETWEEN date('now', '-29 days') AND date('now')), 0),
  unixepoch()
FROM daily_stats d
GROUP BY d.user_id;