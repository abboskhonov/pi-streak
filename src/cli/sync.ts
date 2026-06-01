import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import type { DailyRow } from "./lib/types";

const configDir = join(homedir(), ".pi");
const configPath = join(configDir, "streak.json");
const keyPath = join(configDir, "streak.pem");
const apiBase = process.env.PI_STREAK_API_URL ?? "https://pi-streak.telecraft.workers.dev";

function makeHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export type StreakConfig = {
  username: string;
  devicePubkey: string;
  githubToken?: string;
};

export function loadConfig(): StreakConfig | null {
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as StreakConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: StreakConfig): void {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getGitUsername(): string | null {
  const result = spawnSync("git", ["config", "github.user"], { encoding: "utf-8" });
  if (result.stdout?.trim()) return result.stdout.trim().toLowerCase();
  const result2 = spawnSync("git", ["config", "user.name"], { encoding: "utf-8" });
  if (result2.stdout?.trim()) return result2.stdout.trim().toLowerCase().replace(/\s+/g, "-");
  return null;
}

// Generate Ed25519 keypair using node:crypto
function generateKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return {
    publicKey: publicKey,
    privateKey: privateKey,
  };
}

export function getOrCreateKeypair(): { publicKey: string; privateKey: string } {
  if (existsSync(keyPath)) {
    const pem = readFileSync(keyPath, "utf-8");
    const pubMatch = pem.match(/PUBLIC:\n([\s\S]*?)\nPRIVATE:/);
    const privMatch = pem.match(/PRIVATE:\n([\s\S]*?)$/);
    if (pubMatch && privMatch) {
      return { publicKey: pubMatch[1].trim(), privateKey: privMatch[1].trim() };
    }
  }
  const keys = generateKeypair();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(keyPath, `PUBLIC:\n${keys.publicKey}\nPRIVATE:\n${keys.privateKey}\n`, { mode: 0o600 });
  return keys;
}

function signPayload(privateKeyPem: string, payload: string): string {
  const sig = sign(null, Buffer.from(payload, "utf-8"), privateKeyPem);
  return sig.toString("base64");
}

export async function register(username: string, devicePubkey: string, githubToken?: string): Promise<void> {
  const body: Record<string, string> = { username, devicePubkey: devicePubkey.trim() };
  if (githubToken) body.githubToken = githubToken;
  const res = await fetch(`${apiBase}/api/register`, {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json() as { error?: string; needsAuthorization?: boolean };
  if (!res.ok) {
    throw new Error(data.error ?? `Registration failed (${res.status})`);
  }
}

export async function authorizeDevice(devicePubkey: string, githubToken: string): Promise<void> {
  const res = await fetch(`${apiBase}/api/authorize-device`, {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify({ devicePubkey: devicePubkey.trim(), githubToken }),
  });
  const data = await res.json() as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Authorization failed (${res.status})`);
  }
}

export async function sync(
  username: string,
  devicePubkey: string,
  privateKey: string,
  daily: DailyRow[],
  streak: number,
  activeDays: number
): Promise<void> {
  const daysWithActivity = daily.filter((d) => d.tokens > 0);
  if (daysWithActivity.length === 0) {
    console.log("  No activity found, nothing to sync.");
    return;
  }

  const daysPayload = daysWithActivity.map((d) => ({
    date: d.day,
    tokens: d.tokens,
    requests: d.turns,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    cacheTokens: d.cacheTokens,
    cost: d.cost,
  }));

  const canonicalDays = daysPayload
    .map((d) => ({
      date: d.date,
      tokens: Math.max(0, Math.floor(d.tokens ?? 0)),
      requests: Math.max(0, Math.floor(d.requests ?? 0)),
      inputTokens: Math.max(0, Math.floor(d.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.floor(d.outputTokens ?? 0)),
      cacheTokens: Math.max(0, Math.floor(d.cacheTokens ?? 0)),
      cost: Math.max(0, d.cost ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const payload = JSON.stringify({
    days: canonicalDays,
    streak: Math.max(0, Math.floor(streak)),
    activeDays: Math.max(0, Math.floor(activeDays)),
  });

  const signature = signPayload(privateKey, payload);

  const res = await fetch(`${apiBase}/api/sync`, {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify({
      username,
      devicePubkey,
      streak,
      activeDays,
      days: daysPayload,
      signature,
    }),
  });

  const data = await res.json() as { ok?: boolean; synced?: number; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Sync failed (${res.status})`);
  }
  console.log(`  Synced ${data.synced ?? 0} days for @${username}`);
}

export async function fetchLeaderboard(period: string, limit = 50): Promise<{
  period: string;
  count: number;
  users: { rank: number; username: string; tokens: number; streak: number; activeDays: number; today: number }[];
}> {
  const res = await fetch(`${apiBase}/api/leaderboard?period=${period}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard (${res.status})`);
  }
  return res.json() as Promise<{
    period: string;
    count: number;
    users: { rank: number; username: string; tokens: number; streak: number; activeDays: number; today: number }[];
  }>;
}

// GitHub token flow
export async function getGithubToken(): Promise<string | null> {
  // Path 1: gh CLI
  const ghResult = spawnSync("gh", ["auth", "token"], { encoding: "utf-8" });
  if (ghResult.stdout?.trim()) return ghResult.stdout.trim();
  if ((ghResult.error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
    // gh not installed
    return null;
  }
  if (ghResult.status !== 0) {
    // gh installed but not authenticated
    return null;
  }
  return null;
}

export async function openBrowserOAuth(): Promise<string | null> {
  // Browser OAuth flow - simplified to manual paste
  return null;
}

export async function promptForGithubToken(): Promise<string> {
  console.log("  GitHub token needed to authorize this device.");
  console.log("  Get one at: https://github.com/settings/tokens/new");
  console.log("  (needed scope: read:user)");
  // Use readline or prompt for input
  const result = spawnSync("read", ["-p", "  Paste token: "], { encoding: "utf-8", shell: true });
  return result.stdout?.trim() ?? "";
}
