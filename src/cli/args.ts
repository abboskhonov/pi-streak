import { homedir } from "node:os";
import type { Options } from "./lib/types";

export function usage(): string {
  return `Usage: pi-streak [command] [options]

Commands:
  today       Show today's activity breakdown
  rank        Show leaderboard (default: all-time, top 20)
              Use day, week, month, alltime for periods
              Use --all to show full list
  models      Show model usage breakdown
  projects    Show project usage breakdown
  cost        Show 30-day cost breakdown
  peak        Show your most expensive day
  month       Show a single-month calendar view
  @<username> Look up a user's profile and activity
  sync        Sync all stats to the leaderboard

Options:
  --dir <path>      Session directory path (default: ~/.pi/agent/sessions)
  --weeks <number>  Heatmap width in weeks, from 4 to 104 (default: 52)
  --month [YYYY-MM] Show a specific month calendar view
  --json            Print computed data as JSON instead of rendered output
  --all             Show full leaderboard instead of top 20
  -h, --help        Show this help`;
}

export function parseArgs(args: string[]): Options {
  const options: Options = {
    dirPath: `${homedir()}/.pi/agent/sessions`,
    weeks: 52,
    json: false,
    command: "dashboard",
    rankPeriod: null,
    rankAll: false,
    username: null,
    month: null,
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

    if (argument === "--all") {
      options.rankAll = true;
      continue;
    }

    if (argument === "today" || argument === "--today") {
      options.command = "today";
      continue;
    }

    if (argument === "models" || argument === "--models") {
      options.command = "models";
      continue;
    }

    if (argument === "projects" || argument === "--projects") {
      options.command = "projects";
      continue;
    }

    if (argument === "cost" || argument === "--cost") {
      options.command = "cost";
      continue;
    }

    if (argument === "peak" || argument === "--peak") {
      options.command = "peak";
      continue;
    }

    if (argument === "month") {
      options.command = "month";
      const next = args[index + 1];
      if (next && /^\d{4}-\d{1,2}$/.test(next)) {
        options.month = next;
        index += 1;
      }
      continue;
    }

    if (argument === "rank" || argument === "--rank") {
      options.command = "rank";
      const next = args[index + 1];
      if (next && ["day", "week", "month", "alltime"].includes(next)) {
        options.rankPeriod = next;
        index += 1;
      }
      continue;
    }

    if (argument.startsWith("@")) {
      options.command = "user";
      options.username = argument.slice(1).toLowerCase();
      continue;
    }

    if (argument === "sync") {
      options.command = "sync";
      continue;
    }

    if (argument === "--month") {
      const next = args[index + 1];
      if (next && /^\d{4}-\d{1,2}$/.test(next)) {
        options.month = next;
        index += 1;
      } else {
        const now = new Date();
        options.month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      }
      continue;
    }

    if (argument === "--day" || argument === "--week" || argument === "--alltime") {
      options.command = "rank";
      options.rankPeriod = argument.replace("--", "");
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
