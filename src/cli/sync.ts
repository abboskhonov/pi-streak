import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { DailyRow } from "./lib/types";

const configDir = join(homedir(), ".pi");
const configPath = join(configDir, "streak.json");
const apiBase = "https://api.telecraft.workers.dev";

export type StreakConfig = {
  username: string;
  apiKey: string;
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

export async function register(username: string): Promise<string> {
  const res = await fetch(`${apiBase}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json() as { apiKey?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Registration failed (${res.status})`);
  }
  if (!data.apiKey) throw new Error("No apiKey returned");
  return data.apiKey;
}

export async function sync(
  username: string,
  apiKey: string,
  daily: DailyRow[],
  streak: number,
  activeDays: number
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const todayData = daily.find((d) => d.day === today);

  if (!todayData || todayData.tokens === 0) {
    console.log("  No activity today, nothing to sync.");
    return;
  }

  const res = await fetch(`${apiBase}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      username,
      date: today,
      tokens: todayData.tokens,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      requests: todayData.turns,
      cost: 0,
      streak,
      activeDays,
    }),
  });

  const data = await res.json() as { ok?: boolean; error?: string; synced?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Sync failed (${res.status})`);
  }
  console.log(`  Synced ${data.synced ?? today} for @${username}`);
}

export async function fetchLeaderboard(period: string): Promise<{
  period: string;
  count: number;
  users: { rank: number; username: string; tokens: number; streak: number; activeDays: number }[];
}> {
  const res = await fetch(`${apiBase}/api/leaderboard?period=${period}&limit=50`);
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard (${res.status})`);
  }
  return res.json() as Promise<{
    period: string;
    count: number;
    users: { rank: number; username: string; tokens: number; streak: number; activeDays: number }[];
  }>;
}
