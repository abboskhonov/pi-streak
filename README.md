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
pi-streak today              # today's activity
pi-streak --json

pi-streak rank               # global leaderboard (all-time, top 20)
pi-streak rank day           # daily leaderboard
pi-streak rank week          # weekly leaderboard
pi-streak rank month         # monthly leaderboard
pi-streak rank alltime --all # full all-time leaderboard

pi-streak @username          # synced user dashboard
pi-streak sync               # sync all local daily stats to leaderboard
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
