import { NodeContext } from "@effect/platform-node";
import { Effect, Exit, Layer } from "effect";
import fs from "node:fs";
import type { ClipFrame } from "@/packages/clip-source";
import {
  makeStillGate,
  StillGate,
  type RecordingSignal,
} from "../../app/services/still-gate";
import { VideoProcessingService } from "../../app/services/video-processing-service";
import { analysePicture, decodeStamps } from "./footage-analysis";
import { CAMERA_FPS } from "./synthetic-sources";
import { hold, recordTake, sleep, type Ctx } from "./takes";

/**
 * STILLS MID-TAKE (#2214, #2294): the editor's stills, asked for while a take
 * records, the way placing a Take asks for them: the Clip's last frame (the
 * live preview's overlay) and its first frame (the clip list), twice, 6 s
 * apart, again and again. They go through the app's own still path
 * (`VideoProcessingService`, real Linux ffmpeg) and the app server's Still
 * Gate, told what the recorder is doing by this run's own client.
 *
 * Every still must be held: a decode of the growing camera.mkv mid-take is
 * what cost a streamed Recording Session 14 camera frames. Here the footage
 * sits on WSL's own disk, not /mnt/d, so a decode that runs may well lose no
 * frame: `stills_decoded_mid_take` is the bar that catches it either way.
 */

const PLACEMENT_GAP_MS = 6_000;

/** The Still Gate's signal, from the recorder states this run's client hears. */
const recordingSignal = (ctx: Ctx) => {
  const kindNow = () => {
    for (let i = ctx.client.received.length - 1; i >= 0; i--) {
      const m = ctx.client.received[i]!.message;
      if (m.type === "state") return m.state.kind;
    }
    return "closed";
  };
  const listeners = new Set<(recording: boolean) => void>();
  let was = kindNow() === "recording";
  const poll = setInterval(() => {
    const now = kindNow() === "recording";
    if (now === was) return;
    was = now;
    for (const l of [...listeners]) l(now);
  }, 50);
  const signal: RecordingSignal = {
    recording: () => kindNow() === "recording",
    onRecordingChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { signal, close: () => clearInterval(poll) };
};

export const stillsMidTake = async (ctx: Ctx, seconds: number) => {
  ctx.log(
    `stills mid-take: ${seconds} s take, a placed Take's stills every ${PLACEMENT_GAP_MS / 1000} s`
  );
  await sleep(2000);
  const recorder = recordingSignal(ctx);
  // As the app server's runtime has them: the service beside the gate.
  const layer = Layer.mergeAll(
    VideoProcessingService.Default,
    NodeContext.layer,
    Layer.succeed(StillGate, { run: makeStillGate(recorder.signal) })
  );
  const asked: { which: string; atS: number; outcome: string; ms: number }[] =
    [];
  const pngs: string[] = [];
  const ask = async (
    which: "getLastFrame" | "getFirstFrame",
    frame: ClipFrame,
    atS: number
  ) => {
    const started = performance.now();
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(VideoProcessingService, (s) => s[which](frame)).pipe(
        Effect.provide(layer)
      )
    );
    const outcome = Exit.isSuccess(exit)
      ? "decoded"
      : Exit.isFailure(exit) &&
          JSON.stringify(exit.cause).includes("StillHeldError")
        ? "held"
        : "failed";
    if (Exit.isSuccess(exit)) pngs.push(exit.value);
    asked.push({
      which,
      atS,
      outcome,
      ms: Math.round(performance.now() - started),
    });
  };
  let take;
  try {
    take = await recordTake(ctx, async ({ t0Ms, files }) => {
      const end = performance.now() + seconds * 1000;
      await hold(ctx, PLACEMENT_GAP_MS);
      while (performance.now() + PLACEMENT_GAP_MS < end) {
        // A Take placed now: its Clip ended a moment ago.
        const atS = Math.max(0.5, (Date.now() - t0Ms) / 1000 - 1);
        const at = (time: number): ClipFrame => ({
          kind: "composite",
          format: "landscape",
          screen: files.screen,
          camera: files.camera,
          scene: "Code",
          time,
        });
        // The overlay and the clip list ask at once, as the editor does.
        await Promise.all([
          ask("getLastFrame", at(atS), atS),
          ask("getFirstFrame", at(Math.max(0, atS - 4)), atS),
        ]);
        await hold(ctx, PLACEMENT_GAP_MS);
      }
      await hold(ctx, Math.max(0, end - performance.now()));
    });
  } finally {
    recorder.close();
    for (const png of pngs) fs.rmSync(png, { force: true });
  }
  const camera = analysePicture(await decodeStamps(take.files.camera), {
    fps: CAMERA_FPS,
    t0Ms: take.t0Ms,
  });
  const decoded = asked.filter((a) => a.outcome === "decoded").length;
  ctx.measured.stills_decoded_mid_take = asked.length ? decoded : null;
  ctx.measured.stills_take_camera_frames_lost =
    take.stopped.framesLost.camera + camera.dropped;
  ctx.details.stillsMidTake = {
    seconds,
    recordingSessionId: take.id,
    asked,
    held: asked.filter((a) => a.outcome === "held").length,
    decoded,
    failed: asked.filter((a) => a.outcome === "failed").length,
    serviceFramesLost: take.stopped.framesLost,
    camera,
    stopped: {
      reason: take.stopped.reason,
      exitCodes: take.stopped.exitCodes,
      errors: take.stopped.errors,
    },
  };
};
