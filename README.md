# pi-streak

A Bun terminal contribution chart for the usage data recorded in [pi](https://pi.dev) agent session JSONL files. It renders a GitHub-style calendar with one square per day, colored by daily token activity.

## Install

```bash
npm install --global pi-streak
pi-streak
```

`pi-streak` requires [Bun](https://bun.sh/) and reads the session files at `~/.pi/agent/sessions/` by default.

With Bun's package manager:

```bash
bun add --global pi-streak
```

Run without installing:

```bash
bunx pi-streak
```

## Usage

```bash
pi-streak --weeks 26
pi-streak --dir /path/to/sessions
pi-streak --today           # show today's activity
pi-streak --models          # show model breakdown
pi-streak --projects        # show project breakdown
pi-streak --json
```

For local development from this checkout:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun link
pi-streak
```

## Metrics

| Display | Source |
| --- | --- |
| Daily square | Assistant-message token totals for one local calendar day |
| Color intensity | Relative token usage across days with activity |
| Visible token total | Sum of token activity in the displayed week range |
| Current streak | Consecutive calendar days with assistant activity ending today |
| Longest streak | Longest consecutive run of calendar days with assistant activity |

Use `--json` to access the extended totals, including task, peak-token, duration, cost, and token-category values.

The CLI opens the session files read-only and does not modify pi state.

## License

MIT
