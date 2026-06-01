export type Options = {
  dirPath: string;
  weeks: number;
  json: boolean;
  command: "dashboard" | "today" | "rank" | "sync" | null;
  rankPeriod: string | null;
  rankAll: boolean;
};

export type HourlyActivity = {
  hour: number;
  tokens: number;
  requests: number;
};

export type TodayData = {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  cost: number;
  models: ModelRow[];
  projects: ProjectRow[];
  hourly: HourlyActivity[];
};

export type ProjectRow = {
  project: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  requests: number;
};

export type SummaryRow = {
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

export type DailyRow = {
  day: string;
  tokens: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
};

export type DayActivity = {
  tokens: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
};

export type ModelRow = {
  model: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  turns: number;
};

export type PiMessage = {
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

export type Pricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  tokens: number;
  streak: number;
  activeDays: number;
  today: number;
};

export type SyncPayload = {
  username: string;
  apiKey: string;
  date: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  cost: number;
  streak: number;
  activeDays: number;
  models: { model: string; tokens: number; cost: number }[];
};
