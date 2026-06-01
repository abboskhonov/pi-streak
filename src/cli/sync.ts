import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { DailyRow } from "./lib/types";

const configDir = join(homedir(), ".pi");
const configPath = join(configDir, "streak.json");
const apiBase = process.env.PI_STREAK_API_URL ?? "https://pi-streak.telecraft.workers.dev";
function makeHeaders(config?: StreakConfig) {
  return {
    "Content-Type": "application/json",
    "X-Client-Secret": getClientSecret(config),
  };
}

export type StreakConfig = {
  username: string;
  apiKey: string;
  clientSecret?: string;
};

function getClientSecret(config?: StreakConfig): string {
  return process.env.PI_STREAK_CLIENT_SECRET ?? config?.clientSecret ?? "";
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

export async function register(username: string): Promise<{ apiKey: string; clientSecret: string }> {
  const res = await fetch(`${apiBase}/api/register`, {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify({ username }),
  });
  const data = await res.json() as { apiKey?: string; clientSecret?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Registration failed (${res.status})`);
  }
  if (!data.apiKey) throw new Error("No apiKey returned");
  return { apiKey: data.apiKey, clientSecret: data.clientSecret ?? "" };
}

export async function sync(
  username: string,
  apiKey: string,
  clientSecret: string,
  daily: DailyRow[],
  streak: number,
  activeDays: number
): Promise<void> {
  const daysWithActivity = daily.filter((d) => d.tokens > 0);
  if (daysWithActivity.length === 0) {
    console.log("  No activity found, nothing to sync.");
    return;
  }

  const res = await fetch(`${apiBase}/api/sync`, {
    method: "POST",
    headers: makeHeaders({ username, apiKey, clientSecret }),
    body: JSON.stringify({
      apiKey,
      username,
      streak,
      activeDays,
      days: daysWithActivity.map((d) => ({
        date: d.day,
        tokens: d.tokens,
        requests: d.turns,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        cacheTokens: d.cacheTokens,
        cost: d.cost,
      })),
    }),
  });

  const data = await res.json() as { ok?: boolean; synced?: number; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Sync failed (${res.status})`);
  }
  console.log(`  Synced ${data.synced ?? 0} days for @${username}`);
}

export async function fetchLeaderboard(period: string, clientSecret?: string): Promise<{
  period: string;
  count: number;
  users: { rank: number; username: string; tokens: number; streak: number; activeDays: number; today: number }[];
}> {
  const res = await fetch(`${apiBase}/api/leaderboard?period=${period}&limit=50`, {
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
