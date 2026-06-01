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
    const { loadConfig, getGitUsername, saveConfig, register, sync: syncFn } = await import("./sync");
    const config = loadConfig();
    const { daily } = loadData(options.dirPath);
    const streaks = computeStreaks(new Set(daily.filter((day) => day.turns > 0).map((day) => day.day)));
    const activeDays = daily.filter((day) => day.turns > 0).length;

    if (config && config.clientSecret) {
      await syncFn(config.username, config.apiKey, config.clientSecret, daily, streaks.current, activeDays);
    } else if (config && !config.clientSecret) {
      const envSecret = process.env.PI_STREAK_CLIENT_SECRET;
      if (envSecret) {
        await syncFn(config.username, config.apiKey, envSecret, daily, streaks.current, activeDays);
      } else {
        console.error("  pi-streak: missing clientSecret in config");
        console.error("  Set PI_STREAK_CLIENT_SECRET env var or delete ~/.pi/streak.json to re-register");
        process.exit(1);
      }
    } else {
      const username = getGitUsername();
      if (!username) {
        console.error("pi-streak: could not determine username. Set git config github.user or user.name");
        process.exit(1);
      }
      const envSecret = process.env.PI_STREAK_CLIENT_SECRET;
      try {
        const { apiKey, clientSecret } = await register(username, envSecret);
        saveConfig({ username, apiKey, clientSecret });
        console.log(`  Registered @${username}. API key saved to ~/.pi/streak.json`);
        await syncFn(username, apiKey, clientSecret, daily, streaks.current, activeDays);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("Username taken")) {
          console.error(`pi-streak: @${username} already exists. Set PI_STREAK_CLIENT_SECRET to recover or use a different username.`);
          process.exit(1);
        } else {
          console.error(`pi-streak: ${msg}`);
          process.exit(1);
        }
      }
    }
    return;
  }

  if (options.command === "rank") {
    const { fetchLeaderboard, getGitUsername, loadConfig } = await import("./sync");
    const config = loadConfig();
    const period = options.rankPeriod ?? "alltime";
    const { users, period: returnedPeriod } = await fetchLeaderboard(period, config?.clientSecret);
    const muted = (text: string) => color("38;5;245", text);
    const dim = (text: string) => color("38;5;240", text);
    const highlight = (text: string) => color("1;38;5;255", text);
    const accent = (text: string) => color("38;5;81", text);
    const orange = (text: string) => color("38;5;208", text);
    const purple = (text: string) => color("38;5;141", text);
    const { formatTokens, padVisual, stripAnsi } = await import("./util");

    const currentUser = getGitUsername() ?? "";

    const wRank = Math.max(String(users.length).length, "#".length);
    const wUser = Math.max(...users.map((u) => `@${u.username}`.length + (u.username === currentUser ? 8 : 0)), "User".length);
    const wTokens = Math.max(...users.map((u) => formatTokens(u.tokens).length), "Tokens".length);
    const wStreak = Math.max(...users.map((u) => String(u.streak).length), "Streak".length);
    const wToday = Math.max(...users.map((u) => formatTokens(u.today).length), "Today".length);
    const wActive = Math.max(...users.map((u) => String(u.activeDays).length), "Days".length);
    const totalWidth = wRank + wUser + wTokens + wStreak + wToday + wActive + 15;

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
    const headerRow = `  ${hRank}  ${hUser}  ${hTokens}  ${hStreak}  ${hToday}  ${hActive}`;
    console.log(headerRow);
    console.log(`  ${muted("─".repeat(totalWidth))}`);

    for (const u of users) {
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

      console.log(`  ${styledRank}  ${styledUser}  ${styledTokens}  ${styledStreak}  ${styledToday}  ${styledActive}`);
      console.log(`  ${dim("─".repeat(totalWidth))}`);
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
