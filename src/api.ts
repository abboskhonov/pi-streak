import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createUser, getUserByApiKey, getUserByUsername, upsertDailyStats, upsertModelStats, getLeaderboardAllTime, getLeaderboardDay, getLeaderboardWeek, getLeaderboardMonth } from './db';

export interface CloudflareBindings {
  DB: D1Database;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(cors({ origin: '*' }));

app.get('/', (c) => c.text('pi-streak api'));

app.post('/api/register', async (c) => {
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
  try {
    const body = await c.req.json<{ apiKey?: string; username?: string; date?: string; tokens?: number; inputTokens?: number; outputTokens?: number; cacheTokens?: number; requests?: number; cost?: number; streak?: number; activeDays?: number; models?: { model: string; tokens: number; cost: number }[] }>();

    const apiKey = body?.apiKey;
    if (!apiKey) return c.json({ error: 'Missing apiKey' }, 401);

    const user = await getUserByApiKey(c.env.DB, apiKey);
    if (!user) return c.json({ error: 'Invalid apiKey' }, 401);

    const date = body?.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Invalid date format (YYYY-MM-DD)' }, 400);

    await upsertDailyStats(c.env.DB, user.id, date, {
      tokens: Math.max(0, Math.floor(body?.tokens ?? 0)),
      inputTokens: Math.max(0, Math.floor(body?.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.floor(body?.outputTokens ?? 0)),
      cacheTokens: Math.max(0, Math.floor(body?.cacheTokens ?? 0)),
      requests: Math.max(0, Math.floor(body?.requests ?? 0)),
      cost: Math.max(0, body?.cost ?? 0),
      streak: Math.max(0, Math.floor(body?.streak ?? 0)),
      activeDays: Math.max(0, Math.floor(body?.activeDays ?? 0)),
    });

    for (const m of (body?.models ?? [])) {
      await upsertModelStats(c.env.DB, user.id, date, m.model, Math.max(0, Math.floor(m.tokens ?? 0)), Math.max(0, m.cost ?? 0));
    }

    return c.json({ ok: true, synced: date, username: user.username }, 200);
  } catch (err) {
    return c.json({ error: 'Database error. Is D1 configured?' }, 500);
  }
});

app.get('/api/leaderboard', async (c) => {
  const period = c.req.query('period') ?? 'alltime';
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const today = new Date().toISOString().slice(0, 10);

  let rows: { username: string; tokens: number; streak: number; activeDays: number }[];
  if (period === 'day') rows = await getLeaderboardDay(c.env.DB, today, limit);
  else if (period === 'week') rows = await getLeaderboardWeek(c.env.DB, today, limit);
  else if (period === 'month') rows = await getLeaderboardMonth(c.env.DB, today, limit);
  else rows = await getLeaderboardAllTime(c.env.DB, limit);

  return c.json({ period, generatedAt: new Date().toISOString(), count: rows.length, users: rows.map((r, i) => ({ rank: i + 1, username: r.username, tokens: r.tokens, streak: r.streak, activeDays: r.activeDays })) });
});

export default app;
