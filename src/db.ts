import type { D1Database } from '@cloudflare/workers-types';

export type User = {
  id: number;
  username: string;
  api_key: string;
  created_at: number;
};

export type LeaderboardRow = {
  username: string;
  tokens: number;
  streak: number;
  activeDays: number;
  todayTokens: number;
};

export async function createUser(db: D1Database, username: string, apiKey: string): Promise<User> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare('INSERT INTO users (username, api_key, created_at) VALUES (?, ?, ?) RETURNING *')
    .bind(username, apiKey, now)
    .first<User>();
  if (!result) throw new Error('Failed to create user');
  return result;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
}

export async function getUserByApiKey(db: D1Database, apiKey: string): Promise<{ id: number; username: string; api_key: string; created_at: number; last_sync: number } | null> {
  return await db.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first<{ id: number; username: string; api_key: string; created_at: number; last_sync: number }>();
}

export async function updateLastSync(db: D1Database, userId: number): Promise<void> {
  await db.prepare('UPDATE users SET last_sync = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), userId).run();
}

export async function upsertDailyStats(
  db: D1Database,
  userId: number,
  date: string,
  stats: {
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    requests: number;
    cost: number;
    streak: number;
    activeDays: number;
  }
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO daily_stats (user_id, date, tokens, input_tokens, output_tokens, cache_tokens, requests, cost, streak, active_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        tokens = excluded.tokens,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_tokens = excluded.cache_tokens,
        requests = excluded.requests,
        cost = excluded.cost,
        streak = excluded.streak,
        active_days = excluded.active_days
    `)
    .bind(userId, date, stats.tokens, stats.inputTokens, stats.outputTokens, stats.cacheTokens, stats.requests, stats.cost, stats.streak, stats.activeDays)
    .run();
}

export async function upsertModelStats(db: D1Database, userId: number, date: string, model: string, tokens: number, cost: number): Promise<void> {
  await db
    .prepare('INSERT INTO model_stats (user_id, date, model, tokens, cost) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, date, model) DO UPDATE SET tokens = excluded.tokens, cost = excluded.cost')
    .bind(userId, date, model, tokens, cost)
    .run();
}

export async function getLeaderboardAllTime(db: D1Database, date: string, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare(`SELECT u.username, SUM(d.tokens) as tokens, MAX(d.streak) as streak, MAX(d.active_days) as activeDays, COALESCE(today.tokens, 0) as todayTokens FROM users u JOIN daily_stats d ON u.id = d.user_id LEFT JOIN daily_stats today ON today.user_id = u.id AND today.date = ? GROUP BY u.id ORDER BY tokens DESC LIMIT ?`)
      .bind(date, limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getLeaderboardDay(db: D1Database, date: string, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare('SELECT u.username, d.tokens, d.streak, d.active_days as activeDays, d.tokens as todayTokens FROM users u JOIN daily_stats d ON u.id = d.user_id WHERE d.date = ? ORDER BY d.tokens DESC LIMIT ?')
      .bind(date, limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getLeaderboardWeek(db: D1Database, date: string, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare(`SELECT u.username, SUM(d.tokens) as tokens, MAX(d.streak) as streak, MAX(d.active_days) as activeDays, COALESCE(today.tokens, 0) as todayTokens FROM users u JOIN daily_stats d ON u.id = d.user_id LEFT JOIN daily_stats today ON today.user_id = u.id AND today.date = ? WHERE d.date BETWEEN date(?, "-6 days") AND ? GROUP BY u.id ORDER BY tokens DESC LIMIT ?`)
      .bind(date, date, date, limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getLeaderboardMonth(db: D1Database, date: string, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare(`SELECT u.username, SUM(d.tokens) as tokens, MAX(d.streak) as streak, MAX(d.active_days) as activeDays, COALESCE(today.tokens, 0) as todayTokens FROM users u JOIN daily_stats d ON u.id = d.user_id LEFT JOIN daily_stats today ON today.user_id = u.id AND today.date = ? WHERE d.date BETWEEN date(?, "-29 days") AND ? GROUP BY u.id ORDER BY tokens DESC LIMIT ?`)
      .bind(date, date, date, limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}
