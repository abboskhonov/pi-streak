import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createUser, getUserByApiKey, getUserByUsername, getUserByRecoveryToken, upsertDailyStats, getLeaderboardAllTime, getLeaderboardDay, getLeaderboardWeek, getLeaderboardMonth, updateLastSync, countSyncRequestsInLastHour, logSyncRequest } from './db';

export interface CloudflareBindings {
  DB: D1Database;
}

const MAX_DAILY_TOKENS = 1_000_000_000; // 1B cap per day
const MAX_SYNC_PER_HOUR = 1000; // 1000 syncs per hour per user
const MAX_STREAK = 3650; // 10 years
const MAX_ACTIVE_DAYS = 3650;
const MAX_DAILY_COST = 100_000; // $100k per day

async function verifySyncSignature(apiKey: string, payload: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return signature === expected;
}

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
  try {
    const body = await c.req.json<{ username?: string }>();
    const username = body?.username?.trim().toLowerCase();
    if (!username || username.length < 2 || username.length > 39) return c.json({ error: 'Username must be 2-39 chars' }, 400);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(username)) return c.json({ error: 'Username: lowercase alphanumeric, hyphens allowed' }, 400);

    const existing = await getUserByUsername(c.env.DB, username);
    if (existing) {
      return c.json({ error: 'Username taken' }, 409);
    }

    const apiKey = crypto.randomUUID();
    const recoveryToken = crypto.randomUUID();
    const user = await createUser(c.env.DB, username, apiKey, recoveryToken);
    return c.json({ username: user.username, apiKey: user.api_key, recoveryToken }, 201);
  } catch (err) {
    return c.json({ error: 'Database error. Is D1 configured?' }, 500);
  }
});

app.post('/api/rotate-key', async (c) => {
  try {
    const body = await c.req.json<{ apiKey?: string; recoveryToken?: string }>();
    const apiKey = body?.apiKey;
    const recoveryToken = body?.recoveryToken;

    if (!apiKey && !recoveryToken) {
      return c.json({ error: 'Missing apiKey or recoveryToken' }, 401);
    }

    let user = null;
    if (apiKey) {
      user = await getUserByApiKey(c.env.DB, apiKey);
    }
    if (!user && recoveryToken) {
      user = await getUserByRecoveryToken(c.env.DB, recoveryToken);
    }

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const newApiKey = crypto.randomUUID();
    const newRecoveryToken = crypto.randomUUID();
    await c.env.DB.prepare('UPDATE users SET api_key = ?, recovery_token = ? WHERE id = ?').bind(newApiKey, newRecoveryToken, user.id).run();
    return c.json({ username: user.username, apiKey: newApiKey, recoveryToken: newRecoveryToken }, 200);
  } catch (err) {
    return c.json({ error: 'Database error. Is D1 configured?' }, 500);
  }
});

app.post('/api/sync', async (c) => {
  const headerCheck = requireClientHeader(c);
  if (headerCheck) return headerCheck;

  try {
    const body = await c.req.json<{ apiKey?: string; username?: string; streak?: number; activeDays?: number; signature?: string; days?: { date: string; tokens: number; requests: number; inputTokens?: number; outputTokens?: number; cacheTokens?: number; cost?: number }[] }>();

    const apiKey = body?.apiKey;
    if (!apiKey) return c.json({ error: 'Missing apiKey' }, 401);

    const user = await getUserByApiKey(c.env.DB, apiKey);
    if (!user) return c.json({ error: 'Invalid apiKey' }, 401);

    // Verify HMAC signature of canonical payload
    const canonicalDays = (body?.days ?? []).map(d => ({
      date: d.date,
      tokens: Math.max(0, Math.floor(d.tokens ?? 0)),
      requests: Math.max(0, Math.floor(d.requests ?? 0)),
      inputTokens: Math.max(0, Math.floor(d.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.floor(d.outputTokens ?? 0)),
      cacheTokens: Math.max(0, Math.floor(d.cacheTokens ?? 0)),
      cost: Math.max(0, d.cost ?? 0),
    })).sort((a, b) => a.date.localeCompare(b.date));
    const payload = JSON.stringify({ days: canonicalDays, streak: Math.max(0, Math.floor(body?.streak ?? 0)), activeDays: Math.max(0, Math.floor(body?.activeDays ?? 0)) });

    if (!body.signature || !await verifySyncSignature(apiKey, payload, body.signature)) {
      return c.json({ error: 'Invalid signature' }, 403);
    }

    const requestCount = await countSyncRequestsInLastHour(c.env.DB, user.id);
    if (requestCount >= MAX_SYNC_PER_HOUR) {
      return c.json({ error: `Rate limited. ${MAX_SYNC_PER_HOUR} syncs per hour exceeded.` }, 429);
    }

    const days = body?.days ?? [];
    if (days.length === 0) return c.json({ error: 'No days provided' }, 400);
    if (days.length > 366) return c.json({ error: 'Too many days. Max 366 per sync.' }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const userCreatedAt = new Date(user.created_at * 1000).toISOString().slice(0, 10);
    const globalStreak = Math.max(0, Math.floor(body?.streak ?? 0));
    const globalActiveDays = Math.max(0, Math.floor(body?.activeDays ?? 0));

    if (globalStreak > MAX_STREAK) return c.json({ error: 'Streak exceeds maximum allowed' }, 400);
    if (globalActiveDays > MAX_ACTIVE_DAYS) return c.json({ error: 'ActiveDays exceeds maximum allowed' }, 400);

    let synced = 0;
    for (const d of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      if (d.date > today) continue; // skip future dates
      if (d.date < userCreatedAt) continue; // skip dates before account creation
      if (d.tokens > MAX_DAILY_TOKENS) continue; // skip absurd values

      const tokens = Math.max(0, Math.floor(d.tokens ?? 0));
      const inputTokens = Math.max(0, Math.floor(d.inputTokens ?? 0));
      const outputTokens = Math.max(0, Math.floor(d.outputTokens ?? 0));
      const cacheTokens = Math.max(0, Math.floor(d.cacheTokens ?? 0));
      const requests = Math.max(0, Math.floor(d.requests ?? 0));
      const cost = Math.max(0, d.cost ?? 0);

      // Consistency check: tokens should roughly equal input + output + cache
      const total = inputTokens + outputTokens + cacheTokens;
      if (total > 0 && (tokens < total * 0.9 || tokens > total * 1.1)) continue;
      if (cost > MAX_DAILY_COST) continue;

      await upsertDailyStats(c.env.DB, user.id, d.date, {
        tokens,
        inputTokens,
        outputTokens,
        cacheTokens,
        requests,
        cost,
        streak: globalStreak,
        activeDays: globalActiveDays,
      });
      synced += 1;
    }

    await logSyncRequest(c.env.DB, user.id);
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
