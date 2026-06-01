# pi-streak --today layout (inspired by image)

## Key elements from the image

1. **Title + subtitle** — clean, scannable
2. **Big total** — top-right corner, prominent
3. **Bar chart** — main visual, easy to read
4. **X-axis labels** — dates, minimal
5. **Y-axis scale** — reference lines

---

## Proposed terminal layout

```
  Today's Usage
  Token consumption by model and hour

  TOTAL TOKENS                         8.66M
  INPUT                                7.80M
  OUTPUT                              857.3K
  CACHE                              171.6M
  COST                                $73.95

  Hourly activity
  ──────────────────────────────────────────────────────────────────────
  10  ▏                                        852.7K
  11  ████████████████                         27.34M
  12  ███████████████████████                  37.92M
  13  ████████████████████████████             48.09M
  14  ████████████████                         32.81M
  15  █████                                     7.87M
  16  ████████████                             18.95M
  17  ████                                      4.88M
  18  ▏                                         229.5K
  20  ▏                                         1.00M

  Model breakdown
  ──────────────────────────────────────────────────────────────────────
  kimi-k2p6-turbo   ████████████████████████████████████████  2.28B
  deepseek-v4-pro   ████                                      228.6M
  kimi-k2.6         ██                                        96.2M
  mimo-v2-omni      ▎                                         11.9M
  gpt-5.5           ▏                                         6.71M

  Project breakdown
  ──────────────────────────────────────────────────────────────────────
  hermium           ████████████████████████████████          670.4M
  writepro          ████████████████████████                  444.0M
  hermium-new       ████████████                             198.0M
  ...
```

---

## Compact version (≤80 cols)

```
  Today's Usage
  ─────────────────────────────────────
  Tokens  8.66M    Input  7.80M   Output  857.3K
  Cost    $73.95   Cache  171.6M

  Hourly
  ─────────────────────────────────────
  11  ████████████████         27.3M
  12  ███████████████████████  37.9M
  13  █████████████████████████ 48.1M
  14  ████████████████         32.8M
  16  ████████████             18.9M

  Models
  ─────────────────────────────────────
  kimi-k2p6-turbo  ████████████ 2.28B
  deepseek-v4-pro  █            228.6M
  kimi-k2.6        ▎            96.2M

  Projects
  ─────────────────────────────────────
  hermium     ████████████████  670.4M
  writepro    ██████████        444.0M
  hermium-new ██████           198.0M
```

---

## Design decisions

| Image element | Terminal equivalent |
|---------------|---------------------|
| Title + subtitle | `Today's Usage` + `Token consumption...` |
| Big total (1.54B) | Horizontal KPI row, total left-aligned |
| Bar chart | Unicode bars with aligned labels |
| X-axis dates | Hour labels (00-23) on left |
| Y-axis grid | Implicit via bar lengths |
| "By model" | Separate section below hourly |
