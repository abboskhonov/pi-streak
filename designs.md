# Month View TUI Design Options

## Option A: Classic Calendar Grid

```
  June 2026
  ┌────┬────┬────┬────┬────┬────┬────┐
  │ Su │ Mo │ Tu │ We │ Th │ Fr │ Sa │
  ├────┼────┼────┼────┼────┼────┼────┤
  │    │ 01 │ 02 │ 03 │ 04 │ 05 │ 06 │
  ├────┼────┼────┼────┼────┼────┼────┤
  │ 07 │ 08 │ 09 │ 10 │ 11 │ 12 │ 13 │
  ├────┼────┼────┼────┼────┼────┼────┤
  │ 14 │ 15 │ 16 │ 17 │ 18 │ 19 │ 20 │
  ├────┼────┼────┼────┼────┼────┼────┤
  │ 21 │ 22 │ 23 │ 24 │ 25 │ 26 │ 27 │
  ├────┼────┼────┼────┼────┼────┼────┤
  │ 28 │ 29 │ 30 │    │    │    │    │
  └────┴────┴────┴────┴────┴────┴────┘

  Active: Jun 1-3  │  371M tokens  │  3 days
```

**Pros:** Everyone knows calendar grids. Days are obvious.
**Cons:** Hard to color the background of a 2-digit number in terminal.

---

## Option B: GitHub Style WITH Day Numbers

```
  June 2026
         01 02 03 04 05
  Mon  ░ ░  ░  ░  ░  ░
  Tue  ░ ░  ░  ░  ░  ░
  Wed  ░ ░  ░  ░  ░  ░
  Thu  ░ ░  ░  ░  ░  ░
  Fri  ░ ░  ░  ░  ░  ░
  Sat  ░ ░  ░  ░  ░  ░
  Sun  ░ ░  ░  ░  ░  ░
       Less ░░██░ More

  Active: Jun 01, 02, 03
  371M tokens  │  3 active days
```

**Pros:** Familiar GitHub style, but each column has a day-number header.
**Cons:** Hard to read which column is which date. 31 columns max.

---

## Option C: Horizontal Bar Per Day

```
  June 2026
  ┌────────────────────────────────┐
  │ 01 Mon ████████████ 249.4M    │
  │ 02 Tue ████          73.2M    │
  │ 03 Wed ███            48.9M    │
  │ 04 Thu                          │
  │ 05 Fri                          │
  │ 06 Sat                          │
  │ 07 Sun                          │
  │ 08 Mon                          │
  │ 09 Tue                          │
  │ 10 Wed                          │
  │ 11 Thu                          │
  │ 12 Fri                          │
  │ 13 Sat                          │
  │ 14 Sun                          │
  │ 15 Mon                          │
  │ ...                             │
  └────────────────────────────────┘

  Total: 371M tokens  │  3 active days
```

**Pros:** Crystal clear. Exact values. Easy to scan.
**Cons:** Very tall for a 31-day month. Scroll city.

---

## Option D: Weekly Summary (Compact)

```
  June 2026
  Week of 01  ████████████ 249.4M
  Week of 08  ░░░░░░░░░░░░     0
  Week of 15  ░░░░░░░░░░░░     0
  Week of 22  ░░░░░░░░░░░░     0
  Week of 29  ░░░░░░░░░░░░     0

  Total: 371M tokens  │  3 active days
```

**Pros:** Compact. 5 lines max.
**Cons:** No daily granularity. You lose per-day insight.

---

## Option E: Mini Calendar + Top Days

```
  June 2026
  ┌──────────────────────────────┐
  │ Mo Tu We Th Fr Sa Su         │
  │          01 02 03 04 05      │
  │ 06 07 08 09 10 11 12         │
  │ 13 14 15 16 17 18 19         │
  │ 20 21 22 23 24 25 26         │
  │ 27 28 29 30                  │
  └──────────────────────────────┘

  Active days:
    01 Mon  ████████████  249.41M
    02 Tue  ████           73.21M
    03 Wed  ███            48.96M

  Total: 371M tokens  │  3 active days
```

**Pros:** Best of both worlds. Calendar for context, bars for details.
**Cons:** Two sections. More vertical space.

---

## Option F: Single-Column Daily List

```
  June 2026
  01 Mon ████████████ 249.41M
  02 Tue ████          73.21M
  03 Wed ███           48.96M
  04 Thu ░              0
  05 Fri ░              0
  06 Sat ░              0
  07 Sun ░              0
  ... (show only first 7, then summary)

  Total: 371M tokens  │  3 active days
```

**Pros:** Simple. Direct. Like `pi-streak today`.
**Cons:** For 31 days, you need to scroll. But we can show only active days.

---

## Option G: Active Days Only

```
  June 2026
  01 Mon ████████████ 249.41M
  02 Tue ████          73.21M
  03 Wed ███           48.96M

  Total: 371M tokens  │  3 active days
```

**Pros:** Minimal. Only shows what matters.
**Cons:** No visual of inactive days. No streak context.
