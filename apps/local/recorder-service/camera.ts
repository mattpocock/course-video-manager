import { cameraPreviewArgs } from "./capture-args";
import type { LaunchedProcess, Launcher } from "./launcher";
import type { PreviewFeeds } from "./preview-feeds";
import type { CameraStatus } from "./protocol";

/**
 * OPENING THE CAM LINK (#1993 Q11, Q12). The Cam Link's real trouble is
 * start-up: sometimes it opens and sends nothing. So the service opens it
 * the moment the recorder opens for a Video, in a preview-only ffmpeg.exe,
 * and calls it live only once a real frame reaches the camera preview feed.
 * No frame within the start timeout, or ffmpeg quitting, is a failed try;
 * after three the service asks for a replug and waits for Retry. A device
 * another program holds (OBS) is reported at once as busy: retrying cannot
 * help until OBS lets go, and the service never closes OBS itself.
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

/** How long a preview process gets to quit on `q` before it is killed. */
const QUIT_TIMEOUT_MS = 5_000;

/**
 * Asks ffmpeg.exe to quit with `q`, killing it only if it does not: killing
 * the WSL side can leave ffmpeg.exe holding the device on Windows.
 */
export const quitProcess = (p: LaunchedProcess) => {
  p.writeStdin("q");
  const timer = setTimeout(() => p.kill(), QUIT_TIMEOUT_MS);
  return p.exited.then(() => clearTimeout(timer));
};

export type CameraOptions = {
  launch: Launcher;
  feeds: PreviewFeeds;
  /** The Cam Link's DirectShow name, looked up afresh on each try (a replug may change it); undefined when it is missing. */
  findCamera: () => Promise<string | undefined>;
  onStatus: (status: CameraStatus) => void;
  startTimeoutMs: number;
};

export type Camera = {
  status: () => CameraStatus;
  /** Starts over from the first try; only after `not-starting` or `busy`. */
  retry: () => boolean;
  /** Lets the Cam Link go: quits the preview process. */
  release: () => Promise<void>;
};

export const openCamera = (o: CameraOptions): Camera => {
  let status: CameraStatus = { kind: "opening", attempt: 1 };
  let current: LaunchedProcess | undefined;
  let released = false;

  const set = (next: CameraStatus) => {
    if (released) return;
    status = next;
    o.onStatus(status);
  };

  const firstFrame = (p: LaunchedProcess) =>
    new Promise<"frame" | "exited" | "timeout">((resolve) => {
      const done = (outcome: "frame" | "exited" | "timeout") => {
        unsubscribe();
        clearTimeout(timer);
        resolve(outcome);
      };
      const unsubscribe = o.feeds.onFrame("camera", () => done("frame"));
      const timer = setTimeout(() => done("timeout"), o.startTimeoutMs);
      void p.exited.then(() => done("exited"));
    });

  const attempt = async (n: number): Promise<void> => {
    set({ kind: "opening", attempt: n });
    const camera = await o.findCamera();
    if (released) return;
    let stderr = "";
    if (camera) {
      const p = o.launch({
        tool: "ffmpeg",
        args: cameraPreviewArgs({
          camera,
          port: o.feeds.port("camera"),
          stillPort: o.feeds.port("still"),
        }),
        cwd: "/mnt/c",
      });
      current = p;
      p.onStderr((chunk) => (stderr = (stderr + chunk).slice(-8192)));
      const outcome = await firstFrame(p);
      if (released) return;
      if (outcome === "frame") {
        set({ kind: "live" });
        // Lost while open and not recording: open it again from the start.
        void p.exited.then(() => {
          if (!released && current === p) void attempt(1);
        });
        return;
      }
      await quitProcess(p);
      if (released) return;
      if (BUSY.test(stderr)) {
        return set({ kind: "busy", message: CAM_LINK_BUSY });
      }
    }
    if (n < CAMERA_ATTEMPTS) return attempt(n + 1);
    const tail = stderr.trim().split(/\r?\n/).slice(-1)[0];
    console.error(
      `recorder: the Cam Link did not start in ${CAMERA_ATTEMPTS} tries${camera ? "" : " (not among the DirectShow devices)"}${tail ? `: ${tail}` : ""}`
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
    release: async () => {
      released = true;
      if (current) await quitProcess(current);
    },
  };
};
