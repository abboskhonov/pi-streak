import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import type { DailyRow } from "./lib/types";

const configDir = join(homedir(), ".pi");
const configPath = join(configDir, "streak.json");
const apiBase = process.env.PI_STREAK_API_URL ?? "https://pi-streak.telecraft.workers.dev";
function makeHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Client-Secret": getClientSecret(),
  };
}

export type StreakConfig = {
  username: string;
  apiKey: string;
  recoveryToken?: string;
};

function getClientSecret(): string {
  return process.env.PI_STREAK_CLIENT_SECRET ?? "";
}

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

export async function register(username: string, clientSecret?: string): Promise<{ apiKey: string; recoveryToken: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientSecret) headers["X-Client-Secret"] = clientSecret;
  const res = await fetch(`${apiBase}/api/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username }),
  });
  const data = await res.json() as { apiKey?: string; recoveryToken?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Registration failed (${res.status})`);
  }
  if (!data.apiKey) throw new Error("No apiKey returned");
  return { apiKey: data.apiKey, recoveryToken: data.recoveryToken ?? "" };
}

export async function rotateKey(apiKey: string, recoveryToken?: string): Promise<{ apiKey: string; recoveryToken: string }> {
  const body: Record<string, string> = {};
  if (apiKey) body.apiKey = apiKey;
  if (recoveryToken) body.recoveryToken = recoveryToken;

  const res = await fetch(`${apiBase}/api/rotate-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json() as { apiKey?: string; recoveryToken?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Rotate key failed (${res.status})`);
  }
  if (!data.apiKey) throw new Error("No apiKey returned");
  return { apiKey: data.apiKey, recoveryToken: data.recoveryToken ?? "" };
}

export async function sync(
  username: string,
  apiKey: string,
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

  const signature = createHmac("sha256", apiKey).update(payload).digest("hex");

  const res = await fetch(`${apiBase}/api/sync`, {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify({
      apiKey,
      username,
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
  const clientSecret = process.env.PI_STREAK_CLIENT_SECRET ?? "";
  const res = await fetch(`${apiBase}/api/leaderboard?period=${period}&limit=${limit}`, {
    headers: clientSecret ? { "X-Client-Secret": clientSecret } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard (${res.status})`);
  }
  return res.json() as Promise<{
    period: string;
    count: number;
    users: { rank: number; username: string; tokens: number; streak: number; activeDays: number; today: number }[];
  }>;
}
