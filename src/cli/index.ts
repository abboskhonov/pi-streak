#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { parseArgs, usage } from "./args";
import { loadData, loadTodayData, computeStreaks } from "./parser";
import { renderDashboard, renderLeaderboard, renderToday, renderUserDashboard } from "./render";
import { color, formatPath } from "./util";

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
    const { daily } = loadData(options.dirPath);
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
      await syncFn(username, devicePubkey, privateKey, daily, streaks.current, activeDays);
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
    const currentUser = getGitUsername() ?? "";
    console.log(renderLeaderboard(users, returnedPeriod, currentUser, showAll, limit));
    return;
  }

  if (options.command === "user" && options.username) {
    try {
      const { fetchUserProfile } = await import("./sync");
      const profile = await fetchUserProfile(options.username);
      const daily: { day: string; tokens: number; turns: number; inputTokens: number; outputTokens: number; cacheTokens: number; cost: number }[] = profile.daily.map((d) => ({
        day: d.date,
        tokens: d.tokens,
        turns: d.turns,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        cacheTokens: d.cacheTokens,
        cost: d.cost,
      }));
      console.log(renderUserDashboard(profile.username, options.weeks, daily, profile.streak, profile.lifetimeTokens, profile.rank));
    } catch (err) {
      console.error(`pi-streak: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  const { summary, daily, models, projects } = loadData(options.dirPath);
  const streaks = computeStreaks(new Set(daily.filter((day) => day.turns > 0).map((day) => day.day)));

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

  if (options.command === "today") {
    const todayData = loadTodayData(options.dirPath);
    console.log(renderToday(todayData));
    return;
  }

  console.log(renderDashboard(formatPath(options.dirPath), options.weeks, summary, daily, streaks.current));
}

main();
