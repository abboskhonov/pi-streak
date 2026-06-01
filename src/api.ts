import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createUser, getUserByApiKey, getUserByUsername, upsertDailyStats, getLeaderboardAllTime, getLeaderboardDay, getLeaderboardWeek, getLeaderboardMonth, updateLastSync } from './db';

export interface CloudflareBindings {
  DB: D1Database;
}

const MAX_DAILY_TOKENS = 1_000_000_000; // 1B cap per day
const SYNC_COOLDOWN_SECONDS = 3600; // 1 hour between syncs

function requireClientHeader(c: any) {
  const secret = c.env.CLIENT_SECRET;
  const client = c.req.header('x-client-secret');
  if (!secret || client !== secret) {
    return c.json({ error: 'Invalid client' }, 403);
  }
  return null;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(cors({ origin: '*' }));

app.get('/', (c) => c.text('pi-streak api'));

app.post('/api/register', async (c) => {
  const headerCheck = requireClientHeader(c);
  if (headerCheck) return headerCheck;

  try {
    const body = await c.req.json<{ username?: string }>();
    const username = body?.username?.trim().toLowerCase();
    if (!username || username.length < 2 || username.length > 39) return c.json({ error: 'Username must be 2-39 chars' }, 400);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(username)) return c.json({ error: 'Username: lowercase alphanumeric, hyphens allowed' }, 400);

    const existing = await getUserByUsername(c.env.DB, username);
    if (existing) return c.json({ error: 'Username taken' }, 409);

    const apiKey = crypto.randomUUID();
    const user = await createUser(c.env.DB, username, apiKey);
    return c.json({ username: user.username, apiKey: user.api_key }, 201);
  } catch (err) {
    return c.json({ error: 'Database error. Is D1 configured?' }, 500);
  }
});

app.post('/api/sync', async (c) => {
  const headerCheck = requireClientHeader(c);
  if (headerCheck) return headerCheck;

  try {
    const body = await c.req.json<{ apiKey?: string; username?: string; streak?: number; activeDays?: number; days?: { date: string; tokens: number; requests: number; inputTokens?: number; outputTokens?: number; cacheTokens?: number; cost?: number }[] }>();

    const apiKey = body?.apiKey;
    if (!apiKey) return c.json({ error: 'Missing apiKey' }, 401);

    const user = await getUserByApiKey(c.env.DB, apiKey);
    if (!user) return c.json({ error: 'Invalid apiKey' }, 401);

    const now = Math.floor(Date.now() / 1000);
    if (user.last_sync && (now - user.last_sync) < SYNC_COOLDOWN_SECONDS) {
      const wait = SYNC_COOLDOWN_SECONDS - (now - user.last_sync);
      return c.json({ error: `Rate limited. Wait ${wait}s before next sync.` }, 429);
    }

    const days = body?.days ?? [];
    if (days.length === 0) return c.json({ error: 'No days provided' }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const globalStreak = Math.max(0, Math.floor(body?.streak ?? 0));
    const globalActiveDays = Math.max(0, Math.floor(body?.activeDays ?? 0));

    let synced = 0;
    for (const d of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      if (d.date > today) continue; // skip future dates
      if (d.tokens > MAX_DAILY_TOKENS) continue; // skip absurd values

      await upsertDailyStats(c.env.DB, user.id, d.date, {
        tokens: Math.max(0, Math.floor(d.tokens ?? 0)),
        inputTokens: Math.max(0, Math.floor(d.inputTokens ?? 0)),
        outputTokens: Math.max(0, Math.floor(d.outputTokens ?? 0)),
        cacheTokens: Math.max(0, Math.floor(d.cacheTokens ?? 0)),
        requests: Math.max(0, Math.floor(d.requests ?? 0)),
        cost: Math.max(0, d.cost ?? 0),
        streak: globalStreak,
        activeDays: globalActiveDays,
      });
      synced += 1;
    }

    await updateLastSync(c.env.DB, user.id);

    return c.json({ ok: true, synced, username: user.username }, 200);
  } catch (err) {
    return c.json({ error: 'Database error. Is D1 configured?' }, 500);
  }
});

app.get('/api/leaderboard', async (c) => {
  const period = c.req.query('period') ?? 'alltime';
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const today = new Date().toISOString().slice(0, 10);

  let rows: { username: string; tokens: number; streak: number; activeDays: number; todayTokens: number }[];
  if (period === 'day') rows = await getLeaderboardDay(c.env.DB, today, limit);
  else if (period === 'week') rows = await getLeaderboardWeek(c.env.DB, today, limit);
  else if (period === 'month') rows = await getLeaderboardMonth(c.env.DB, today, limit);
  else rows = await getLeaderboardAllTime(c.env.DB, today, limit);

  return c.json({ period, generatedAt: new Date().toISOString(), count: rows.length, users: rows.map((r, i) => ({ rank: i + 1, username: r.username, tokens: r.tokens, streak: r.streak, activeDays: r.activeDays, today: r.todayTokens })) });
});

export default app;
