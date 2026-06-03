import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createUser, getUserByUsername, getUserByDevicePubkey, getUserByGithubUsername, addDevice, upsertUserStats, upsertDailyStats, getLeaderboardAllTime, getLeaderboardDay, getLeaderboardWeek, getLeaderboardMonth, updateDeviceLastSync, countSyncRequestsInLastHour, logSyncRequest, getUserProfile } from './db';

export interface CloudflareBindings {
  DB: D1Database;
  CLIENT_SECRET: string;
}

const MAX_DAILY_TOKENS = 1_000_000_000;
const MAX_SYNC_PER_HOUR = 1000;
const MAX_STREAK = 3650;
const MAX_ACTIVE_DAYS = 3650;
const MAX_DAILY_COST = 100_000;

function pemToDer(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s/g, '');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function verifySyncSignature(devicePubkeyPem: string, payload: string, signature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const pubKeyBytes = pemToDer(devicePubkeyPem);
    const pubKey = await crypto.subtle.importKey(
      'spki',
      pubKeyBytes as unknown as ArrayBuffer,
      { name: 'Ed25519' } as AlgorithmIdentifier,
      false,
      ['verify']
    );
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('Ed25519', pubKey, sigBytes as unknown as ArrayBuffer, encoder.encode(payload));
    return valid;
  } catch {
    return false;
  }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(cors({ origin: '*' }));

app.get('/', (c) => c.text('pi-streak api'));

app.post('/api/register', async (c) => {
  try {
    const body = await c.req.json<{ username?: string; devicePubkey?: string; githubToken?: string }>();
    const username = body?.username?.trim().toLowerCase();
    const devicePubkey = body?.devicePubkey?.trim();
    const githubToken = body?.githubToken?.trim();

    if (!username || username.length < 2 || username.length > 39) return c.json({ error: 'Username must be 2-39 chars' }, 400);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(username)) return c.json({ error: 'Username: lowercase alphanumeric, hyphens allowed' }, 400);
    if (!devicePubkey || devicePubkey.length < 20) return c.json({ error: 'Missing devicePubkey' }, 400);

    const existing = await getUserByUsername(c.env.DB, username);
    if (existing) {
      return c.json({ error: 'Username taken', needsAuthorization: true }, 409);
    }

    let githubUsername: string | null = null;
    if (githubToken) {
      const ghRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${githubToken}`, 'User-Agent': 'pi-streak' }
      });
      if (ghRes.ok) {
        const ghUser = await ghRes.json() as { login: string };
        githubUsername = ghUser.login.toLowerCase();
      }
    }

    const user = await createUser(c.env.DB, username, githubUsername);
    await addDevice(c.env.DB, user.id, devicePubkey);
    return c.json({ username: user.username, githubUsername: user.github_username }, 201);
  } catch (err) {
    console.error('register failed', err);
    return c.json({ error: 'Registration failed' }, 500);
  }
});

app.post('/api/authorize-device', async (c) => {
  try {
    const body = await c.req.json<{ devicePubkey?: string; githubToken?: string }>();
    const devicePubkey = body?.devicePubkey?.trim();
    const githubToken = body?.githubToken?.trim();

    if (!devicePubkey || !githubToken) return c.json({ error: 'Missing devicePubkey or githubToken' }, 400);

    // Verify GitHub token
    const ghRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${githubToken}`, 'User-Agent': 'pi-streak' }
    });
    if (!ghRes.ok) return c.json({ error: 'Invalid GitHub token' }, 401);
    const ghUser = await ghRes.json() as { login: string };
    const githubUsername = ghUser.login.toLowerCase();

    // Find user by github username
    const user = await getUserByGithubUsername(c.env.DB, githubUsername);
    if (!user) return c.json({ error: 'No account linked to this GitHub username' }, 404);

    // Check if device already exists
    const existingDevice = await getUserByDevicePubkey(c.env.DB, devicePubkey);
    if (existingDevice) return c.json({ error: 'Device already registered' }, 409);

    await addDevice(c.env.DB, user.id, devicePubkey);
    return c.json({ username: user.username, githubUsername: user.github_username }, 200);
  } catch (err) {
    console.error('authorize-device failed', err);
    return c.json({ error: 'Device authorization failed' }, 500);
  }
});

app.post('/api/sync', async (c) => {
  try {
    const body = await c.req.json<{
      username?: string;
      devicePubkey?: string;
      signature?: string;
      streak?: number;
      activeDays?: number;
      stats?: {
        lifetimeTokens: number;
        inputTokens: number;
        outputTokens: number;
        cacheTokens: number;
        cost: number;
        todayTokens: number;
        todayDate: string;
        weekTokens: number;
        monthTokens: number;
      };
      days?: { date: string; tokens: number; requests: number; inputTokens?: number; outputTokens?: number; cacheTokens?: number; cost?: number }[];
    }>();

    const devicePubkey = body?.devicePubkey;
    const username = body?.username;
    if (!devicePubkey || !username) return c.json({ error: 'Missing devicePubkey or username' }, 400);

    const user = await getUserByDevicePubkey(c.env.DB, devicePubkey);
    if (!user || user.username !== username) return c.json({ error: 'Invalid device' }, 401);

    // Verify Ed25519 signature over canonical payload
    const days = (body?.days ?? []).map(d => ({
      date: d.date,
      tokens: Math.max(0, Math.floor(d.tokens ?? 0)),
      requests: Math.max(0, Math.floor(d.requests ?? 0)),
      inputTokens: Math.max(0, Math.floor(d.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.floor(d.outputTokens ?? 0)),
      cacheTokens: Math.max(0, Math.floor(d.cacheTokens ?? 0)),
      cost: Math.max(0, d.cost ?? 0),
    })).sort((a, b) => a.date.localeCompare(b.date));

    const streak = Math.max(0, Math.floor(body?.streak ?? 0));
    const activeDays = Math.max(0, Math.floor(body?.activeDays ?? 0));
    const stats = body?.stats;

    const payload = JSON.stringify({ days, streak, activeDays, stats });

    if (!body.signature || !await verifySyncSignature(devicePubkey, payload, body.signature)) {
      return c.json({ error: 'Invalid signature' }, 403);
    }

    const requestCount = await countSyncRequestsInLastHour(c.env.DB, user.id);
    if (requestCount >= MAX_SYNC_PER_HOUR) {
      return c.json({ error: `Rate limited. ${MAX_SYNC_PER_HOUR} syncs per hour exceeded.` }, 429);
    }

    // Validate totals
    if (!stats) return c.json({ error: 'Missing stats' }, 400);

    const lifetimeTokens = Math.max(0, Math.floor(stats.lifetimeTokens ?? 0));
    if (lifetimeTokens > MAX_DAILY_TOKENS * 366) return c.json({ error: 'Token total exceeds maximum' }, 400);
    if (streak > MAX_STREAK) return c.json({ error: 'Streak exceeds maximum allowed' }, 400);
    if (activeDays > MAX_ACTIVE_DAYS) return c.json({ error: 'ActiveDays exceeds maximum allowed' }, 400);

    const today = new Date().toISOString().slice(0, 10);

    await upsertUserStats(c.env.DB, user.id, {
      lifetimeTokens,
      inputTokens: Math.max(0, Math.floor(stats.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.floor(stats.outputTokens ?? 0)),
      cacheTokens: Math.max(0, Math.floor(stats.cacheTokens ?? 0)),
      cost: Math.max(0, stats.cost ?? 0),
      streak,
      activeDays,
      todayTokens: Math.max(0, Math.floor(stats.todayTokens ?? 0)),
      todayDate: stats.todayDate || today,
      weekTokens: Math.max(0, Math.floor(stats.weekTokens ?? 0)),
      monthTokens: Math.max(0, Math.floor(stats.monthTokens ?? 0)),
    });

    await upsertDailyStats(c.env.DB, user.id, days);

    await logSyncRequest(c.env.DB, user.id);
    await updateDeviceLastSync(c.env.DB, user.id, devicePubkey);

    return c.json({ ok: true, username: user.username }, 200);
  } catch (err) {
    console.error('sync failed', err);
    return c.json({ error: 'Sync failed' }, 500);
  }
});

app.get('/api/leaderboard', async (c) => {
  const period = c.req.query('period') ?? 'alltime';
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));

  let rows: { username: string; tokens: number; streak: number; activeDays: number; todayTokens: number }[];
  if (period === 'day') rows = await getLeaderboardDay(c.env.DB, limit);
  else if (period === 'week') rows = await getLeaderboardWeek(c.env.DB, limit);
  else if (period === 'month') rows = await getLeaderboardMonth(c.env.DB, limit);
  else rows = await getLeaderboardAllTime(c.env.DB, limit);

  return c.json({ period, generatedAt: new Date().toISOString(), count: rows.length, users: rows.map((r, i) => ({ rank: i + 1, username: r.username, tokens: r.tokens, streak: r.streak, activeDays: r.activeDays, today: r.todayTokens })) });
});

app.get('/api/user/:username', async (c) => {
  try {
    const username = c.req.param('username').trim().toLowerCase();
    const profile = await getUserProfile(c.env.DB, username);
    if (!profile) {
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(profile, 200);
  } catch (err) {
    console.error('user profile failed', err);
    return c.json({ error: 'Failed to fetch user profile' }, 500);
  }
});

export default app;