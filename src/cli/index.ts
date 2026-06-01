#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { parseArgs, usage } from "./args";
import { loadData, loadTodayData, computeStreaks } from "./parser";
import { renderDashboard, renderToday } from "./render";
import { color } from "./util";

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

    const clientSecret = process.env.PI_STREAK_CLIENT_SECRET ?? "";
    const { publicKey: devicePubkeyRaw, privateKey } = getOrCreateKeypair();
    const devicePubkey = devicePubkeyRaw.trim();

    async function trySync() {
      await syncFn(username, devicePubkey, privateKey, daily, streaks.current, activeDays);
    }

    async function doRegister() {
      if (!clientSecret) {
        console.error("pi-streak: missing clientSecret. Set PI_STREAK_CLIENT_SECRET env var.");
        process.exit(1);
      }
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
        await register(username, devicePubkey, clientSecret, githubToken);
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
        await authorizeDevice(devicePubkey, githubToken, clientSecret);
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
    const muted = (text: string) => color("38;5;245", text);
    const dim = (text: string) => color("38;5;240", text);
    const highlight = (text: string) => color("1;38;5;255", text);
    const accent = (text: string) => color("38;5;81", text);
    const orange = (text: string) => color("38;5;208", text);
    const purple = (text: string) => color("38;5;141", text);
    const { formatTokens, padVisual, stripAnsi } = await import("./util");

    const currentUser = getGitUsername() ?? "";
    const userInList = users.find((u) => u.username === currentUser);
    const userRank = userInList?.rank ?? 0;
    const showUser = userInList && !showAll && userRank > limit;

    const wRank = Math.max(String(users.length + (showUser ? 1 : 0)).length, "#".length);
    const wUser = Math.max(...users.map((u) => `@${u.username}`.length + (u.username === currentUser ? 8 : 0)), "User".length) + 4;
    const wTokens = Math.max(...users.map((u) => formatTokens(u.tokens).length), "Tokens".length) + 2;
    const wStreak = Math.max(...users.map((u) => String(u.streak).length), "Streak".length) + 2;
    const wToday = Math.max(...users.map((u) => formatTokens(u.today).length), "Today".length) + 2;
    const wActive = Math.max(...users.map((u) => String(u.activeDays).length), "Days".length) + 2;
    const totalWidth = wRank + wUser + wTokens + wStreak + wToday + wActive + 24;

    console.log("");
    const headerLeft = `${highlight("π leaderboard")}  ${muted(returnedPeriod)}`;
    const headerRight = muted(`${users.length} participants`);
    const headerPad = Math.max(1, totalWidth - stripAnsi(headerLeft).length - stripAnsi(headerRight).length);
    console.log(`  ${headerLeft}${" ".repeat(headerPad)}${headerRight}`);
    console.log("");

    const hRank = muted("#".padStart(wRank));
    const hUser = muted("User".padEnd(wUser));
    const hTokens = muted("Tokens".padStart(wTokens));
    const hStreak = muted("Streak".padStart(wStreak));
    const hToday = muted("Today".padStart(wToday));
    const hActive = muted("Days".padStart(wActive));
    const headerRow = `  ${hRank}    ${hUser}    ${hTokens}    ${hStreak}    ${hToday}    ${hActive}`;
    console.log(headerRow);
    console.log(`  ${muted("─".repeat(totalWidth))}`);

    function renderRow(u: typeof users[0]) {
      const isYou = u.username === currentUser;
      const rankStr = String(u.rank).padStart(wRank);
      const userStr = isYou
        ? `${highlight("@" + u.username)} ${purple("← you")}`
        : `@${u.username}`;
      const userPadded = padVisual(userStr, wUser);
      const tokensStr = formatTokens(u.tokens).padStart(wTokens);
      const streakStr = u.streak > 0 ? orange(`${u.streak}`.padStart(wStreak)) : dim("—".padStart(wStreak));
      const todayStr = u.today > 0 ? accent(formatTokens(u.today).padStart(wToday)) : dim("—".padStart(wToday));
      const activeStr = u.activeDays > 0 ? accent(`${u.activeDays}`.padStart(wActive)) : dim("—".padStart(wActive));

      const styledRank = isYou ? highlight(rankStr) : dim(rankStr);
      const styledUser = isYou ? userPadded : muted(padVisual(userStr, wUser));
      const styledTokens = isYou ? highlight(tokensStr) : muted(tokensStr);
      const styledStreak = isYou ? streakStr : muted(u.streak > 0 ? String(u.streak).padStart(wStreak) : "—".padStart(wStreak));
      const styledToday = isYou ? todayStr : muted(u.today > 0 ? formatTokens(u.today).padStart(wToday) : "—".padStart(wToday));
      const styledActive = isYou ? activeStr : muted(u.activeDays > 0 ? String(u.activeDays).padStart(wActive) : "—".padStart(wActive));

      console.log(`  ${styledRank}    ${styledUser}    ${styledTokens}    ${styledStreak}    ${styledToday}    ${styledActive}`);
      console.log(`  ${dim("─".repeat(totalWidth))}`);
    }

    for (let i = 0; i < users.length; i++) {
      renderRow(users[i]);
    }

    if (showUser) {
      console.log(`  ${dim("...".padStart(wRank))}    ${dim("...".padEnd(wUser))}    ${dim("...".padStart(wTokens))}    ${dim("...".padStart(wStreak))}    ${dim("...".padStart(wToday))}    ${dim("...".padStart(wActive))}`);
      console.log(`  ${dim("─".repeat(totalWidth))}`);
      renderRow(userInList);
    }

    const orangeSquare = color("38;5;208", "■");
    const blueSquare = color("38;5;81", "■");
    console.log(`  ${orangeSquare} ${muted("streak")}    ${blueSquare} ${muted("today")}    ${blueSquare} ${muted("active days")}`);
    console.log("");
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

  console.log(renderDashboard(options.dirPath, options.weeks, summary, daily, streaks.current));
}

main();
