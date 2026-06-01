import type { DailyRow, LeaderboardEntry, ModelRow, ProjectRow, SummaryRow, TodayData } from "./lib/types";
import {
  color,
  compactNumber,
  formatPath,
  formatTokens,
  localDay,
  truncateModel,
  addDays,
  startOfToday,
  padVisual,
  stripAnsi,
} from "./util";

import { basename } from "node:path";

export type ActivityLevel = {
  tokens: number;
  turns: number;
};

export function activityThresholds(activity: Map<string, ActivityLevel>): number[] {
  const nonzero = [...activity.values()]
    .map((value) => value.tokens)
    .filter((tokens) => tokens > 0)
    .sort((left, right) => left - right);

  if (nonzero.length === 0) return [0, 0, 0];
  const at = (quantile: number): number => nonzero[Math.floor((nonzero.length - 1) * quantile)] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

export function activityLevel(activity: ActivityLevel | undefined, thresholds: number[]): number {
  if (!activity) return 0;
  if (activity.tokens <= 0) return 1;
  if (activity.tokens <= thresholds[0]) return 1;
  if (activity.tokens <= thresholds[1]) return 2;
  if (activity.tokens <= thresholds[2]) return 3;
  return 4;
}

export function heatCell(level: number): string {
  const palette = ["38;5;238", "38;5;22", "38;5;28", "38;5;34", "38;5;40"];
  return color(palette[level], "■");
}

export function renderHeatmap(activity: Map<string, ActivityLevel>, weeks: number): string[] {
  const today = startOfToday();
  const thisSunday = addDays(today, -today.getDay());
  const firstSunday = addDays(thisSunday, -(weeks - 1) * 7);
  const thresholds = activityThresholds(activity);
  const monthLine = Array.from({ length: weeks + 2 }, () => " ");
  let lastMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const date = addDays(firstSunday, week * 7);
    const saturday = addDays(date, 6);
    const containsToday = date <= today && today <= saturday;
    const labelDate = containsToday && date.getMonth() !== saturday.getMonth() ? saturday : date;
    if (labelDate.getMonth() !== lastMonth) {
      const label = labelDate.toLocaleString("en", { month: "short" });
      for (let offset = 0; offset < label.length && week + offset < monthLine.length; offset += 1) {
        monthLine[week + offset] = label[offset];
      }
      lastMonth = labelDate.getMonth();
    }
  }

  const labels = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "];
  const lines = [`      ${monthLine.join("")}`];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    let row = `  ${labels[weekday]} `;
    for (let week = 0; week < weeks; week += 1) {
      const date = addDays(firstSunday, week * 7 + weekday);
      row += date > today ? " " : heatCell(activityLevel(activity.get(localDay(date)), thresholds));
    }
    lines.push(row);
  }

  const legend = [0, 1, 2, 3, 4].map((level) => heatCell(level)).join("");
  lines.push(`      Less ${legend} More`);
  return lines;
}

export function renderDashboard(
  label: string,
  weeks: number,
  summary: SummaryRow,
  daily: DailyRow[],
  currentStreak: number
): string {
  const activity = new Map(daily.map((day) => [day.day, { tokens: day.tokens, turns: day.turns }]));
  const today = startOfToday();
  const firstSunday = addDays(addDays(today, -today.getDay()), -(weeks - 1) * 7);
  const visibleDays = daily.filter((day) => day.day >= localDay(firstSunday) && day.day <= localDay(today));
  const visibleTokens = visibleDays.reduce((sum, day) => sum + day.tokens, 0);
  const visibleActiveDays = visibleDays.filter((day) => day.turns > 0).length;
  const muted = (text: string) => color("38;5;245", text);
  const highlight = (text: string) => color("1;38;5;255", text);

  const output = [
    "",
    `  ${highlight("π pi activity")}  ${highlight(compactNumber(visibleTokens))} tokens / ${weeks} weeks  ${muted(label)}`,
    "",
    ...renderHeatmap(activity, weeks),
    `  ${visibleActiveDays} active days  ${muted("|")}  ${currentStreak} day streak  ${muted("|")}  ${compactNumber(summary.lifetimeTokens)} all-time`,
    "",
  ];

  return output.join("\n");
}

export function renderUserDashboard(
  username: string,
  weeks: number,
  daily: DailyRow[],
  currentStreak: number,
  lifetimeTokens: number,
  rank: number,
): string {
  const activity = new Map(daily.map((day) => [day.day, { tokens: day.tokens, turns: day.turns }]));
  const today = startOfToday();
  const firstSunday = addDays(addDays(today, -today.getDay()), -(weeks - 1) * 7);
  const visibleDays = daily.filter((day) => day.day >= localDay(firstSunday) && day.day <= localDay(today));
  const visibleTokens = visibleDays.reduce((sum, day) => sum + day.tokens, 0);
  const visibleActiveDays = visibleDays.filter((day) => day.turns > 0).length;
  const muted = (text: string) => color("38;5;245", text);
  const highlight = (text: string) => color("1;38;5;255", text);
  const accent = (text: string) => color("38;5;81", text);

  const output = [
    "",
    `  ${highlight("π pi activity")}  ${highlight("@" + username)}  ${muted("rank " + rank)}`,
    "",
    ...renderHeatmap(activity, weeks),
    `  ${visibleActiveDays} active days  ${muted("|")}  ${currentStreak} day streak  ${muted("|")}  ${compactNumber(lifetimeTokens)} all-time`,
    "",
  ];

  return output.join("\n");
}

export function renderToday(data: TodayData): string {
  const muted = (text: string) => color("38;5;245", text);
  const highlight = (text: string) => color("1;38;5;255", text);
  const accent = (text: string) => color("38;5;81", text);

  const lines: string[] = [""];

  const dateStr = localDay(startOfToday());
  const inputStr = formatTokens(data.inputTokens);
  const outputStr = formatTokens(data.outputTokens);
  const cacheStr = formatTokens(data.cacheTokens);
  const tokensStr = formatTokens(data.tokens);
  const costStr = "$" + data.cost.toFixed(4);

  const wDate = Math.max(dateStr.length, "Date".length);
  const wInput = Math.max(inputStr.length, "Input".length);
  const wOutput = Math.max(outputStr.length, "Output".length);
  const wCache = Math.max(cacheStr.length, "Cache".length);
  const wTokens = Math.max(tokensStr.length, "Tokens".length);
  const wCost = Math.max(costStr.length, "Cost".length);

  const wh = [wDate, wInput, wOutput, wCache, wTokens, wCost];
  const hTop = "  ┌─" + wh.map((x) => "─".repeat(x)).join("─┬─") + "─┐";
  const hSep = "  ├─" + wh.map((x) => "─".repeat(x)).join("─┼─") + "─┤";
  const hBot = "  └─" + wh.map((x) => "─".repeat(x)).join("─┴─") + "─┘";

  const hDate = muted("Date".padEnd(wDate));
  const hInput = muted("Input".padEnd(wInput));
  const hOutput = muted("Output".padEnd(wOutput));
  const hCache = muted("Cache".padEnd(wCache));
  const hTokens = muted("Tokens".padEnd(wTokens));
  const hCost = muted("Cost".padEnd(wCost));
  const hRow = `  │ ${hDate} │ ${hInput} │ ${hOutput} │ ${hCache} │ ${hTokens} │ ${hCost} │`;

  const cDate = highlight(dateStr.padEnd(wDate));
  const cInput = highlight(inputStr.padEnd(wInput));
  const cOutput = highlight(outputStr.padEnd(wOutput));
  const cCache = highlight(cacheStr.padEnd(wCache));
  const cTokens = highlight(tokensStr.padEnd(wTokens));
  const cCost = accent(costStr.padEnd(wCost));
  const cRow = `  │ ${cDate} │ ${cInput} │ ${cOutput} │ ${cCache} │ ${cTokens} │ ${cCost} │`;

  lines.push(hTop);
  lines.push(hRow);
  lines.push(hSep);
  lines.push(cRow);
  lines.push(hBot);
  lines.push("");

  if (data.projects.length > 0) {
    const projectNames = data.projects.map((p) => truncateModel(basename(p.project), 18));
    const inputStrs = data.projects.map((p) => formatTokens(p.inputTokens));
    const outputStrs = data.projects.map((p) => formatTokens(p.outputTokens));
    const cacheStrs = data.projects.map((p) => formatTokens(p.cacheTokens));
    const tokenStrs = data.projects.map((p) => formatTokens(p.tokens));
    const costStrs = data.projects.map((p) => "$" + p.cost.toFixed(4));

    const wProject = Math.max(...projectNames.map((s) => s.length), "Project".length);
    const wInput = Math.max(...inputStrs.map((s) => s.length), "Input".length);
    const wOutput = Math.max(...outputStrs.map((s) => s.length), "Output".length);
    const wCache = Math.max(...cacheStrs.map((s) => s.length), "Cache".length);
    const wTokens = Math.max(...tokenStrs.map((s) => s.length), "Tokens".length);
    const wCost = Math.max(...costStrs.map((s) => s.length), "Cost".length);
    
    const w = [wProject, wInput, wOutput, wCache, wTokens, wCost];
    const top = "  ┌─" + w.map((x) => "─".repeat(x)).join("─┬─") + "─┐";
    const sep = "  ├─" + w.map((x) => "─".repeat(x)).join("─┼─") + "─┤";
    const bot = "  └─" + w.map((x) => "─".repeat(x)).join("─┴─") + "─┘";

    const hProject = muted("Project".padEnd(wProject));
    const hInput = muted("Input".padStart(wInput));
    const hOutput = muted("Output".padStart(wOutput));
    const hCache = muted("Cache".padStart(wCache));
    const hTokens = muted("Tokens".padStart(wTokens));
    const hCost = muted("Cost".padStart(wCost));
    const headerRow = `  │ ${hProject} │ ${hInput} │ ${hOutput} │ ${hCache} │ ${hTokens} │ ${hCost} │`;

    lines.push(top);
    lines.push(headerRow);
    lines.push(sep);

    for (let i = 0; i < data.projects.length; i++) {
      const cProject = projectNames[i].padEnd(wProject);
      const cInput = highlight(inputStrs[i].padStart(wInput));
      const cOutput = highlight(outputStrs[i].padStart(wOutput));
      const cCache = highlight(cacheStrs[i].padStart(wCache));
      const cTokens = highlight(tokenStrs[i].padStart(wTokens));
      const cCost = accent(costStrs[i].padStart(wCost));
      lines.push(`  │ ${cProject} │ ${cInput} │ ${cOutput} │ ${cCache} │ ${cTokens} │ ${cCost} │`);
    }

    lines.push(bot);
    lines.push("");
  }

  const activeHours = data.hourly.filter((h) => h.tokens > 0);
  const maxHourly = Math.max(...activeHours.map((h) => h.tokens), 1);
  const barLen = 20;

  lines.push(`  ${highlight("Active hours")}`);
  for (const h of activeHours) {
    const hourStr = String(h.hour).padStart(2, "0") + ":00";
    const barCount = Math.round((h.tokens / maxHourly) * barLen);
    const bar = "█".repeat(barCount).padEnd(barLen, "░");
    const tokens = formatTokens(h.tokens);
    lines.push(`  ${hourStr}  ${highlight(bar)}  ${tokens}`);
  }
  lines.push("");

  return lines.join("\n");
}

export function renderProjects(projects: ProjectRow[]): string {
  const muted = (text: string) => color("38;5;245", text);
  const highlight = (text: string) => color("1;38;5;255", text);
  const accent = (text: string) => color("38;5;81", text);

  const lines: string[] = ["", `  ${highlight("Project usage")}`];

  const maxProjectLen = 32;
  const projectPad = maxProjectLen + 2;

  const tokenStrs = projects.map((p) => formatTokens(p.tokens));
  const reqStrs = projects.map((p) => String(p.requests));
  const costStrs = projects.map((p) => "$" + p.cost.toFixed(4));

  const tokensWidth = Math.max(...tokenStrs.map((s) => s.length), "Tokens".length);
  const reqsWidth = Math.max(...reqStrs.map((s) => s.length), "Requests".length);
  const costWidth = Math.max(...costStrs.map((s) => s.length), "Cost".length);

  const gap = 2;
  const totalWidth = projectPad + tokensWidth + gap + reqsWidth + gap + costWidth;

  const header = `  ${"Project".padEnd(projectPad)}${"Tokens".padStart(tokensWidth)}${"".padStart(gap)}${"Requests".padStart(reqsWidth)}${"".padStart(gap)}${"Cost".padStart(costWidth)}`;
  lines.push(muted(header));
  lines.push(muted(`  ${"─".repeat(totalWidth)}`));

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const tokens = tokenStrs[i].padStart(tokensWidth);
    const reqs = reqStrs[i].padStart(reqsWidth);
    const cost = costStrs[i].padStart(costWidth);
    const projectName = truncateModel(basename(p.project), maxProjectLen);
    lines.push(
      `  ${projectName.padEnd(projectPad)}${highlight(tokens)}${"".padStart(gap)}${reqs}${"".padStart(gap)}${accent(cost)}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function renderModels(models: ModelRow[]): string {
  const muted = (text: string) => color("38;5;245", text);
  const highlight = (text: string) => color("1;38;5;255", text);
  const accent = (text: string) => color("38;5;81", text);

  const lines: string[] = ["", `  ${highlight("Model usage")}`];

  const maxModelLen = 32;
  const modelPad = maxModelLen + 2;

  const tokenStrs = models.map((m) => formatTokens(m.tokens));
  const turnStrs = models.map((m) => String(m.turns));
  const costStrs = models.map((m) => "$" + m.cost.toFixed(4));

  const tokensWidth = Math.max(...tokenStrs.map((s) => s.length), "Tokens".length);
  const turnsWidth = Math.max(...turnStrs.map((s) => s.length), "Requests".length);
  const costWidth = Math.max(...costStrs.map((s) => s.length), "Cost".length);

  const gap = 2;
  const totalWidth = modelPad + tokensWidth + gap + turnsWidth + gap + costWidth;

  const header = `  ${"Model".padEnd(modelPad)}${"Tokens".padStart(tokensWidth)}${"".padStart(gap)}${"Requests".padStart(turnsWidth)}${"".padStart(gap)}${"Cost".padStart(costWidth)}`;
  lines.push(muted(header));
  lines.push(muted(`  ${"─".repeat(totalWidth)}`));

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const tokens = tokenStrs[i].padStart(tokensWidth);
    const turns = turnStrs[i].padStart(turnsWidth);
    const cost = costStrs[i].padStart(costWidth);
    const modelName = truncateModel(m.model, maxModelLen);
    lines.push(
      `  ${modelName.padEnd(modelPad)}${highlight(tokens)}${"".padStart(gap)}${turns}${"".padStart(gap)}${accent(cost)}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function renderLeaderboard(
  users: LeaderboardEntry[],
  period: string,
  currentUser: string,
  showAll: boolean,
  limit: number,
): string {
  const muted = (text: string) => color("38;5;245", text);
  const dim = (text: string) => color("38;5;240", text);
  const highlight = (text: string) => color("1;38;5;255", text);
  const accent = (text: string) => color("38;5;81", text);
  const orange = (text: string) => color("38;5;208", text);
  const purple = (text: string) => color("38;5;141", text);

  const userInList = users.find((u) => u.username === currentUser);
  const userRank = userInList?.rank ?? 0;
  const showUser = userInList && !showAll && userRank > limit;

  const wRank = Math.max(String(users.length + (showUser ? 1 : 0)).length, "#".length);
  const wUser = Math.max(...users.map((u) => `@${u.username}`.length + (u.username === currentUser ? 8 : 0)), "User".length) + 4;
  const wTokens = Math.max(...users.map((u) => formatTokens(u.tokens).length), "Tokens".length) + 2;
  const wStreak = Math.max(...users.map((u) => String(u.streak).length), "Streak".length) + 2;
  const wToday = Math.max(...users.map((u) => formatTokens(u.today).length), "Today".length) + 2;
  const wActive = Math.max(...users.map((u) => String(u.activeDays).length), "Days".length) + 2;

  const terminalWidth = process.stdout?.columns ?? 120;
  const contentWidth = wRank + wUser + wTokens + wStreak + wToday + wActive;
  const minGap = 1;
  const baseGap = 4;
  const preferredWidth = 2 + contentWidth + 5 * baseGap;

  const gap = terminalWidth >= preferredWidth ? baseGap : minGap;
  const totalWidth = contentWidth + 5 * gap;

  const lines: string[] = [""];

  const headerLeft = `${highlight("π leaderboard")}  ${muted(period)}`;
  const headerRight = muted(`${users.length} participants`);
  const headerLeftLen = stripAnsi(headerLeft).length;
  const headerRightLen = stripAnsi(headerRight).length;
  const headerPad = Math.max(1, totalWidth - headerLeftLen - headerRightLen);
  lines.push(`  ${headerLeft}${" ".repeat(headerPad)}${headerRight}`);
  lines.push("");

  const hRank = muted("#".padStart(wRank));
  const hUser = muted("User".padEnd(wUser));
  const hTokens = muted("Tokens".padStart(wTokens));
  const hStreak = muted("Streak".padStart(wStreak));
  const hToday = muted("Today".padStart(wToday));
  const hActive = muted("Days".padStart(wActive));
  lines.push(`  ${hRank}${" ".repeat(gap)}${hUser}${" ".repeat(gap)}${hTokens}${" ".repeat(gap)}${hStreak}${" ".repeat(gap)}${hToday}${" ".repeat(gap)}${hActive}`);
  lines.push(`  ${muted("─".repeat(totalWidth))}`);

  function renderRow(u: LeaderboardEntry) {
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

    lines.push(`  ${styledRank}${" ".repeat(gap)}${styledUser}${" ".repeat(gap)}${styledTokens}${" ".repeat(gap)}${styledStreak}${" ".repeat(gap)}${styledToday}${" ".repeat(gap)}${styledActive}`);
    lines.push(`  ${dim("─".repeat(totalWidth))}`);
  }

  for (let i = 0; i < users.length; i++) {
    renderRow(users[i]);
  }

  if (showUser) {
    lines.push(`  ${dim("...".padStart(wRank))}${" ".repeat(gap)}${dim("...".padEnd(wUser))}${" ".repeat(gap)}${dim("...".padStart(wTokens))}${" ".repeat(gap)}${dim("...".padStart(wStreak))}${" ".repeat(gap)}${dim("...".padStart(wToday))}${" ".repeat(gap)}${dim("...".padStart(wActive))}`);
    lines.push(`  ${dim("─".repeat(totalWidth))}`);
    renderRow(userInList);
  }

  const orangeSquare = color("38;5;208", "■");
  const blueSquare = color("38;5;81", "■");
  lines.push(`  ${orangeSquare} ${muted("streak")}    ${blueSquare} ${muted("today")}    ${blueSquare} ${muted("active days")}`);
  lines.push("");

  return lines.join("\n");
}


