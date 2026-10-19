import { createIdleStop } from "@/services/idle-stop";

/**
 * THE RECORDER SERVICE ON DEMAND (ADR 0053). The app server starts Matt's
 * recorder service when something needs it — a video editor (Shorts
 * included) or an AV Calibration page listening — and stops it once nothing
 * has for `RECORDER_IDLE_MINUTES`, so it holds no Windows processes the rest
 * of the time. An editor coming back within that time keeps it running.
 *
 * Raw footage first: it is never stopped while a take records, while a
 * stopped take is still closing its files, or while the app server is still
 * saving the recorder's events. It waits for those, then counts the whole
 * idle time again (`idle-stop.ts`, as Local Whisper's worker does). And the
 * stop itself closes any take's files first (ADR 0035, `stopCleanlyOn`).
 */

/** How long the recorder service stays up once nothing needs it. */
const RECORDER_IDLE_MINUTES = 10;
export const RECORDER_IDLE_MS = RECORDER_IDLE_MINUTES * 60_000;

export type RunningRecorderService = {
  /** Asks it to stop: any take is stopped and its files closed first. */
  stop: () => void;
  /** Settles once it has exited. */
  exited: Promise<void>;
};

/** Starts the service process: `service-process.server.ts`, or a test's. */
export type RecorderServiceLauncher = {
  /** Undefined: not started (something already answers on its port). */
  start: () => Promise<RunningRecorderService | undefined>;
  /** What the service says: recording, or a take still closing its files. */
  busy: () => Promise<boolean>;
};

export const createServiceOnDemand = (o: {
  launcher: RecorderServiceLauncher;
  idleMs: number;
  /** The app server's side: a take recording, events still being saved. */
  busy: () => boolean;
  /** `launched()` changed. */
  changed: () => void;
}) => {
  let needed = false;
  let running: RunningRecorderService | undefined;
  let launching = false;
  /** This stopped it, so a need while it stopped starts it again. */
  let stopping = false;

  const idle = createIdleStop({
    idleMs: o.idleMs,
    busyPollMs: Math.min(5_000, o.idleMs),
    busy: async () => o.busy() || (await o.launcher.busy()),
    onIdle: () => {
      if (!running || needed) return;
      console.log(
        `recorder service: nothing has needed it for ${o.idleMs / 60_000} minutes; stopping it.`
      );
      stopping = true;
      running.stop();
    },
  });

  const exited = () => {
    running = undefined;
    // A crash is not retried in a loop: the next editor to open starts it.
    const restart = stopping && needed;
    stopping = false;
    o.changed();
    if (restart) launch();
  };

  const started = (service: RunningRecorderService | undefined) => {
    launching = false;
    running = service;
    o.changed();
    if (!service) return;
    void service.exited.then(exited);
    if (!needed) idle.arm();
  };

  const launch = () => {
    if (running || launching) return;
    launching = true;
    o.changed();
    o.launcher.start().then(started, (error: unknown) => {
      console.error("recorder service: could not start it", error);
      started(undefined);
    });
  };

  return {
    /** Something needs the service: starts it, and holds off any stop. */
    need: () => {
      needed = true;
      idle.cancel();
      launch();
    },
    /** Nothing needs it now: the idle count starts. */
    release: () => {
      needed = false;
      if (running) idle.arm();
    },
    /** Whether this started it (or is starting it) and it has not exited. */
    launched: () => launching || running !== undefined,
    close: () => idle.cancel(),
  };
};
