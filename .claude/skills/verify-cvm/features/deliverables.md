# Deliverables Calendar

The home page: what ships, and which week it ships in.

## Sub-features

- **Week rows** — `WEEK 39 · THIS WEEK` and its neighbours, each holding the
  Deliverables due that week.
- **Buffer** — a `combobox` from `0 weeks` to `8 weeks`, shifting the horizon.
- **Earlier** — `N earlier — shipped & cancelled`, a collapsed section.
- **New Deliverable** — WRITES.

## How to get to it (user POV)

`/`, or the `Deliverables` entry in the sidebar rail.

## Driving it with agent-browser

```bash
# $BASE and $AB come from the skill's launch step — this run's port and session.
$AB open "$BASE/"
$AB wait --load networkidle
$AB select "select" "2 weeks"
$AB snapshot -i -c -d 3
```

`get title` reads `CVM - Deliverables Calendar`. This page is the best smoke
test in the app: it loads fast, names every sidebar destination with its href,
and proves the database connection in one request.

## Gotchas

- The Buffer combobox and the `earlier` disclosure are display state only —
  safe to drive, and they leave the Write Ledger clean.
- Deliverable links point at Courses, not at a Deliverable detail route.
