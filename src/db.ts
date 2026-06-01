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

export async function getUserByGithubUsername(db: D1Database, githubUsername: string | null): Promise<User | null> {
  if (!githubUsername) return null;
  return await db.prepare('SELECT * FROM users WHERE github_username = ?').bind(githubUsername).first<User>();
}

export async function getUserByDevicePubkey(db: D1Database, devicePubkey: string): Promise<User | null> {
  const normalized = devicePubkey.replace(/\s/g, '');
  const result = await db
    .prepare('SELECT u.* FROM users u JOIN user_devices d ON u.id = d.user_id WHERE d.device_pubkey = ?')
    .bind(normalized)
    .first<User>();
  return result ?? null;
}

export async function addDevice(db: D1Database, userId: number, devicePubkey: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const normalized = devicePubkey.replace(/\s/g, '');
  await db
    .prepare('INSERT INTO user_devices (user_id, device_pubkey, created_at, last_sync) VALUES (?, ?, ?, ?)')
    .bind(userId, normalized, now, 0)
    .run();
}

export async function updateDeviceLastSync(db: D1Database, userId: number, devicePubkey: string): Promise<void> {
  const normalized = devicePubkey.replace(/\s/g, '');
  await db
    .prepare('UPDATE user_devices SET last_sync = ? WHERE user_id = ? AND device_pubkey = ?')
    .bind(Math.floor(Date.now() / 1000), userId, normalized)
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

export async function upsertUserStats(db: D1Database, userId: number, stats: {
  lifetimeTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  streak: number;
  activeDays: number;
  todayTokens: number;
  todayDate: string;
  weekTokens: number;
  monthTokens: number;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`INSERT INTO user_stats (user_id, lifetime_tokens, input_tokens, output_tokens, cache_tokens, cost, streak, active_days, today_tokens, today_date, week_tokens, month_tokens, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        lifetime_tokens = excluded.lifetime_tokens,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_tokens = excluded.cache_tokens,
        cost = excluded.cost,
        streak = excluded.streak,
        active_days = excluded.active_days,
        today_tokens = excluded.today_tokens,
        today_date = excluded.today_date,
        week_tokens = excluded.week_tokens,
        month_tokens = excluded.month_tokens,
        updated_at = excluded.updated_at`)
    .bind(userId, stats.lifetimeTokens, stats.inputTokens, stats.outputTokens, stats.cacheTokens, stats.cost, stats.streak, stats.activeDays, stats.todayTokens, stats.todayDate, stats.weekTokens, stats.monthTokens, now)
    .run();
}

export async function getLeaderboardAllTime(db: D1Database, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare('SELECT u.username, s.lifetime_tokens as tokens, s.streak, s.active_days as activeDays, s.today_tokens as todayTokens FROM users u JOIN user_stats s ON u.id = s.user_id ORDER BY s.lifetime_tokens DESC LIMIT ?')
      .bind(limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getLeaderboardDay(db: D1Database, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare('SELECT u.username, s.today_tokens as tokens, s.streak, s.active_days as activeDays, s.today_tokens as todayTokens FROM users u JOIN user_stats s ON u.id = s.user_id WHERE s.today_tokens > 0 ORDER BY s.today_tokens DESC LIMIT ?')
      .bind(limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getLeaderboardWeek(db: D1Database, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare('SELECT u.username, s.week_tokens as tokens, s.streak, s.active_days as activeDays, s.today_tokens as todayTokens FROM users u JOIN user_stats s ON u.id = s.user_id WHERE s.week_tokens > 0 ORDER BY s.week_tokens DESC LIMIT ?')
      .bind(limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getLeaderboardMonth(db: D1Database, limit: number = 50): Promise<LeaderboardRow[]> {
  try {
    const result = await db
      .prepare('SELECT u.username, s.month_tokens as tokens, s.streak, s.active_days as activeDays, s.today_tokens as todayTokens FROM users u JOIN user_stats s ON u.id = s.user_id WHERE s.month_tokens > 0 ORDER BY s.month_tokens DESC LIMIT ?')
      .bind(limit)
      .all<LeaderboardRow>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

export type UserProfile = {
  username: string;
  githubUsername: string | null;
  createdAt: number;
  lifetimeTokens: number;
  streak: number;
  activeDays: number;
  todayTokens: number;
  rank: number;
};

export async function getUserProfile(db: D1Database, username: string): Promise<UserProfile | null> {
  const user = await getUserByUsername(db, username);
  if (!user) return null;

  const stats = await db
    .prepare('SELECT * FROM user_stats WHERE user_id = ?')
    .bind(user.id)
    .first<{ lifetime_tokens: number; streak: number; active_days: number; today_tokens: number }>();

  const lifetimeTokens = stats?.lifetime_tokens ?? 0;
  const streak = stats?.streak ?? 0;
  const activeDays = stats?.active_days ?? 0;
  const todayTokens = stats?.today_tokens ?? 0;

  const rankResult = await db
    .prepare('SELECT COUNT(*) as count FROM user_stats WHERE lifetime_tokens > ?')
    .bind(lifetimeTokens)
    .first<{ count: number }>();
  const rank = (rankResult?.count ?? 0) + 1;

  return {
    username: user.username,
    githubUsername: user.github_username,
    createdAt: user.created_at,
    lifetimeTokens,
    streak,
    activeDays,
    todayTokens,
    rank,
  };
}