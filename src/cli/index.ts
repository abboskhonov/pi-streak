#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { parseArgs, usage } from "./args";
import { loadData, loadTodayData, computeStreaks } from "./parser";
import type { DailyRow } from "./lib/types";
import { renderCost, renderDashboard, renderLeaderboard, renderModels, renderMonth, renderPeak, renderProjects, renderToday, renderUserDashboard } from "./render";
import { color, formatPath, formatTokens } from "./util";

async function main(): Promise<void> {
  let options;
  try {
    options = parseArgs(Bun.argv.slice(2));
  } catch (error) {
    console.error(`pi-streak: ${(error as Error).message}\n\n${usage()}`);
    process.exit(1);
  }

  if (!existsSync(options.dirPath)) {
    console.error(`pi-streak: directory not found: ${options.dirPath}`);
    process.exit(1);
  }

  if (options.command === "sync") {
    const { loadConfig, getGitUsername, saveConfig, getOrCreateKeypair, register, authorizeDevice, sync: syncFn, getGithubToken } = await import("./sync");
    const config = loadConfig();
    const { summary, daily } = loadData(options.dirPath);
    const streaks = computeStreaks(new Set(daily.filter((day) => day.turns > 0).map((day) => day.day)));
    const activeDays = daily.filter((day) => day.turns > 0).length;

    const username = getGitUsername() ?? "";
    if (!username) {
      console.error("pi-streak: could not determine username. Set git config github.user or user.name");
      process.exit(1);
    }

    const { publicKey: devicePubkeyRaw, privateKey } = getOrCreateKeypair();
    const devicePubkey = devicePubkeyRaw.trim();

    async function trySync() {
      await syncFn(username, devicePubkey, privateKey, daily, summary, streaks.current, activeDays);
    }

    async function doRegister() {
      let githubToken = (await getGithubToken()) ?? undefined;
      if (!githubToken) {
        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const prompt = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
        console.log("  GitHub token recommended for multi-device support.");
        console.log("  Get one at: https://github.com/settings/tokens/new (scope: read:user)");
        console.log("  Press Enter to skip (no multi-device support):");
        const token = await prompt("  GitHub token (optional): ");
        rl.close();
        if (token.trim()) githubToken = token.trim();
      }
      try {
        await register(username, devicePubkey, githubToken);
        saveConfig({ username, devicePubkey, githubToken });
        console.log(`  Registered @${username}. Device key saved to ~/.pi/streak.json`);
        await trySync();
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("Username taken") || msg.includes("needsAuthorization")) {
          await doAuthorize();
        } else {
          console.error(`pi-streak: ${msg}`);
          process.exit(1);
        }
      }
    }

    async function doAuthorize() {
      console.log("  Username taken. Authorizing device...");
      let githubToken = config?.githubToken ?? undefined;
      if (!githubToken) {
        githubToken = (await getGithubToken()) ?? undefined;
      }
      if (!githubToken) {
        // Ask for manual token
        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const prompt = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
        console.log("  GitHub token needed to authorize this device.");
        console.log("  Get one at: https://github.com/settings/tokens/new");
        console.log("  (needed scope: read:user)");
        githubToken = await prompt("  Paste token: ");
        rl.close();
      }
      if (!githubToken) {
        console.error("pi-streak: GitHub token required to authorize device.");
        process.exit(1);
      }
      try {
        await authorizeDevice(devicePubkey, githubToken);
        saveConfig({ username, devicePubkey, githubToken });
        console.log(`  Authorized @${username} on this device.`);
        await trySync();
      } catch (err) {
        console.error(`pi-streak: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    if (config?.devicePubkey && config.username === username) {
      try {
        await trySync();
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("Invalid device") || msg.includes("Invalid signature")) {
          await doAuthorize();
        } else {
          console.error(`pi-streak: ${msg}`);
          process.exit(1);
        }
      }
    } else {
      await doRegister();
    }
    return;
  }

  if (options.command === "rank") {
    const { fetchLeaderboard, getGitUsername } = await import("./sync");
    const period = options.rankPeriod ?? "alltime";
    const showAll = options.rankAll;
    const limit = showAll ? 50 : 20;
    const { users, period: returnedPeriod } = await fetchLeaderboard(period, limit);
    if (options.json) {
      console.log(JSON.stringify({ users, period: returnedPeriod }, null, 2));
      return;
    }
    const currentUser = getGitUsername() ?? "";
    console.log(renderLeaderboard(users, returnedPeriod, currentUser, showAll, limit));
    return;
  }

  if (options.command === "user" && options.username) {
    try {
      const { fetchUserProfile } = await import("./sync");
      const profile = await fetchUserProfile(options.username);
      const daily: DailyRow[] = (profile.daily ?? []).map((d) => ({
        day: d.date,
        tokens: d.tokens,
        turns: d.requests,
        inputTokens: d.inputTokens ?? 0,
        outputTokens: d.outputTokens ?? 0,
        cacheTokens: d.cacheTokens ?? 0,
        cost: d.cost ?? 0,
        projects: 0,
        sessions: 0,
      }));
      if (options.json) {
        console.log(JSON.stringify({ profile, daily }, null, 2));
        return;
      }
      console.log(renderUserDashboard(profile.username, options.weeks, daily, profile.streak, profile.lifetimeTokens, profile.rank, profile.todayTokens, profile.activeDays));
    } catch (err) {
      console.error(`pi-streak: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  const { summary, daily, models, projects, peakDay } = loadData(options.dirPath);
  const streaks = computeStreaks(new Set(daily.filter((day) => day.turns > 0).map((day) => day.day)));

  if (options.command === "month") {
    const month = options.month ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    if (options.json) {
      console.log(JSON.stringify({ month, daily: daily.filter(d => d.day.startsWith(month)) }, null, 2));
      return;
    }
    console.log(renderMonth(month, daily));
    return;
  }

  if (options.command === "today") {
    const todayData = loadTodayData(options.dirPath);
    if (options.json) {
      console.log(JSON.stringify(todayData, null, 2));
      return;
    }
    console.log(renderToday(todayData));
    return;
  }

  if (options.command === "models") {
    if (options.json) {
      console.log(JSON.stringify({ models }, null, 2));
      return;
    }
    console.log(renderModels(models));
    return;
  }

  if (options.command === "projects") {
    if (options.json) {
      console.log(JSON.stringify({ projects }, null, 2));
      return;
    }
    console.log(renderProjects(projects));
    return;
  }

  if (options.command === "cost") {
    if (options.json) {
      console.log(JSON.stringify({ daily: daily.slice(-30).reverse() }, null, 2));
      return;
    }
    console.log(renderCost(daily));
    return;
  }

  if (options.command === "peak") {
    if (options.json) {
      console.log(JSON.stringify({ peakDay }, null, 2));
      return;
    }
    console.log(renderPeak(peakDay));
    return;
  }

  if (options.month) {
    if (options.json) {
      console.log(JSON.stringify({ month: options.month, daily: daily.filter(d => d.day.startsWith(options.month!)) }, null, 2));
      return;
    }
    console.log(renderMonth(options.month, daily));
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          directory: options.dirPath,
          generatedAt: new Date().toISOString(),
          summary: { ...summary, currentStreak: streaks.current, longestStreak: streaks.longest },
          daily,
          models,
          projects,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(renderDashboard(formatPath(options.dirPath), options.weeks, summary, daily, streaks.current));
}

main();
