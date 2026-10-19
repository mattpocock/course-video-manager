---
status: accepted
supersedes: 0035-the-recorder-service-starts-and-stops-with-pnpm-dev (decisions 1 and 5 only)
---

# The recorder service starts on demand and idles out

Decided by Matt on 2026-10-19: "Make the recorder service only start when I actually go to the video editor, then hold for ten minutes and drop again. I think we do similar with the local whisper."

## Context

Under ADR 0035, `pnpm dev` and `pnpm start` ran the recorder service for as long as they ran. It held Windows processes (ffmpeg.exe checks, the Windows clock) all day, and the Windows guard refused every harness while it ran, even with no editor open.

## Decision

1. **`pnpm dev` / `pnpm start` no longer start it.** The app server starts it, as its own child, when something needs it: a video editor (Shorts included) or an AV Calibration page listening (`service-on-demand.ts`, `service-process.server.ts`). The editor shows "Starting the recorder…" meanwhile (`starting` on `recorder-status`).
2. **It stops `RECORDER_IDLE_MINUTES` (10) after the last listener goes**: its server-sent stream closed (window closed, navigated away). One coming back within that time cancels the stop. The idle count is the one Local Whisper's worker uses (`app/services/idle-stop.ts`).
3. **Raw footage first.** The count never ends while a take records, while a stopped take is still closing its files (`takesClosing` on `/health`), or while the app server is still saving the recorder's events. It waits for those, then counts the whole idle time again. The stop itself is ADR 0035's clean stop (SIGTERM, `stopCleanlyOn`).
4. **Only Matt's own app server starts it**: its main checkout, and only when its recorder client gets the real service address. An agent's or verify-cvm server never does (#2292), nor a worktree's.
5. ADR 0035's handling of a service left over from ADR 0034 is gone: if something already answers on the port, the app server starts nothing and uses it.

ADR 0035's other decisions stand: plain `tsx`, a process group of its own, and a clean stop when its parent (now the app server) goes.

## Consequences

- The Windows guard passes once the service has idled out; `pnpm dev` itself never makes it refuse.
- A Stream Deck Record does nothing while no editor is open, since the service is not running; it never did record without an open recorder.
- A crashed service is not restarted in a loop: the next editor to open starts it again.
