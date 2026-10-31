import fs from "node:fs";
import path from "node:path";
import { wakeSpacedesk } from "../app/spacedesk-wake";
import { IDLE_STOP, RECORDER_SERVICE_PORT } from "./protocol";
import { LIVE_STREAM_SETTINGS } from "./go-live";
import { startRecorderService } from "./recorder-service";
import { startWindowsClock } from "./windows-clock";
import { windowsLauncher } from "./windows-launcher";

/**
 * The recorder service's process (`service-process.ts`), started by the
 * app server on demand (`service-process.server.ts`, ADR 0053), and stopped
 * when it idles out or the app server stops (ADR 0035).
 */

/** `.data/` at the repository root: gitignored, beside the app's own logs. */
const DATA_DIR = path.resolve(import.meta.dirname, "../../../.data");
const STATE_DIR = path.join(DATA_DIR, "recorder-service");
/**
 * Its own lines also go here: a take can still be closing its files after
 * `pnpm dev` (and the terminal's copy of its output) has gone.
 */
export const RECORDER_SERVICE_LOG = path.join(
  DATA_DIR,
  "logs/recorder-service.log"
);

const log = (message: string) => {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(RECORDER_SERVICE_LOG), { recursive: true });
    fs.appendFileSync(RECORDER_SERVICE_LOG, line);
  } catch {
    // A log line is never worth a take.
  }
};

/**
 * Whether it is filming, for `scripts/is-filming.sh`: "takes: recording"
 * from a take's Record (or Go Live) until every take has closed its files,
 * then "takes: none". Logged once straight after "listening", and on each
 * change.
 */
export const takesLine = (busy: boolean) =>
  `takes: ${busy ? "recording" : "none"}`;

/** Why the service is stopping: a signal, or the app server gone from under it. */
export const STOP_EVENTS = ["SIGINT", "SIGTERM", "disconnect"] as const;

/**
 * Waits for the first of `STOP_EVENTS`, then stops the service cleanly: any
 * take is stopped (ffmpeg.exe gets its `q` and finishes its files) before the
 * sockets close. Resolves once that is done, with what stopped it.
 *
 * The handlers stay on until then, so a second Ctrl-C (or a SIGTERM after a
 * SIGINT) is only logged: with no handler left it would kill the process
 * mid-finalise, and with it the only thing that can send ffmpeg.exe its `q`.
 *
 * The app server's idle stop (`IDLE_STOP`, a `message` on its IPC channel)
 * is only a request: while `service.busy()` (recording, or a take still
 * closing its files) it is refused and the service runs on, so no idle
 * count can ever cut a take short (#2383). The app server asks again later.
 */
export const stopCleanlyOn = (
  service: { close: () => Promise<void>; busy: () => boolean },
  events: Pick<NodeJS.EventEmitter, "on" | "off">,
  logLine: (message: string) => void = log
) =>
  new Promise<string>((resolve, reject) => {
    let stopping = false;
    const onStop = (event: string) => () => {
      if (stopping) {
        logLine(`${event}: already stopping, still closing the files`);
        return;
      }
      stopping = true;
      logLine(`${event}: stopping (any take is stopped and its files closed)`);
      service.close().then(
        () => {
          for (const [e, h] of handlers) events.off(e, h);
          logLine("stopped cleanly");
          resolve(event);
        },
        (error: unknown) => {
          for (const [e, h] of handlers) events.off(e, h);
          reject(error);
        }
      );
    };
    const idleStop = onStop(IDLE_STOP.type);
    const onMessage = (message: unknown) => {
      if ((message as { type?: unknown } | null)?.type !== IDLE_STOP.type)
        return;
      if (service.busy()) {
        logLine(`${IDLE_STOP.type}: refused, a take is recording or closing`);
        return;
      }
      idleStop();
    };
    const handlers: (readonly [string, (message: unknown) => void])[] = [
      ...STOP_EVENTS.map((e) => [e, onStop(e)] as const),
      ["message", onMessage],
    ];
    for (const [e, h] of handlers) events.on(e, h);
  });

export const runRecorderService = async () => {
  // Once `pnpm dev` has gone, nothing reads this process's stdout: a write
  // fails with EPIPE, which unhandled would kill it mid-take.
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});

  const clock = await startWindowsClock();
  // Only once "listening" is logged: is-filming reads the run after it.
  let listening = false;
  const service = await startRecorderService({
    onBusyChanged: (busy) => {
      if (listening) log(takesLine(busy));
    },
    port: RECORDER_SERVICE_PORT,
    launch: windowsLauncher,
    now: clock.now,
    stateDir: STATE_DIR,
    wakeSpacedesk: () => wakeSpacedesk(),
    ...LIVE_STREAM_SETTINGS,
  });
  log(
    `recorder service listening on ws://127.0.0.1:${service.port} (pid ${process.pid})`
  );
  listening = true;
  log(takesLine(service.busy()));
  try {
    await stopCleanlyOn(service, process);
  } finally {
    clock.stop();
  }
};
