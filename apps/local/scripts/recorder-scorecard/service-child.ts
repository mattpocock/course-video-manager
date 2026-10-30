import { startRecorderService } from "../../recorder-service/recorder-service";
import { stopCleanlyOn } from "../../recorder-service/run-recorder-service";
import {
  startWindowsClock,
  type ClockTicker,
} from "../../recorder-service/windows-clock";
import type { Launcher } from "../../recorder-service/launcher";
import { STREAM_TAG } from "../../recorder-service/stream-args";
import { syntheticLauncher } from "./synthetic-launcher";
import { onlyToSink } from "./stream-sink";
import { guardWindows } from "../windows-guard";
import { useGuard } from "./windows";

/**
 * The real recorder service in a process of its own, as `service-process.ts`
 * runs it, on the scorecard's synthetic launcher, a free port and the run's
 * own state folder: so the scorecard can kill it mid-take and start it again.
 *
 *   node --import tsx service-child.ts <marker> <stateDir> [<streamIngest>]
 *
 * A Live Stream may push only to `streamIngest`, the scorecard's local sink
 * (`stream-sink.ts`); without one, no Live Stream starts. Its `-progress`
 * goes to the scorecard over IPC as `{type: "stream-progress", chunk}`.
 *
 * Exits 3 (the guard's refusal) while anything records.
 *
 * Prints `SCORECARD-SERVICE-PORT <port>` once it listens.
 */
const [marker, stateDir, streamIngest] = process.argv.slice(2);
if (!marker || !stateDir) {
  console.error("Usage: service-child.ts <marker> <stateDir>");
  process.exit(2);
}
// Exits 3 if anything records: not one Windows process starts then.
const windows = guardWindows();
useGuard(windows);

/** The Windows clock's PowerShell ticker, as `windows-clock.ts` runs it, through the guard. */
const idleTicker = (): ClockTicker => {
  const child = windows.powershell(
    "while ($true) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 20 }"
  );
  return {
    onData: (listener) =>
      void child.stdout?.on("data", (d: Buffer) => listener(d.toString())),
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
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const synthetic = syntheticLauncher({ marker });
const launch: Launcher = onlyToSink((l) => {
  const p = synthetic(l);
  if (l.tool === "ffmpeg" && l.args.includes(`comment=${STREAM_TAG}`))
    p.onStdout((chunk) => {
      if (process.connected)
        process.send?.({
          type: "stream-progress",
          chunk,
          windowsMs: windowsNow(),
        });
    });
  return p;
}, streamIngest);

const clock = await startWindowsClock({ spawnTicker: idleTicker });
/** The Windows clock now, or nothing while it is stale. */
function windowsNow() {
  try {
    return clock.now();
  } catch {
    return undefined;
  }
}
const service = await startRecorderService({
  port: 0,
  launch,
  streamIngest,
  now: clock.now,
  stateDir,
  wakeSpacedesk: () =>
    Promise.reject(new Error("The scorecard records Landscape only.")),
});
console.log(`SCORECARD-SERVICE-PORT ${service.port}`);
try {
  await stopCleanlyOn(service, process, (line) =>
    console.log(`scorecard service: ${line}`)
  );
} finally {
  clock.stop();
}
process.exit(0);
