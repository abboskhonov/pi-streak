# pi-streak

A Bun terminal contribution chart for the usage data recorded in [pi](https://pi.dev) agent session JSONL files. It renders a GitHub-style calendar with one square per day, colored by daily token activity.

Now with a global leaderboard — sync your stats and compete.

## Install

```bash
npx pi-streak
```

`pi-streak` requires [Bun](https://bun.sh/) and reads the session files at `~/.pi/agent/sessions/` by default.

## Usage

```bash
pi-streak                    # personal dashboard
pi-streak --weeks 26
pi-streak today              # today's activity
pi-streak rank               # global leaderboard (all-time, top 20)
pi-streak rank day           # daily leaderboard
pi-streak rank week          # weekly leaderboard
pi-streak rank month         # monthly leaderboard
pi-streak rank alltime --all # full all-time leaderboard

pi-streak models             # model usage breakdown (tokens, sessions, cost)
pi-streak projects           # project usage breakdown (tokens, sessions, cost)
pi-streak cost               # 30-day cost breakdown
pi-streak peak               # your most expensive day with top models/projects
pi-streak month              # current month calendar view
pi-streak month 2026-05      # specific month calendar view

pi-streak @username          # synced user dashboard
pi-streak sync               # sync all local daily stats to leaderboard
```

## License

MIT
