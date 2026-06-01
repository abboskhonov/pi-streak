import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  DailyRow,
  DayActivity,
  ModelRow,
  PiMessage,
  Pricing,
  ProjectRow,
  SummaryRow,
  TodayData,
} from "./lib/types";
import { localDay } from "./util";

const modelsJsonPath = join(homedir(), ".pi", "agent", "models.json");

export function loadPricing(): Map<string, Pricing> {
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

export function computeCost(
  usage: NonNullable<PiMessage["message"]>["usage"],
  model: string,
  pricing: Map<string, Pricing>
): number {
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

export function computeStreaks(days: Set<string>): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let previous: Date | undefined;

  for (const key of [...days].sort()) {
    const date = new Date(`${key}T00:00:00`);
    if (previous && new Date(date.getTime() - 86_400_000).toDateString() === previous.toDateString()) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = date;
  }

  let current = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = today;
  while (days.has(localDay(cursor))) {
    current += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }

  return { current, longest };
}

export function loadData(dirPath: string): {
  summary: SummaryRow;
  daily: DailyRow[];
  models: ModelRow[];
  projects: ProjectRow[];
} {
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
              activity.set(day, { tokens: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, cost: 0 });
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
              const cacheTotal = cacheRead + cacheWrite;

              summary.inputTokens += input;
              summary.outputTokens += output;
              summary.cacheTokens += cacheTotal;
              summary.lifetimeTokens += total;
              summary.cost += cost;
              dayAct.tokens += total;
              dayAct.inputTokens += input;
              dayAct.outputTokens += output;
              dayAct.cacheTokens += cacheTotal;
              dayAct.cost += cost;
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
              modelRow.cacheTokens += cacheTotal;
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
              projectRow.cacheTokens += cacheTotal;
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
    .map(([day, data]) => ({
      day,
      tokens: data.tokens,
      turns: data.turns,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheTokens: data.cacheTokens,
      cost: data.cost,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const models = [...modelUsage.values()].sort((a, b) => b.tokens - a.tokens);
  const projects = [...projectUsage.values()].sort((a, b) => b.tokens - a.tokens);

  return { summary, daily, models, projects };
}

export function loadTodayData(dirPath: string): TodayData {
  const pricing = loadPricing();
  const today = localDay(new Date());
  const todayData: TodayData = {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    requests: 0,
    cost: 0,
    models: [],
    projects: [],
    hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, tokens: 0, requests: 0 })),
  };

  const modelUsage = new Map<string, ModelRow>();
  const projectUsage = new Map<string, ProjectRow>();

  if (!existsSync(dirPath)) return todayData;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPathNested = join(dirPath, entry.name);
    const files = readdirSync(dirPathNested).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = join(dirPathNested, file);
      const stats = statSync(filePath);
      if (stats.size === 0) continue;

      let currentModel = "unknown";
      let currentProject = "unknown";

      const text = readFileSync(filePath, "utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as PiMessage;

          if (entry.type === "session" && entry.cwd) {
            currentProject = entry.cwd;
          }

          if (entry.type === "model_change" && entry.modelId) {
            currentModel = entry.modelId;
          }

          if (entry.type === "message" && entry.message) {
            const ts = entry.timestamp;
            const day = ts ? localDay(new Date(ts)) : localDay(new Date());
            if (day !== today) continue;

            const role = entry.message.role;
            const usage = entry.message.usage;
            const msgModel = entry.message.model || currentModel;
            const hour = ts ? new Date(ts).getHours() : 0;

            if (role === "assistant") {
              todayData.requests += 1;
              todayData.hourly[hour].requests += 1;
            }

            if (usage) {
              const input = usage.input ?? 0;
              const output = usage.output ?? 0;
              const cacheRead = usage.cacheRead ?? 0;
              const cacheWrite = usage.cacheWrite ?? 0;
              const total = usage.totalTokens ?? (input + output + cacheRead + cacheWrite);
              const cost = computeCost(usage, msgModel, pricing);
              const cacheTotal = cacheRead + cacheWrite;

              todayData.tokens += total;
              todayData.inputTokens += input;
              todayData.outputTokens += output;
              todayData.cacheTokens += cacheTotal;
              todayData.cost += cost;
              todayData.hourly[hour].tokens += total;

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
              modelRow.cacheTokens += cacheTotal;
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
              projectRow.cacheTokens += cacheTotal;
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
    }
  }

  todayData.models = [...modelUsage.values()].sort((a, b) => b.tokens - a.tokens);
  todayData.projects = [...projectUsage.values()].sort((a, b) => b.tokens - a.tokens);
  return todayData;
}
