import type { VideoFormat } from "@/features/videos/video-format";
import { drawnSources, type Scene } from "../app/packages/scene-layout";
import { quitProcess } from "./camera";
import { PREVIEW_TAGS, screenPreviewArgs } from "./capture-args";
import type { LaunchedProcess, Launcher } from "./launcher";
import type { PreviewEncoders } from "./preview-encoders";
import { PREVIEW_STALL_MS, type ScreenStatus } from "./protocol";
import { findByName, Refusal } from "./refusal";
import { listScreens, type Screen } from "./windows-devices";
import { watchPreview } from "./preview-watchdog";

/**
 * THE RECORDER'S SCREEN, per Video format: which ddagrab output is recorded
 * and previewed. Landscape records the DELL, found by its EDID name and
 * checked at Record. A Short records the Spacedesk virtual display, found by
 * its display adapter's name (its monitor has no EDID name), woken only when
 * it is not listed. It is square, 1080x1080 (ADR 0043): the Short layout
 * draws the screen's left square, which is all of it. A 16:9 display is still
 * accepted while Matt switches Spacedesk over, and the Short shows its left
 * square; any other shape is refused. Its preview is the display at its
 * own size. Unavailable, a Short records camera and mic
 * only, and the scenes that draw the screen are refused
 * (`refuseScreenlessScene`).
 */

export const SCREEN_NAME = "DELL U2424H";
/** A Short's screen, found by its display adapter: its monitor has no EDID name. */
export const SPACEDESK_ADAPTER = "spacedesk";
/**
 * Why the Spacedesk display cannot be a Short's screen, if it cannot. The
 * Short layout draws the screen's left square: all of a square display, the
 * left part of a 16:9 one (accepted until Matt has switched to 1080x1080, ADR
 * 0043). A portrait display has no left square as tall as it is.
 */
const unusableSize = (screen: Screen) =>
  screen.width === screen.height || screen.width * 9 === screen.height * 16
    ? undefined
    : `The Spacedesk display is ${screen.width}x${screen.height}, neither square nor 16:9: set Spacedesk to 1080x1080, then wake it again.`;

/** Refuses a scene that draws the screen while a Short's screen is unavailable. */
export const refuseScreenlessScene = (
  scene: Scene,
  format: VideoFormat,
  screen: ScreenStatus | null
) => {
  if (
    screen?.kind === "unavailable" &&
    drawnSources([{ scene }], format).includes("screen")
  )
    throw new Refusal(
      `${scene} shows the screen, and this Short's screen is unavailable: ${screen.message} Use Camera to record without it.`
    );
};

/**
 * Refuses a Stream Deck switch to a scene that draws the screen while a
 * Short's screen is still waking.
 */
export const refuseWakingScene = (
  scene: Scene,
  format: VideoFormat,
  screen: ScreenStatus | null
) => {
  if (
    screen?.kind === "waking" &&
    drawnSources([{ scene }], format).includes("screen")
  )
    throw new Refusal(
      `${scene} shows the screen, and Spacedesk is still waking: wait for the screen.`
    );
};

export const createScreenSide = (o: {
  launch: Launcher;
  /** What encodes the screen preview; one whose NVENC would not open is started again on libx264. */
  encoders: PreviewEncoders;
  /** The service's screen preview feed. */
  previewPort: () => number;
  wakeSpacedesk: () => Promise<void>;
  /** The open recorder's format; undefined while closed. */
  format: () => VideoFormat | undefined;
  /** A Short's screen status, for the state. */
  setStatus: (screen: ScreenStatus) => void;
  /** Subscribes to the screen preview feed's frames, for its watchdog. */
  onPreviewFrame: (listener: () => void) => () => void;
  /** No frame for this long and the screen preview is started again. */
  previewStallMs?: number;
}) => {
  let preview: LaunchedProcess | undefined;
  /**
   * The DELL's output as the screen side last found it, checked as Record
   * checks it: Record records it without listing the screens again (a
   * PowerShell start-up, about 0.6 s). Found afresh on every restart.
   */
  let dell: number | undefined;
  /** Bumped whenever the screen side starts again: an older check's answer is dropped. */
  let generation = 0;

  /** How many times a stalled or quit screen preview was started again, since the service started. */
  let restarts = 0;
  /** Waited before starting a preview that quit again, so one that cannot start is not a hot loop. */
  const RESTART_DELAY_MS = 1_000;

  const startPreview = (screen: Screen) => {
    if (!o.format() || preview) return;
    const p = o.launch({
      tool: "ffmpeg",
      args: screenPreviewArgs({
        screenIndex: screen.index,
        port: o.previewPort(),
        encoder: o.encoders.get("screen"),
      }),
      cwd: "/mnt/c",
    });
    preview = p;
    let stderr = "";
    p.onStderr((chunk) => (stderr = (stderr + chunk).slice(-8192)));
    const startedFor = generation;
    /** Starts it again for the same screen, unless the screen side moved on. */
    const again = (why: string) => {
      restarts += 1;
      console.error(
        `recorder: the screen preview ${why}; starting it again (restart ${restarts})`
      );
      setTimeout(() => {
        if (generation === startedFor && !preview) startPreview(screen);
      }, RESTART_DELAY_MS);
    };
    watchPreview({
      name: "screen preview",
      process: p,
      onFrame: o.onPreviewFrame,
      stallMs: o.previewStallMs,
      onStall: () => {
        if (preview !== p) return;
        void stopPreview().then(() =>
          again(
            `stalled (no frame for ${o.previewStallMs ?? PREVIEW_STALL_MS} ms)`
          )
        );
      },
    });
    void p.exited.then((code) => {
      if (preview !== p) return;
      preview = undefined;
      if (o.encoders.quit("screen", stderr)) {
        if (generation === startedFor) startPreview(screen);
        return;
      }
      again(`quit (exit ${code})`);
    });
  };

  const stopPreview = async () => {
    const p = preview;
    preview = undefined;
    if (p) await quitProcess(p, { launch: o.launch, tag: PREVIEW_TAGS.screen });
  };

  const findSpacedesk = async () =>
    findByName(
      await listScreens(o.launch),
      (s) => s.adapter,
      SPACEDESK_ADAPTER
    );

  /** Finds the Spacedesk display, waking Spacedesk only when it is not listed. */
  const spacedeskScreen = async (): Promise<
    | { kind: "ready"; screen: Screen }
    | Extract<ScreenStatus, { kind: "unavailable" }>
  > => {
    const unavailable = (message: string) =>
      ({ kind: "unavailable", message }) as const;
    let spacedesk = await findSpacedesk();
    if (!spacedesk) {
      try {
        await o.wakeSpacedesk();
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return unavailable(`Could not wake Spacedesk: ${reason}`);
      }
      spacedesk = await findSpacedesk();
    }
    if (!spacedesk)
      return unavailable(
        "Spacedesk woke, but its display is not among the screens the recorder can capture."
      );
    const problem = unusableSize(spacedesk);
    return problem
      ? unavailable(problem)
      : { kind: "ready", screen: spacedesk };
  };

  /**
   * Starts the screen side again for the open recorder's format: the DELL's
   * preview for Landscape; for a Short, the Spacedesk display found (woken
   * if need be) and its preview. Not awaited by the command queue:
   * a wake takes seconds, and nothing waits on it.
   *
   * A Short is `waking` before the first await, so a command queued right
   * behind (Record, retry-screen) never sees the old status; and only the
   * latest restart sets a status, so an overtaken one never overwrites it.
   */
  const restart = async () => {
    const check = (generation += 1);
    dell = undefined;
    const format = o.format();
    const current = () => check === generation && o.format() === format;
    if (format === "short") o.setStatus({ kind: "waking" });
    try {
      await stopPreview();
      if (!current()) return;
      if (format === "landscape") {
        const screens = await listScreens(o.launch);
        const found = findByName(screens, (s) => s.name, SCREEN_NAME);
        if (found && current()) {
          if (found.width === 1920 && found.height === 1080) dell = found.index;
          startPreview(found);
        }
        return;
      }
      if (format !== "short") return;
      const found = await spacedeskScreen();
      if (!current()) return;
      if (found.kind === "unavailable") return o.setStatus(found);
      o.setStatus({ kind: "ready" });
      startPreview(found.screen);
    } catch (e) {
      console.error("recorder: could not start the screen side", e);
      if (current())
        o.setStatus({
          kind: "unavailable",
          message: `Could not look for the Spacedesk display: ${e instanceof Error ? e.message : String(e)}`,
        });
    }
  };

  /** The DELL's output, at the size the recorder records it at. */
  const dellIndex = async () => {
    const screens = await listScreens(o.launch);
    const screen = findByName(screens, (s) => s.name, SCREEN_NAME);
    if (!screen) {
      throw new Refusal(
        `No screen named ${SCREEN_NAME}. Found: ${screens.map((s) => s.name).join(", ") || "none"}`
      );
    }
    if (screen.width !== 1920 || screen.height !== 1080) {
      throw new Refusal(
        `The ${SCREEN_NAME} is ${screen.width}x${screen.height}; the recorder records it at 1920x1080.`
      );
    }
    return screen.index;
  };

  /** A ready Short's screen output, listed again at Record; null to record camera and mic only. */
  const readyShortIndex = async (scene: Scene) => {
    const spacedesk = await findSpacedesk();
    const problem = spacedesk
      ? unusableSize(spacedesk)
      : "The Spacedesk display is no longer among the screens: wake it again.";
    if (spacedesk && !problem) return spacedesk.index;
    const status = { kind: "unavailable", message: problem ?? "" } as const;
    o.setStatus(status);
    await stopPreview();
    refuseScreenlessScene(scene, "short", status);
    return null;
  };

  return {
    restart,
    /** The recorder closed: drops any check under way and stops the preview. */
    close: () => {
      generation += 1;
      dell = undefined;
      return stopPreview();
    },
    /**
     * Why Landscape can't record its screen now (no DELL, or not at
     * 1920x1080), as Record would find it; null if it can. Go Live asks up
     * front, with its other reasons, before it arms or launches anything.
     */
    landscapeRefusal: async (): Promise<string | null> => {
      if (dell !== undefined) return null;
      try {
        await dellIndex();
        return null;
      } catch (e) {
        if (e instanceof Refusal) return e.message;
        throw e;
      }
    },
    /**
     * The ddagrab output to record, or null for none; refuses with why. What
     * it can refuse without a lookup (a Short still waking, or unavailable
     * under a scene that draws the screen) it throws at once, so Record
     * refuses before the Cam Link leaves the preview.
     */
    recordIndex: (
      format: VideoFormat,
      screen: ScreenStatus | null,
      scene: Scene
    ): Promise<number | null> => {
      if (format !== "short")
        return dell === undefined ? dellIndex() : Promise.resolve(dell);
      if (screen?.kind === "waking")
        throw new Refusal(
          "Spacedesk is still waking: wait for the screen before recording."
        );
      if (screen?.kind === "ready") return readyShortIndex(scene);
      refuseScreenlessScene(scene, "short", screen);
      return Promise.resolve(null);
    },
  };
};
