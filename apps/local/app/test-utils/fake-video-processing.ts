import { Effect, Layer } from "effect";
import fs from "node:fs";
import path from "node:path";
import {
  VideoProcessingService,
  type PauseType,
} from "@/services/video-processing-service";
import { expectedExportDurationInSeconds } from "@/services/export-duration-check";

/**
 * What an honest renderer reports for the file it just wrote: exactly the
 * duration the Clips asked for.
 *
 * Every fake renderer owes the export step a duration now, because the export
 * step refuses a short file. A fake that is not about truncation should say
 * this, so that the truncation check stays invisible to it.
 */
export const honestRenderedDurationInSeconds = (exportOpts: {
  clips?: ReadonlyArray<{ duration: number; pauseType?: PauseType }>;
}): number =>
  expectedExportDurationInSeconds(
    (exportOpts.clips ?? []).map((clip) => ({
      duration: clip.duration,
      pauseType: clip.pauseType ?? "none",
    }))
  );

/**
 * What a fake probe reports for an export it did not render.
 *
 * A fake renderer writes a few bytes of text, so there is no real duration to
 * measure from the file. A test that is not about truncation wants such a file
 * treated as sound, and this is longer than any test's Clips ask for.
 */
export const SOUND_FAKE_EXPORT_DURATION_IN_SECONDS = 24 * 60 * 60;

/** The duration probe of a fake renderer that never produces a short file. */
export const soundExportDurationProbe = (): Effect.Effect<number> =>
  Effect.succeed(SOUND_FAKE_EXPORT_DURATION_IN_SECONDS);

/**
 * A VideoProcessingService fake with CONTROLLABLE COMPLETION: an encode can be
 * held open until the test releases it by name.
 *
 * This is the only way to prove that export and upload genuinely overlap —
 * hold one Video's encode, watch another Video reach Dropbox, and assert the
 * held one is still encoding. Everything here is event-driven (promises
 * resolved by the fake itself); nothing sleeps, polls or measures wall-clock
 * time, because the suite runs in forked pools whose worker counts vary by
 * machine.
 */
export const createControllableVideoProcessing = (opts: {
  /**
   * Read lazily: the temp directory is only created when the surrounding test
   * setup runs, which is typically after this fake is constructed.
   */
  outputDirectory: () => string;
  /** Bytes written for a Video, so distinct Videos can have distinct sizes. */
  content?: (videoId: string) => string;
}) => {
  const started = new Set<string>();
  const finished = new Set<string>();
  const startWatchers = new Map<string, Array<() => void>>();
  const gates = new Map<string, { promise: Promise<void>; open: () => void }>();
  let holdEverything = false;

  const gateFor = (videoId: string) => {
    const existing = gates.get(videoId);
    if (existing) return existing;
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    const gate = { promise, open };
    gates.set(videoId, gate);
    return gate;
  };

  /** From now on every encode blocks until `release(videoId)` is called. */
  const holdAll = () => {
    holdEverything = true;
  };

  /** Let one held encode finish. Safe to call before its encode has started. */
  const release = (videoId: string) => {
    gateFor(videoId).open();
  };

  /** Stop holding, and let every encode currently blocked finish. */
  const releaseAll = () => {
    holdEverything = false;
    for (const gate of gates.values()) gate.open();
  };

  /** Resolves once this Video's encode has begun. */
  const waitForStart = (videoId: string) =>
    started.has(videoId)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const watchers = startWatchers.get(videoId) ?? [];
          watchers.push(resolve);
          startWatchers.set(videoId, watchers);
        });

  /** Started encoding and has not yet produced its file. */
  const isEncoding = (videoId: string) =>
    started.has(videoId) && !finished.has(videoId);

  const encodingCount = () => started.size - finished.size;

  const layer = Layer.succeed(VideoProcessingService, {
    exportVideoClips: (exportOpts: {
      videoId: string;
      clips?: ReadonlyArray<{ duration: number; pauseType?: PauseType }>;
    }) =>
      Effect.promise(async () => {
        const { videoId } = exportOpts;
        started.add(videoId);
        for (const notify of startWatchers.get(videoId) ?? []) notify();
        startWatchers.delete(videoId);

        if (holdEverything) await gateFor(videoId).promise;

        const outputPath = path.join(opts.outputDirectory(), `${videoId}.mp4`);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
          outputPath,
          opts.content?.(videoId) ?? `dummy-video-content-${videoId}`
        );
        finished.add(videoId);
        return {
          outputPath,
          durationInSeconds: honestRenderedDurationInSeconds(exportOpts),
        };
      }),
    getVideoDurationInSeconds: soundExportDurationProbe,
  } as any);

  return {
    layer,
    holdAll,
    release,
    releaseAll,
    waitForStart,
    isEncoding,
    encodingCount,
  };
};
