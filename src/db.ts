import type { D1Database } from '@cloudflare/workers-types';

export type User = {
  id: number;
  username: string;
  github_username: string | null;
  created_at: number;
};

export type LeaderboardRow = {
  username: string;
  tokens: number;
  streak: number;
  activeDays: number;
  todayTokens: number;
};

export async function createUser(db: D1Database, username: string, githubUsername: string | null): Promise<User> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare('INSERT INTO users (username, github_username, created_at) VALUES (?, ?, ?) RETURNING *')
    .bind(username, githubUsername, now)
    .first<User>();
  if (!result) throw new Error('Failed to create user');
  return result;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
}

export async function getUserByGithubUsername(db: D1Database, githubUsername: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE github_username = ?').bind(githubUsername).first<User>();
}

export async function getUserByDevicePubkey(db: D1Database, devicePubkey: string): Promise<User | null> {
  const result = await db
    .prepare('SELECT u.* FROM users u JOIN user_devices d ON u.id = d.user_id WHERE d.device_pubkey = ?')
    .bind(devicePubkey)
    .first<User>();
  return result ?? null;
}

export async function addDevice(db: D1Database, userId: number, devicePubkey: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('INSERT INTO user_devices (user_id, device_pubkey, created_at, last_sync) VALUES (?, ?, ?, ?)')
    .bind(userId, devicePubkey, now, 0)
    .run();
}

export async function updateDeviceLastSync(db: D1Database, userId: number, devicePubkey: string): Promise<void> {
  await db
    .prepare('UPDATE user_devices SET last_sync = ? WHERE user_id = ? AND device_pubkey = ?')
    .bind(Math.floor(Date.now() / 1000), userId, devicePubkey)
    .run();
}

export async function countSyncRequestsInLastHour(db: D1Database, userId: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 3600;
  try {
    const result = await db
      .prepare('SELECT COUNT(*) as count FROM sync_logs WHERE user_id = ? AND timestamp > ?')
      .bind(userId, oneHourAgo)
      .first<{ count: number }>();
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function logSyncRequest(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare('INSERT INTO sync_logs (user_id, timestamp) VALUES (?, ?)')
    .bind(userId, Math.floor(Date.now() / 1000))
    .run();
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
