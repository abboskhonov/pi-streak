#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type Options = {
  dirPath: string;
  weeks: number;
  json: boolean;
  noColor: boolean;
  models: boolean;
  projects: boolean;
};

type ProjectRow = {
  project: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  requests: number;
};

type SummaryRow = {
  tasks: number;
  lifetimeTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheTokens: number;
  cost: number;
  peakTokens: number;
  longestTaskMs: number;
};

type DailyRow = {
  day: string;
  tokens: number;
  turns: number;
};

type DayActivity = {
  tokens: number;
  turns: number;
};

type ModelRow = {
  model: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  turns: number;
};

type PiMessage = {
  type: string;
  timestamp: string;
  provider?: string;
  modelId?: string;
  cwd?: string;
  message?: {
    role: string;
    provider?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
      cost?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
    };
  };
};

const defaultDirPath = join(homedir(), ".pi", "agent", "sessions");
const modelsJsonPath = join(homedir(), ".pi", "agent", "models.json");
const reset = "\u001b[0m";

type Pricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

function loadPricing(): Map<string, Pricing> {
  const pricing = new Map<string, Pricing>();
  if (!existsSync(modelsJsonPath)) return pricing;

  try {
    const raw = JSON.parse(readFileSync(modelsJsonPath, "utf-8"));
    const providers = raw.providers || {};
    for (const provider of Object.values(providers) as Record<string, unknown>[]) {
      const overrides = provider.modelOverrides as Record<string, { cost?: Pricing }> | undefined;
      if (!overrides) continue;
      for (const [modelId, data] of Object.entries(overrides)) {
        if (data.cost) {
          pricing.set(modelId, data.cost);
        }
      }
    }
  } catch {
    // ignore malformed models.json
  }
  return pricing;
}

function computeCost(usage: NonNullable<PiMessage["message"]>["usage"], model: string, pricing: Map<string, Pricing>): number {
  const cost = usage?.cost?.total ?? 0;
  if (cost !== 0) return cost;

  const p = pricing.get(model);
  if (!p || !usage) return 0;

  const input = (usage.input ?? 0) / 1_000_000 * p.input;
  const output = (usage.output ?? 0) / 1_000_000 * p.output;
  const cacheRead = (usage.cacheRead ?? 0) / 1_000_000 * p.cacheRead;
  const cacheWrite = (usage.cacheWrite ?? 0) / 1_000_000 * p.cacheWrite;

  return input + output + cacheRead + cacheWrite;
}

function usage(): string {
  return `Usage: pi-streak [options]

Terminal usage profile generated from the pi session JSONL files.

Options:
  --dir <path>      Session directory path (default: ~/.pi/agent/sessions)
  --weeks <number>  Heatmap width in weeks, from 4 to 104 (default: 52)
  --models          Show model usage breakdown
  --projects        Show project usage breakdown
  --json            Print computed data as JSON instead of the dashboard
  --no-color        Disable ANSI colors
  -h, --help        Show this help`;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    dirPath: defaultDirPath,
    weeks: 52,
    json: false,
    noColor: false,
    models: false,
    projects: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }

    if (argument === "--json") {
      options.json = true;
      continue;
    }

    if (argument === "--no-color") {
      options.noColor = true;
      continue;
    }

    if (argument === "--models") {
      options.models = true;
      continue;
    }

    if (argument === "--projects") {
      options.projects = true;
      continue;
    }

    if (argument === "--dir" || argument === "--weeks") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing value for ${argument}`);
      }
      index += 1;

      if (argument === "--dir") {
        options.dirPath = value.replace(/^~(?=\/)/, homedir());
      } else {
        const weeks = Number.parseInt(value, 10);
        if (!Number.isInteger(weeks) || weeks < 4 || weeks > 104) {
          throw new Error("--weeks must be an integer between 4 and 104");
        }
        options.weeks = weeks;
      }
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPath(path: string): string {
  return path.startsWith(`${homedir()}/`) ? path.replace(homedir(), "~") : path;
}

function computeStreaks(days: Set<string>): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let previous: Date | undefined;

  for (const key of [...days].sort()) {
    const date = new Date(`${key}T00:00:00`);
    if (previous && addDays(previous, 1).getTime() === date.getTime()) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = date;
  }

  let current = 0;
  let cursor = startOfToday();
  while (days.has(localDay(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest };
}

function color(enabled: boolean, code: string, value: string): string {
  return enabled ? `\u001b[${code}m${value}${reset}` : value;
}

function activityThresholds(activity: Map<string, DayActivity>): number[] {
  const nonzero = [...activity.values()]
    .map((value) => value.tokens)
    .filter((tokens) => tokens > 0)
    .sort((left, right) => left - right);

  if (nonzero.length === 0) return [0, 0, 0];
  const at = (quantile: number): number => nonzero[Math.floor((nonzero.length - 1) * quantile)] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

function activityLevel(activity: DayActivity | undefined, thresholds: number[]): number {
  if (!activity) return 0;
  if (activity.tokens <= 0) return 1;
  if (activity.tokens <= thresholds[0]) return 1;
  if (activity.tokens <= thresholds[1]) return 2;
  if (activity.tokens <= thresholds[2]) return 3;
  return 4;
}

function heatCell(level: number, colors: boolean): string {
  if (!colors) return ["□", "░", "▒", "▓", "█"][level];
  const palette = ["38;5;238", "38;5;22", "38;5;28", "38;5;34", "38;5;40"];
  return color(true, palette[level], "■");
}

function renderHeatmap(activity: Map<string, DayActivity>, weeks: number, colors: boolean): string[] {
  const today = startOfToday();
  const thisSunday = addDays(today, -today.getDay());
  const firstSunday = addDays(thisSunday, -(weeks - 1) * 7);
  const thresholds = activityThresholds(activity);
  const monthLine = Array.from({ length: weeks }, () => " ");
  let lastMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const date = addDays(firstSunday, week * 7);
    if (date.getMonth() !== lastMonth) {
      const label = date.toLocaleString("en", { month: "short" });
      for (let offset = 0; offset < label.length && week + offset < monthLine.length; offset += 1) {
        monthLine[week + offset] = label[offset];
      }
      lastMonth = date.getMonth();
    }
  }

  const labels = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "];
  const lines = [`      ${monthLine.join("")}`];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    let row = `  ${labels[weekday]} `;
    for (let week = 0; week < weeks; week += 1) {
      const date = addDays(firstSunday, week * 7 + weekday);
      row += date > today ? " " : heatCell(activityLevel(activity.get(localDay(date)), thresholds), colors);
    }
    lines.push(row);
  }

  const legend = [0, 1, 2, 3, 4].map((level) => heatCell(level, colors)).join("");
  lines.push(`      Less ${legend} More`);
  return lines;
}

function loadData(dirPath: string): { summary: SummaryRow; daily: DailyRow[]; models: ModelRow[]; projects: ProjectRow[] } {
  const pricing = loadPricing();
  const summary: SummaryRow = {
    tasks: 0,
    lifetimeTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheTokens: 0,
    cost: 0,
    peakTokens: 0,
    longestTaskMs: 0,
  };

  const activity = new Map<string, DayActivity>();
  const sessionIds = new Set<string>();
  let peakTokens = 0;
  let longestTaskMs = 0;

  const modelUsage = new Map<string, ModelRow>();
  const projectUsage = new Map<string, ProjectRow>();

  if (!existsSync(dirPath)) {
    return { summary, daily: [], models: [], projects: [] };
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPathNested = join(dirPath, entry.name);
    const files = readdirSync(dirPathNested).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = join(dirPathNested, file);
      const stats = statSync(filePath);
      if (stats.size === 0) continue;

      summary.tasks += 1;
      const sessionId = file.replace(/\.jsonl$/, "");
      sessionIds.add(sessionId);

      let sessionTokens = 0;
      let sessionStartMs = 0;
      let sessionEndMs = 0;
      let currentModel = "unknown";
      let currentProject = "unknown";

      const text = readFileSync(filePath, "utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as PiMessage;

          if (entry.type === "session") {
            const ts = new Date(entry.timestamp).getTime();
            sessionStartMs = ts;
            if (sessionEndMs === 0) sessionEndMs = ts;
            if (entry.cwd) {
              currentProject = entry.cwd;
            }
          }

          if (entry.type === "model_change" && entry.modelId) {
            currentModel = entry.modelId;
          }

          if (entry.type === "message" && entry.message) {
            const ts = entry.timestamp;
            const day = ts ? localDay(new Date(ts)) : localDay(new Date());
            const role = entry.message.role;
            const usage = entry.message.usage;
            const msgModel = entry.message.model || currentModel;

            if (sessionEndMs === 0 && ts) {
              sessionEndMs = new Date(ts).getTime();
            }

            if (!activity.has(day)) {
              activity.set(day, { tokens: 0, turns: 0 });
            }
            const dayAct = activity.get(day)!;

            if (role === "assistant") {
              dayAct.turns += 1;
            }

            if (usage) {
              const input = usage.input ?? 0;
              const output = usage.output ?? 0;
              const cacheRead = usage.cacheRead ?? 0;
              const cacheWrite = usage.cacheWrite ?? 0;
              const total = usage.totalTokens ?? (input + output + cacheRead + cacheWrite);
              const cost = computeCost(usage, msgModel, pricing);

              summary.inputTokens += input;
              summary.outputTokens += output;
              summary.cacheTokens += cacheRead + cacheWrite;
              summary.lifetimeTokens += total;
              summary.cost += cost;
              dayAct.tokens += total;
              sessionTokens += total;

              if (!modelUsage.has(msgModel)) {
                modelUsage.set(msgModel, {
                  model: msgModel,
                  tokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheTokens: 0,
                  cost: 0,
                  turns: 0,
                });
              }
              const modelRow = modelUsage.get(msgModel)!;
              modelRow.tokens += total;
              modelRow.inputTokens += input;
              modelRow.outputTokens += output;
              modelRow.cacheTokens += cacheRead + cacheWrite;
              modelRow.cost += cost;
              if (role === "assistant") {
                modelRow.turns += 1;
              }

              if (!projectUsage.has(currentProject)) {
                projectUsage.set(currentProject, {
                  project: currentProject,
                  tokens: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheTokens: 0,
                  cost: 0,
                  requests: 0,
                });
              }
              const projectRow = projectUsage.get(currentProject)!;
              projectRow.tokens += total;
              projectRow.inputTokens += input;
              projectRow.outputTokens += output;
              projectRow.cacheTokens += cacheRead + cacheWrite;
              projectRow.cost += cost;
              if (role === "assistant") {
                projectRow.requests += 1;
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      peakTokens = Math.max(peakTokens, sessionTokens);
      const taskMs = sessionEndMs - sessionStartMs;
      if (taskMs > 0) {
        longestTaskMs = Math.max(longestTaskMs, taskMs);
      }
    }
  }

  summary.peakTokens = peakTokens;
  summary.longestTaskMs = longestTaskMs;

  const daily = [...activity.entries()]
    .map(([day, data]) => ({ day, tokens: data.tokens, turns: data.turns }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const models = [...modelUsage.values()]
    .sort((a, b) => b.tokens - a.tokens);

  const projects = [...projectUsage.values()]
    .sort((a, b) => b.tokens - a.tokens);

  return { summary, daily, models, projects };
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(1) + "K";
  return String(value);
}

function truncateModel(model: string, maxLen: number): string {
  if (model.length <= maxLen) return model;
  const keep = Math.floor((maxLen - 3) / 2);
  return model.slice(0, keep) + "..." + model.slice(-keep);
}

function renderProjects(projects: ProjectRow[], colors: boolean): string {
  const muted = (text: string) => color(colors, "38;5;245", text);
  const highlight = (text: string) => color(colors, "1;38;5;255", text);
  const accent = (text: string) => color(colors, "38;5;81", text);

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

function renderModels(models: ModelRow[], colors: boolean): string {
  const muted = (text: string) => color(colors, "38;5;245", text);
  const highlight = (text: string) => color(colors, "1;38;5;255", text);
  const accent = (text: string) => color(colors, "38;5;81", text);

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

function renderDashboard(options: Options, summary: SummaryRow, daily: DailyRow[]): string {
  const colors = !options.noColor && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const activeDays = new Set(daily.filter((day) => day.turns > 0).map((day) => day.day));
  const streaks = computeStreaks(activeDays);
  const activity = new Map(daily.map((day) => [day.day, { tokens: day.tokens, turns: day.turns }]));
  const today = startOfToday();
  const firstSunday = addDays(addDays(today, -today.getDay()), -(options.weeks - 1) * 7);
  const visibleDays = daily.filter((day) => day.day >= localDay(firstSunday) && day.day <= localDay(today));
  const visibleTokens = visibleDays.reduce((sum, day) => sum + day.tokens, 0);
  const visibleActiveDays = visibleDays.filter((day) => day.turns > 0).length;
  const muted = (text: string) => color(colors, "38;5;245", text);
  const highlight = (text: string) => color(colors, "1;38;5;255", text);
  const output = [
    "",
    `  ${highlight("π pi activity")}  ${highlight(compactNumber(visibleTokens))} tokens / ${options.weeks} weeks  ${muted(formatPath(options.dirPath))}`,
    "",
    ...renderHeatmap(activity, options.weeks, colors),
    `  ${visibleActiveDays} active days  ${muted("|")}  ${streaks.current} day streak  ${muted("|")}  ${streaks.longest} best  ${muted("|")}  ${compactNumber(summary.lifetimeTokens)} all-time`,
    "",
  ];

  return output.join("\n");
}

function main(): void {
  let options: Options;
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

  if (options.models) {
    console.log(renderModels(models, !options.noColor && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
    return;
  }

  if (options.projects) {
    console.log(renderProjects(projects, !options.noColor && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
    return;
  }

  console.log(renderDashboard(options, summary, daily));
}

main();
  