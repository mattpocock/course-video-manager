import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import { assertUnder } from "./assert-under";
import {
  FfmpegInputCutShortError,
  withClipIndex,
  type FfmpegLogInfo,
} from "./ffmpeg-error";
import {
  clipSegmentArgs,
  concatList,
  concatSegmentsArgs,
  SEGMENT_EXTENSION,
  type SegmentClip,
} from "./clip-segment-args";
import { nowMs } from "@/packages/clock";

type RunEncodeOptions = {
  args: string[];
  totalDurationSeconds: number;
  onProgress: ((percent: number) => void) | undefined;
  onLog: (info: FfmpegLogInfo) => void;
  errorPrefix: string;
};

/**
 * The segmented export's encode: each Clip rendered on its own (a CVM-recorder
 * Clip as its composite), one after another, then the segments joined by
 * stream copy into one file — never one filter graph across Clips (see
 * `clip-segment-args.ts`). Built by `FFmpegEncodeService` over its own
 * `runEncode`, so each segment takes an encode slot and falls back to
 * libx264 like every other landscape pass.
 *
 * Returns the joined file, in the same temp directory the single-pass export
 * writes to; the segment files are removed.
 */
export const makeConcatenateClipSegments = <E, R>(deps: {
  fs: FileSystem.FileSystem;
  runEncode: (opts: RunEncodeOptions) => Effect.Effect<void, E, R>;
}) =>
  Effect.fn("concatenateClipSegments")(function* (
    clips: readonly SegmentClip[],
    dimensions: { width: number; height: number },
    extras: {
      onProgress?: (percent: number) => void;
      onLog: (info: FfmpegLogInfo) => void;
    }
  ) {
    const { fs, runEncode } = deps;
    const outputDir = path.join(tmpdir(), "video-processing");
    const id = crypto
      .createHash("sha256")
      .update(JSON.stringify(clips) + nowMs())
      .digest("hex")
      .slice(0, 12);
    const segmentDir = assertUnder(
      outputDir,
      path.join(outputDir, `${id}-segments`)
    );
    yield* fs.makeDirectory(segmentDir, { recursive: true });

    // One progress figure across every segment: the seconds already rendered
    // plus this segment's share. The stream-copy join is quick and reports
    // nothing.
    const total = clips.reduce((sum, clip) => sum + clip.duration, 0);
    let done = 0;
    const segmentFiles: string[] = [];

    return yield* Effect.gen(function* () {
      for (const [index, clip] of clips.entries()) {
        const segmentFile = path.join(
          segmentDir,
          `${String(index).padStart(4, "0")}${SEGMENT_EXTENSION}`
        );
        const before = done;
        yield* runEncode({
          args: clipSegmentArgs(clip, dimensions, segmentFile),
          totalDurationSeconds: clip.duration,
          onProgress: (percent) =>
            extras.onProgress?.(
              Math.min(
                99,
                Math.floor(
                  ((before + (clip.duration * percent) / 100) / total) * 100
                )
              )
            ),
          onLog: extras.onLog,
          errorPrefix: `Failed to render Clip ${index + 1} of ${clips.length}`,
        }).pipe(
          // Every input of this pass is this one Clip's.
          Effect.mapError((error) =>
            error instanceof FfmpegInputCutShortError
              ? withClipIndex(error, index)
              : error
          )
        );
        segmentFiles.push(segmentFile);
        done += clip.duration;
      }

      const listFile = assertUnder(
        segmentDir,
        path.join(segmentDir, "segments.txt")
      );
      yield* fs.writeFileString(listFile, concatList(segmentFiles));
      const outputFile = path.join(outputDir, `${id}.mp4`);
      yield* runEncode({
        args: concatSegmentsArgs(listFile, outputFile),
        totalDurationSeconds: total,
        onProgress: undefined,
        onLog: extras.onLog,
        errorPrefix: "Failed to join the Clip segments",
      });
      return outputFile;
    }).pipe(
      Effect.ensuring(
        fs.remove(segmentDir, { recursive: true }).pipe(
          // Scratch cleanup never fails the export, but a leak leaves a trail.
          Effect.catchAll((error) =>
            Effect.logWarning(`Could not remove ${segmentDir}`).pipe(
              Effect.annotateLogs("error", error.message)
            )
          )
        )
      )
    );
  });
