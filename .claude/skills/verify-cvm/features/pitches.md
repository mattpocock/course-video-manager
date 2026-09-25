# Pitches

The backlog of video ideas, each with a priority and an effort rating, before
any of them becomes a Video.

## Sub-features

- **Filters** — priority `P1`/`P2`/`P3`, effort `Low`/`Med`/`High`, and
  `Show shipped`.
- **Inline priority and effort** — the per-row dropdowns. These WRITE.
- **New Pitch** — WRITES.
- **Pitch detail** (`/pitches/:pitchId`).

## How to get to it (user POV)

The `Pitches` entry in the sidebar rail.

## Driving it with agent-browser

```bash
# $BASE and $AB come from the skill's launch step — this run's port and session.
$AB open "$BASE/pitches"
$AB wait --load networkidle
$AB find role button click --name "P1"
$AB snapshot -i -c -d 3
```

What proves it works: the count in `heading "Pitches 38"` matches the rows the
active filters leave on screen, and pressing a filter changes both.

## Gotchas

- The heading count is the total, not the filtered count — read the rows to
  check a filter, rather than the heading.
- Row dropdowns (`button "P1" [expanded=false]`) share their accessible name
  with the filter buttons at the top. Scope with `-s` or use `find nth` so a
  click lands on the filter you meant, not on a Pitch's priority — which would
  be a write to a real row.
