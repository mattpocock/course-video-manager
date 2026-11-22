import { spawn } from "node:child_process";

/**
 * The Windows wall clock, readable from WSL at any moment. ffmpeg.exe stamps
 * every input with it (-use_wallclock_as_timestamps), so T0 must be read from
 * it too: WSL's own clock drifts from Windows' (the rig measured ~4% on this
 * machine), which would shift every file's time zero.
 *
 * A PowerShell loop prints UtcNow every 20 ms (spawning PowerShell per read
 * costs ~0.5 s); `now()` is the latest tick plus the few ms since it arrived.
 *
 * The loop can die after start-up. Its ticks then stop, and extending the
 * last one with WSL's clock would give a T0 that is wrong by however long it
 * has been dead, with no error. So `now()` throws once the last tick is older
 * than `staleAfterMs` (a throw inside `record` becomes a `refused` message),
 * and a loop that exits is respawned, so the clock comes back by itself.
 */

/** A running tick source: prints Unix milliseconds, one per line. */
export type ClockTicker = {
  onData: (listener: (chunk: string) => void) => void;
  /** Called once, when the source exits or fails to start. */
  onEnd: (listener: (reason: string) => void) => void;
  kill: () => void;
};

const spawnPowerShellTicker = (): ClockTicker => {
  const child = spawn(
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "while ($true) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 20 }",
    ],
    { cwd: "/mnt/c", stdio: ["ignore", "pipe", "ignore"] }
  );
  return {
    onData: (listener) =>
      void child.stdout.on("data", (d: Buffer) => listener(d.toString())),
    onEnd: (listener) => {
      let ended = false;
      const end = (reason: string) => {
        if (ended) return;
        ended = true;
        listener(reason);
      };
      child.once("error", (e) => end(`failed: ${e.message}`));
      child.once("exit", (code, signal) =>
        end(`exited with ${code ?? signal}`)
      );
    },
    kill: () => void child.kill(),
  };
};

export type WindowsClockOptions = {
  /** The tick source; PowerShell on Windows unless a test passes a fake. */
  spawnTicker?: () => ClockTicker;
  /** How old the last tick may be before `now()` refuses. */
  staleAfterMs?: number;
  /** How long to wait before respawning a tick source that ended. */
  respawnAfterMs?: number;
};

export const startWindowsClock = async (o: WindowsClockOptions = {}) => {
  const spawnTicker = o.spawnTicker ?? spawnPowerShellTicker;
  const staleAfterMs = o.staleAfterMs ?? 1000;
  const respawnAfterMs = o.respawnAfterMs ?? 1000;

  let lastWindowsMs = NaN;
  let lastAt = 0;
  let stopped = false;
  let ticker: ClockTicker | undefined;
  let respawnTimer: NodeJS.Timeout | undefined;
  /** Set until the first tick: start-up fails loudly instead of respawning. */
  let startUp: { resolve: () => void; reject: (e: Error) => void } | undefined;

  const run = () => {
    const t = spawnTicker();
    ticker = t;
    let buffer = "";
    t.onData((chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      const value = Number(lines.filter(Boolean).at(-1));
      if (Number.isFinite(value) && value > 0) {
        lastWindowsMs = value;
        lastAt = performance.now();
        startUp?.resolve();
        startUp = undefined;
      }
    });
    t.onEnd((reason) => {
      if (stopped) return;
      if (startUp) {
        startUp.reject(new Error(`the Windows clock (PowerShell) ${reason}`));
        startUp = undefined;
        return;
      }
      console.error(
        `recorder: the Windows clock (PowerShell) ${reason}; respawning it`
      );
      respawnTimer = setTimeout(run, respawnAfterMs);
    });
  };

  await new Promise<void>((resolve, reject) => {
    startUp = { resolve, reject };
    run();
  });

  return {
    now: () => {
      const age = performance.now() - lastAt;
      if (age > staleAfterMs) {
        throw new Error(
          `The Windows clock has not ticked for ${(age / 1000).toFixed(1)} s, so it cannot stamp this recording's time zero. It restarts by itself: try again in a moment, or restart \`pnpm dev\`.`
        );
      }
      return Math.round(lastWindowsMs + age);
    },
    stop: () => {
      stopped = true;
      clearTimeout(respawnTimer);
      ticker?.kill();
    },
  };
};
