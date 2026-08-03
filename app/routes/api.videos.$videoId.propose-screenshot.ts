import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { makeAction } from "@/services/route-action.server";
import { ScreenshotProposalService } from "@/services/screenshot-proposal.server";
import { getVideoFilePath } from "@/services/video-files";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import path from "node:path";

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

export const action = makeAction({
  input: "json",
  dump: false,
  errors: {
    NotFoundError: 404,
    FFmpegError: 500,
    ScreenshotProposalError: 500,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { alt, clipIndex, clips, surroundingText } =
        yield* Schema.decodeUnknown(RequestSchema)(payload);

      const proposals = yield* ScreenshotProposalService;
      const videoOps = yield* VideoOperationsService;
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

      // Capture straight to the real screenshot filename. The document is not
      // rewritten until Matt hits Apply, so a rejected proposal leaves an
      // unreferenced png in the video's scratch directory and nothing else.
      const video = yield* videoOps.getVideoDeepById(params.videoId!);
      const baseDir = path.resolve(getVideoFilePath(video.lineageId));
      yield* fs.makeDirectory(baseDir, { recursive: true });

      let counter = 1;
      let filename: string;
      do {
        filename = `screenshot-${counter}.png`;
        const exists = yield* fs.exists(path.join(baseDir, filename));
        if (!exists) break;
        counter++;
      } while (true);

      const namedClip = clips.find((c) => c.index === clipIndex)!;
      yield* ffmpeg.captureFrameAtTime(
        namedClip.videoFilename,
        proposal.timestamp,
        path.join(baseDir, filename)
      );

      // The winning frame can sit in a neighbouring clip, since the search
      // covers clipIndex ± 2. Report which clip it landed in so the client can
      // retarget the tag — otherwise the block's scrubber, which clamps to the
      // named clip, cannot even seek to the frame being proposed.
      const winningClip =
        clips.find(
          (c) =>
            c.videoFilename === namedClip.videoFilename &&
            proposal.timestamp >= c.sourceStartTime &&
            proposal.timestamp <= c.sourceEndTime
        ) ?? namedClip;

      return {
        found: true as const,
        timestamp: proposal.timestamp,
        clipIndex: winningClip.index,
        reason: proposal.reason,
        imagePath: `./${filename}`,
        absoluteImagePath: path.join(baseDir, filename),
      };
    }),
});
