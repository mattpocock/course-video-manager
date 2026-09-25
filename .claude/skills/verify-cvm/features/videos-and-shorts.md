# Videos and Shorts

Two lists over the same table, split by Video Format. `/videos` shows Landscape
Standalone Videos; `/shorts` shows Shorts.

## Sub-features

- **Shorts list** — every Short with its duration and per-platform posting state
  (`Recorded`, `YouTube`, `TikTok`, `Posted`).
- **Record** (Shorts) — starts an OBS recording. Needs hardware; WRITES.
- **New Video** / **Concatenate** (Videos) — both WRITE.

## How to get to it (user POV)

The `Shorts` and `Videos` entries in the sidebar rail.

## Driving it with agent-browser

```bash
AB="agent-browser --session verify-cvm"
$AB open http://localhost:5199/shorts
$AB wait --load networkidle
$AB snapshot -i -c -d 3
```

`get title` reads `CVM - Shorts` and `CVM - Videos`. This is the cheapest place
to get a real `videoId` for another drive:

```bash
$AB snapshot -i -u -d 2 | grep -oE 'videos/[0-9a-f-]{36}' | head -1
```

What proves it works: each row's accessible name carries the Short's title,
duration and posting state together.

## Gotchas

- `/videos` is legitimately empty today — it reads `No standalone videos`, and
  that is the correct render, not a load failure. Verify list behaviour on
  `/shorts`, which has rows.
- `Record` drives OBS on Matt's machine. Do not press it.
