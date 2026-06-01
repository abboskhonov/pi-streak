import { homedir } from "node:os";
import type { Options } from "./lib/types";

export function usage(): string {
  return `Usage: pi-streak [command] [options]

Commands:
  today       Show today's activity breakdown
  rank        Show leaderboard (default: all-time)
              Use --day, --week, --month for periods
  sync        Sync all stats to the leaderboard

Options:
  --dir <path>      Session directory path (default: ~/.pi/agent/sessions)
  --weeks <number>  Heatmap width in weeks, from 4 to 104 (default: 52)
  --json            Print computed data as JSON instead of the dashboard
  -h, --help        Show this help`;
}

export function parseArgs(args: string[]): Options {
  const options: Options = {
    dirPath: `${homedir()}/.pi/agent/sessions`,
    weeks: 52,
    json: false,
    command: "dashboard",
    rankPeriod: null,
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

    if (argument === "today") {
      options.command = "today";
      continue;
    }

    if (argument === "rank") {
      options.command = "rank";
      continue;
    }

    if (argument === "sync") {
      options.command = "sync";
      continue;
    }

    if (argument === "--day" || argument === "--week" || argument === "--month" || argument === "--alltime") {
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
