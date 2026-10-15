import {
  CAPTURE_TAG,
  cameraCaptureArgs,
  cameraPreviewArgs,
  PREVIEW_TAGS,
  type CameraRelays,
} from "./capture-args";
import {
  lineSplitter,
  runToEnd,
  type LaunchedProcess,
  type Launcher,
} from "./launcher";
import type { PreviewFeeds } from "./preview-feeds";
import type { PreviewEncoders } from "./preview-encoders";
import type { CameraStatus } from "./protocol";
import { watchPreview } from "./preview-watchdog";

/**
 * OPENING THE CAM LINK (#1993 Q11, Q12; #2207). The service opens the Cam
 * Link and the mic the moment the recorder opens for a Video, in the camera
 * capture (`cameraCaptureArgs`), and keeps them open until it closes: a take
 * only starts and stops a writer on the capture's relay, so Record and Stop
 * never reopen a device or touch the preview. The camera preview
 * (`cameraPreviewArgs`) is a process of its own on the capture's preview
 * relay; it is live only once a real frame reaches the camera preview feed.
 *
 * The Cam Link's real trouble is start-up: sometimes it opens and sends
 * nothing. No frame within the start timeout, or either process quitting, is
 * a failed try; after three the service asks for a replug and waits for
 * Retry. A device another program holds (OBS) is reported at once as busy:
 * retrying cannot help until OBS lets go, and the service never closes OBS
 * itself.
 *
 * Once live, a preview that stalls or quits is started again on its own,
 * without the capture: a take keeps writing through it. The capture
 * stalling (no preview frames) while no take runs, or quitting, opens both
 * again from the first try.
 */

export const CAMERA_ATTEMPTS = 3;

export const CAM_LINK_NOT_STARTING =
  "Cam Link not starting: unplug and replug it, then press Retry.";

export const CAM_LINK_BUSY =
  "Close OBS first: another program has the Cam Link. Then press Retry.";

/** How long one try waits for the first frame (a 4K DirectShow open takes a few seconds). */
export const CAMERA_START_TIMEOUT_MS = 10_000;

/** What ffmpeg's dshow input says when another program holds the device. */
const BUSY = /Could not run graph|in use|busy/i;

/** Whether ffmpeg's stderr says another program (OBS) holds the device. */
export const saysDeviceBusy = (stderr: string) => BUSY.test(stderr);

/** How long a preview process gets to quit on `q` before it is killed. */
const QUIT_TIMEOUT_MS = 5_000;

/**
 * Stops every ffmpeg.exe on Windows whose command line carries one of these
 * tags (`stop-recorders.ps1`). Every tag the service puts on a process starts
 * `cvm-recorder-`, and the script refuses any other, so nothing CVM did not
 * start is ever touched.
 */
export const stopTagged = async (launch: Launcher, tags: string[]) => {
  const stopped = await runToEnd(
    launch({
      tool: "powershell",
      script: "stop-recorders.ps1",
      args: ["-Tags", tags.join(",")],
    })
  );
  if (stopped.code !== 0)
    console.error(`recorder: stop-recorders.ps1 failed: ${stopped.stderr}`);
};

/**
 * Tunes a just-started ffmpeg.exe (found by `tag` and `match` in its command
 * line) as OBS runs its own capture: out of Windows 11's power throttling, a
 * 1 ms timer and High priority (`timer-resolution.ps1`). The camera capture,
 * a take's writer and the screen recorder all get it: at Normal, throttled
 * and on the 15.6 ms tick, other work on the PC starved the capture mid-take
 * (#2214, the capture stalls of 2026-10-15).
 *
 * One left untuned still records, so the outcome is only reported, as one
 * line naming the process: in the service's log, and the take's
 * `ffmpeg-capture.log` (`recording-session.ts`), so a drop can be checked
 * against it.
 */
export const tuneProcess = (
  launch: Launcher,
  o: { name: string; tag: string; match: string }
): Promise<string> =>
  runToEnd(
    launch({
      tool: "powershell",
      script: "timer-resolution.ps1",
      args: ["-Tag", o.tag, "-Match", o.match],
    })
  ).then(({ code, stderr, stdout }) => {
    const first = (text: string) => text.trim().split(/\r?\n/)[0] ?? "";
    if (code === 0) {
      const line = `${o.name} tuned: ${first(stdout)}`;
      console.log(`recorder: ${line}`);
      return line;
    }
    const line = `${o.name} NOT tuned (Normal priority, 15.6 ms timer): ${first(stderr || stdout)}`;
    console.error(`recorder: ${line}`);
    return line;
  });

/**
 * Asks ffmpeg.exe to quit with `q`, killing it only if it does not. ffmpeg
 * reads `q` only once every input is open, so a Cam Link stuck opening never
 * hears it. Killing the WSL side can leave ffmpeg.exe holding the device on
 * Windows, so a kill also stops the Windows process by its tag.
 */
export const quitProcess = (
  p: LaunchedProcess,
  o: { launch: Launcher; tag: string; timeoutMs?: number }
) => {
  p.writeStdin("q");
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    p.kill();
  }, o.timeoutMs ?? QUIT_TIMEOUT_MS);
  return p.exited.then(async () => {
    clearTimeout(timer);
    if (killed) await stopTagged(o.launch, [o.tag]);
  });
};

export type CameraOptions = {
  launch: Launcher;
  feeds: PreviewFeeds;
  /** What encodes the camera preview; a preview whose NVENC would not open is made again on libx264. */
  encoders: PreviewEncoders;
  /**
   * The Cam Link's and the mic's DirectShow names, looked up afresh on each
   * try (a replug may change them); either undefined when it is missing.
   */
  findDevices: () => Promise<{ camera?: string; mic?: string }>;
  onStatus: (status: CameraStatus) => void;
  startTimeoutMs: number;
  /** No frame for this long while live and the preview is started again (`preview-watchdog.ts`). */
  previewStallMs?: number;
  /** Whether a take is being written: a stalled preview then never stops the capture. */
  recording: () => boolean;
  /** The relay ports for a try (tests); random loopback ports otherwise. */
  pickRelays?: () => CameraRelays;
};

/** The live capture, as a take sees it. */
export type Capture = {
  /** The DirectShow names it opened. */
  devices: { camera: string; mic: string };
  /** The port its writer relay goes to: the take's writer listens there. */
  writerRelay: number;
  /** Calls `listener` with each line it prints, until unsubscribed. */
  onLine: (listener: (line: string) => void) => () => void;
  /** Its last error lines, once it has quit; undefined while it runs. */
  quitWith: () => string[] | undefined;
  /** How it was tuned (`tuneProcess`): one line, once known. */
  tuned: Promise<string>;
};

export type Camera = {
  status: () => CameraStatus;
  /** Starts over from the first try; only after `not-starting` or `busy`. */
  retry: () => boolean;
  /** The capture, while live. */
  capture: () => Capture | undefined;
  /** Lets the Cam Link and the mic go: quits the capture and its preview. */
  release: () => Promise<void>;
};

/**
 * Two loopback ports for a try's relays, from a range Windows does not hand
 * out on its own (its dynamic ports start at 49152). A port taken anyway
 * fails that try's listener, and the next try picks again.
 */
export const pickRelays = (): CameraRelays => {
  const base = 23_000 + 2 * Math.floor(Math.random() * 3_000);
  return { preview: base, writer: base + 1 };
};

/** The last few error lines a process printed. */
export const errorLines = (log: string) =>
  log
    .split(/\r?\n/)
    .filter((l) => /\[(error|fatal)\]/.test(l))
    .slice(-6);

/** Lines of the capture's stderr logged per minute, at most. */
const CAPTURE_LINES_PER_MINUTE = 20;

/**
 * What of the capture's stderr goes in the service's log: warnings and
 * errors, never the relay's timestamp notes. It logs at info, for a take's
 * own log (mic stalls), so this is narrower than a preview's.
 */
const worthLogging = (line: string) =>
  /\[(warning|error|fatal)\]/.test(line) &&
  !/Non-monotonic DTS|changing to \d|Queue input is backward/.test(line);

/** How long a preview that quit waits before it is started again. */
const PREVIEW_RESTART_DELAY_MS = 1_000;

export const openCamera = (o: CameraOptions): Camera => {
  let status: CameraStatus = { kind: "opening", attempt: 1 };
  /** The try under way or live: its processes. */
  let current:
    | {
        capture: LaunchedProcess;
        preview: LaunchedProcess;
        relays: CameraRelays;
        devices: { camera: string; mic: string };
        captureLog: string;
        lines: Set<(line: string) => void>;
        exited: boolean;
        tuned: Promise<string>;
      }
    | undefined;
  let released = false;
  /** How many times the preview was started again, or the capture opened again. */
  let restarts = 0;
  const quitPreview = (p: LaunchedProcess) =>
    quitProcess(p, { launch: o.launch, tag: PREVIEW_TAGS.camera });
  const quitCapture = (p: LaunchedProcess) =>
    quitProcess(p, { launch: o.launch, tag: CAPTURE_TAG });

  const set = (next: CameraStatus) => {
    if (released) return;
    status = next;
    o.onStatus(status);
  };

  const launchPreview = (relayPort: number) => {
    const p = o.launch({
      tool: "ffmpeg",
      args: cameraPreviewArgs({
        relayPort,
        port: o.feeds.port("camera"),
        stillPort: o.feeds.port("still"),
        encoder: o.encoders.get("camera"),
      }),
      cwd: "/mnt/c",
    });
    let stderr = "";
    p.onStderr((chunk) => (stderr = (stderr + chunk).slice(-8192)));
    return { p, stderr: () => stderr };
  };

  const firstFrame = (ps: LaunchedProcess[]) =>
    new Promise<"frame" | "exited" | "timeout">((resolve) => {
      const done = (outcome: "frame" | "exited" | "timeout") => {
        unsubscribe();
        clearTimeout(timer);
        resolve(outcome);
      };
      const unsubscribe = o.feeds.onFrame("camera", () => done("frame"));
      const timer = setTimeout(() => done("timeout"), o.startTimeoutMs);
      for (const p of ps) void p.exited.then(() => done("exited"));
    });

  /** Watches a live preview: stalled or quit, it is started again on the same relay. */
  const keepPreview = (
    live: NonNullable<typeof current>,
    stderr: () => string
  ) => {
    const p = live.preview;
    let stalled = false;
    watchPreview({
      name: "camera preview",
      process: p,
      onFrame: (listener) => o.feeds.onFrame("camera", listener),
      stallMs: o.previewStallMs,
      onStall: () => {
        if (released || current !== live || live.preview !== p) return;
        restarts += 1;
        // No frames and no take: the Cam Link itself may have stopped, so
        // both open again. A take's capture is never stopped for the preview.
        if (!o.recording()) {
          console.error(
            `recorder: the camera preview stalled; opening the Cam Link again (restart ${restarts})`
          );
          void quitCapture(live.capture);
          return;
        }
        stalled = true;
        console.error(
          `recorder: the camera preview stalled during a take; starting the preview again, the take carries on (restart ${restarts})`
        );
        void quitPreview(p);
      },
    });
    void p.exited.then((code) => {
      if (released || current !== live || live.preview !== p || live.exited)
        return;
      const nvencFailed = o.encoders.quit("camera", stderr());
      if (!stalled)
        console.error(
          `recorder: the camera preview quit (exit ${code}); starting it again${o.recording() ? ", the take carries on" : ""}`
        );
      setTimeout(
        () => {
          if (released || current !== live || live.exited) return;
          const next = launchPreview(live.relays.preview);
          live.preview = next.p;
          keepPreview(live, next.stderr);
        },
        nvencFailed ? 0 : PREVIEW_RESTART_DELAY_MS
      );
    });
  };

  const attempt = async (n: number): Promise<void> => {
    set({ kind: "opening", attempt: n });
    const found = await o.findDevices();
    if (released) return;
    let captureLog = "";
    let previewLog = "";
    if (found.camera && found.mic) {
      const relays = (o.pickRelays ?? pickRelays)();
      // The preview listens first: the capture's relay connects to it.
      const preview = launchPreview(relays.preview);
      const capture = o.launch({
        tool: "ffmpeg",
        args: cameraCaptureArgs({
          camera: found.camera,
          mic: found.mic,
          relays,
        }),
        cwd: "/mnt/c",
      });
      const tuned = tuneProcess(o.launch, {
        name: "camera capture",
        tag: CAPTURE_TAG,
        match: CAPTURE_TAG,
      });
      const live: NonNullable<typeof current> = {
        capture,
        preview: preview.p,
        relays,
        devices: { camera: found.camera, mic: found.mic },
        captureLog: "",
        lines: new Set(),
        exited: false,
        tuned,
      };
      current = live;
      let logged = 0;
      let windowStart = Date.now();
      capture.onStderr((chunk) => {
        live.captureLog = (live.captureLog + chunk).slice(-8192);
        captureLog = live.captureLog;
      });
      capture.onStderr(
        lineSplitter((line) => {
          for (const listener of live.lines) listener(line);
          if (!worthLogging(line)) return;
          if (Date.now() - windowStart > 60_000) {
            windowStart = Date.now();
            logged = 0;
          }
          logged += 1;
          if (logged <= CAPTURE_LINES_PER_MINUTE)
            console.error(`recorder: camera capture: ${line}`);
          else if (logged === CAPTURE_LINES_PER_MINUTE + 1)
            console.error(
              "recorder: camera capture: (more lines this minute left out)"
            );
        })
      );
      const outcome = await firstFrame([capture, preview.p]);
      previewLog = preview.stderr();
      if (released) return;
      if (outcome === "frame") {
        set({ kind: "live" });
        keepPreview(live, preview.stderr);
        // The capture lost (or stopped for a stall): both open again from
        // the first try. A take on it ends with its writer.
        void capture.exited.then(() => {
          live.exited = true;
          if (released || current !== live) return;
          void quitPreview(live.preview);
          void attempt(1);
        });
        return;
      }
      live.exited = true;
      await Promise.all([quitPreview(preview.p), quitCapture(capture)]);
      if (released) return;
      // NVENC would not open: not the Cam Link's fault, so not a try.
      if (o.encoders.quit("camera", previewLog)) return attempt(n);
      if (saysDeviceBusy(captureLog)) {
        return set({ kind: "busy", message: CAM_LINK_BUSY });
      }
    }
    if (n < CAMERA_ATTEMPTS) return attempt(n + 1);
    const tail = `${captureLog}\n${previewLog}`
      .trim()
      .split(/\r?\n/)
      .slice(-1)[0];
    const missing = !found.camera
      ? " (the Cam Link is not among the DirectShow devices)"
      : !found.mic
        ? " (the mic is not among the DirectShow devices)"
        : "";
    console.error(
      `recorder: the Cam Link did not start in ${CAMERA_ATTEMPTS} tries${missing}${tail ? `: ${tail}` : ""}`
    );
    set({ kind: "not-starting", message: CAM_LINK_NOT_STARTING });
  };

  void attempt(1);

  return {
    status: () => status,
    retry: () => {
      if (status.kind !== "not-starting" && status.kind !== "busy")
        return false;
      void attempt(1);
      return true;
    },
    capture: () => {
      const live = current;
      if (!live || status.kind !== "live" || live.exited) return undefined;
      return {
        devices: live.devices,
        writerRelay: live.relays.writer,
        onLine: (listener) => {
          live.lines.add(listener);
          return () => void live.lines.delete(listener);
        },
        quitWith: () => (live.exited ? errorLines(live.captureLog) : undefined),
        tuned: live.tuned,
      };
    },
    release: async () => {
      released = true;
      const live = current;
      if (!live) return;
      live.exited = true;
      await Promise.all([quitPreview(live.preview), quitCapture(live.capture)]);
    },
  };
};
