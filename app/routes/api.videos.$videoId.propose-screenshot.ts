import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { makeAction } from "@/services/route-action.server";
import { ScreenshotProposalService } from "@/services/screenshot-proposal.server";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const ClipSchema = Schema.Struct({
  index: Schema.Number,
  sourceStartTime: Schema.Number,
  sourceEndTime: Schema.Number,
  videoFilename: Schema.String,
  text: Schema.NullOr(Schema.String),
});

/**
 * The clip window and the surrounding prose are sent by the client rather than
 * re-derived here: only the client knows this block's position in the *unsaved*
 * document, and a server-side re-parse would pick the wrong tag whenever one
 * clip carries two screenshots.
 */
const RequestSchema = Schema.Struct({
  alt: Schema.String,
  clipIndex: Schema.Number,
  clips: Schema.Array(ClipSchema),
  surroundingText: Schema.String,
});

/**
 * A path-safe directory name for one ChooseScreenshot block.
 *
 * The alt text is hashed rather than sanitised because it is model-written
 * prose on its way into a filesystem path: hashing settles traversal,
 * separators and length limits in one step, and nothing needs to read it back.
 */
const blockDirName = (clipIndex: number, alt: string) =>
  `${clipIndex}-${createHash("sha1").update(alt).digest("hex").slice(0, 12)}`;

export const action = makeAction({
  input: "json",
  dump: false,
  errors: {
    FFmpegError: 500,
    ScreenshotProposalError: 500,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { alt, clipIndex, clips, surroundingText } =
        yield* Schema.decodeUnknown(RequestSchema)(payload);

      const proposals = yield* ScreenshotProposalService;
      const ffmpeg = yield* FFmpegCommandsService;
      const fs = yield* FileSystem.FileSystem;

      const proposal = yield* proposals.proposeScreenshot({
        alt,
        clipIndex,
        clips: clips.map((c) => ({ ...c })),
        surroundingText,
      });

      if (!proposal.found) {
        return { found: false as const, reason: proposal.reason };
      }

      // Candidates are previews, so they go to a scratch directory rather than
      // into the video's own files: three of the four are about to be thrown
      // away, and Apply re-captures the chosen frame at the scrubber's real
      // position anyway. Nothing this route writes is ever referenced by the
      // document, so nothing it writes can be orphaned in it.
      //
      // The directory is per *block*, not per video, and wiped on entry. Per
      // video would mean the second block's search deleting the first block's
      // thumbnails while its grid is still on screen — the files are gone but
      // the panel is not, so it just renders four broken images. Keyed this way
      // it stays bounded: one directory per block, replaced when re-searched.
      const previewDir = path.join(
        tmpdir(),
        "cvm-screenshot-candidates",
        params.videoId!,
        blockDirName(clipIndex, alt)
      );
      yield* fs.remove(previewDir, { recursive: true }).pipe(Effect.ignore);
      yield* fs.makeDirectory(previewDir, { recursive: true });

      const namedClip = clips.find((c) => c.index === clipIndex)!;

      const candidates = yield* Effect.forEach(
        proposal.candidates,
        (candidate, i) =>
          Effect.gen(function* () {
            const previewPath = path.join(previewDir, `candidate-${i}.png`);
            yield* ffmpeg.captureFrameAtTime(
              namedClip.videoFilename,
              candidate.timestamp,
              previewPath
            );
            return {
              timestamp: candidate.timestamp,
              clipIndex: candidate.clipIndex,
              previewPath,
            };
          }),
        { concurrency: 4 }
      );

      return { found: true as const, candidates };
    }),
});
