---
status: accepted
---

# The recorder service starts and stops with `pnpm dev`

> Decisions 1 and 5 superseded by [ADR 0053](0053-the-recorder-service-starts-on-demand.md): the app server starts the service when an editor needs it, and it idles out.

Supersedes [ADR 0034](0034-recording-runs-in-its-own-recorder-service.md)'s decision 2 and its first consequence: how the recorder service is started and stopped. The rest of ADR 0034 stands: recording still runs in the recorder service, a process of its own that is neither the app server nor the **Sidecar**.

## Context

ADR 0034 started the recorder service detached: `pnpm dev` and `pnpm start` started it only when none was running (`ensure-recorder-service.ts`, `launch.mjs`), and nothing ever stopped it. That kept a take safe from app server reloads, but it meant a process that outlived the command that started it. It ran whatever code it started with until Matt killed it by hand (`kill <pid>`), and the app had to tell him to when it met a service running older code.

## Decision

Matt's decision: the detached lifecycle is bad design. The recorder service's lifecycle is tied to `pnpm dev`, like every other `dev:*` process.

1. **`dev:recorder-service` and `start:recorder-service` run the service in the foreground** (`apps/local/recorder-service/start-recorder-service.ts`). It starts when `pnpm dev` / `pnpm start` starts and stops when they stop. Only Matt's main checkout runs it, as before, so a worktree or a verify-cvm clone never takes its port.
2. **Plain `tsx`, not `tsx watch`.** A save would restart a watched service and end a take mid-sentence. A change to the service is picked up on the next `pnpm dev`. The app server still reloads on its own, and its recorder client reconnects and replays what it missed (ADR 0034).
3. **Stopping stops the take cleanly first.** On SIGINT or SIGTERM the service stops any take, so ffmpeg.exe gets its `q` and finishes its files, and only then exits (`stopCleanlyOn`, `run-recorder-service.ts`). Its handlers stay on until then, so a second Ctrl-C cannot kill it mid-finalise. Footage is never left half-written by a stop.
4. **The service runs in a process group of its own, as a child of the script.** turbo SIGKILLs a task's process group about 10 s after Ctrl-C, and closing a take's files can take longer. So the script passes a stop on as SIGTERM and waits, and the service is out of reach of that SIGKILL. If the script is killed anyway, the service sees its IPC channel to the script close and stops cleanly all the same. It never outlives `pnpm dev` by more than closing its files; its last lines go to `.data/logs/recorder-service.log` as well as the terminal.
5. **A service left over from ADR 0034.** If a recorder service already answers on the port when `pnpm dev` starts, the script says so. One that is not recording is stopped with SIGTERM (which closes its files first) and replaced. One that is recording is never stopped: the script refuses with a loud message, leaves it and its take alone, and says how to replace it once the take is done. Every refusal exits 0, because pnpm stops every `dev:*` process when one fails.

## Consequences

- No more killing the service by hand to pick up a change: restart `pnpm dev`. Restarting `pnpm dev` mid-take stops that take, cleanly.
- The app keeps its protocol version check, because the app server reloads and the service does not: after a pull mid-session it says to restart `pnpm dev`. Its fallback for a service from before Shorts, which sent no format, is gone.
- The graceful stop is tested at the recorder service's seam with the scripted ffmpeg.exe (`recorder-service-shutdown.test.ts`); no test opens a real device.
