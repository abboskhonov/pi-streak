# pi-streak

A Bun terminal contribution chart for the usage data recorded in [pi](https://pi.dev) agent session JSONL files. It renders a GitHub-style calendar with one square per day, colored by daily token activity.

Now with a global leaderboard — sync your stats and compete.

## Install

```bash
npm install --global pi-streak
pi-streak
```

`pi-streak` requires [Bun](https://bun.sh/) and reads the session files at `~/.pi/agent/sessions/` by default.

## Usage

```bash
pi-streak                    # personal dashboard
pi-streak --weeks 26
pi-streak --today            # today's activity
pi-streak --models           # model breakdown
pi-streak --projects         # project breakdown
pi-streak --json

pi-streak leaderboard        # global leaderboard (all-time)
pi-streak leaderboard --week # weekly leaderboard
pi-streak leaderboard --day  # daily leaderboard
pi-streak leaderboard --month

pi-streak sync             # sync today's stats to leaderboard
```

## API

Cloudflare Workers + D1. Deploy:

```bash
wrangler d1 create pi-streak
# copy database_id into wrangler.jsonc
wrangler d1 migrations apply pi-streak
wrangler deploy
```

## License

MIT
