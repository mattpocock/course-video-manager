import {
  COARSE_FRAME_HEIGHT,
  FINE_FRAME_HEIGHT,
  computeSearchWindow,
  planCoarseSamples,
  planFineSamples,
  type FrameSample,
  type SearchWindow,
} from "@/features/article-writer/screenshot-search-window";
import type { IndexedClip } from "@/features/article-writer/types";
import {
  COARSE_PASS_INSTRUCTIONS,
  FINE_PASS_INSTRUCTIONS,
  SCREENSHOT_RUBRIC,
  buildScreenshotJudgeContext,
} from "@/prompts/propose-screenshot";
import { anthropic } from "@ai-sdk/anthropic";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { generateObject } from "ai";
import { Data, Effect } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { FFmpegCommandsService } from "./ffmpeg-commands";

/** The vision model used for both passes. */
const JUDGE_MODEL = "claude-sonnet-4-5";

export class ScreenshotProposalError extends Data.TaggedError(
  "ScreenshotProposalError"
)<{
  cause: unknown;
  message: string;
}> {}

export type ScreenshotProposal =
  | {
      readonly found: true;
      readonly timestamp: number;
      readonly reason: string;
    }
  | { readonly found: false; readonly reason: string };

export interface ProposeScreenshotInput {
  readonly alt: string;
  readonly clipIndex: number;
  readonly clips: IndexedClip[];
  readonly surroundingText: string;
}

// `frameNumber` is deliberately a plain number rather than `.int()`: zod v4
// renders `.int()` as JSON-schema `minimum`/`maximum` safe-integer bounds, and
// Anthropic's structured output rejects those on an integer type. It is
// rounded, and range-checked against the frames actually shown, below.
const coarseResult = z.object({
  frameNumber: z
    .number()
    .nullable()
    .describe("The chosen frame number, or null if no frame matches."),
  reason: z.string().describe("One sentence, written for Matt."),
});

const fineResult = z.object({
  frameNumber: z.number().describe("The chosen frame number."),
  reason: z.string().describe("One sentence, written for Matt."),
});

export class ScreenshotProposalService extends Effect.Service<ScreenshotProposalService>()(
  "ScreenshotProposalService",
  {
    effect: Effect.gen(function* () {
      const ffmpeg = yield* FFmpegCommandsService;
      const fs = yield* FileSystem.FileSystem;

      /** Sample frames, label each with its number, and ask the model to pick. */
      const judgeFrames = Effect.fn("judgeFrames")(function* (
        window: SearchWindow,
        samples: FrameSample[],
        instructions: string,
        contextBlock: string,
        height: number,
        allowNoMatch: boolean
      ) {
        const workDir = path.join(
          tmpdir(),
          `screenshot-judge-${crypto.randomUUID()}`
        );

        const frames = yield* ffmpeg
          .captureFramesAtTimes(
            window.videoFilename,
            samples.map((s) => s.timestamp),
            workDir,
            height
          )
          .pipe(
            Effect.mapError(
              (e) =>
                new ScreenshotProposalError({
                  cause: e,
                  message: `Could not extract frames: ${e.message}`,
                })
            )
          );

        const content: Array<
          { type: "text"; text: string } | { type: "image"; image: Uint8Array }
        > = [{ type: "text", text: `${contextBlock}\n\n${instructions}` }];

        for (const [i, frame] of frames.entries()) {
          const sample = samples[i]!;
          const bytes = yield* fs.readFile(frame.outputPath).pipe(
            Effect.mapError(
              (e) =>
                new ScreenshotProposalError({
                  cause: e,
                  message: `Could not read extracted frame: ${e.message}`,
                })
            )
          );
          content.push({
            type: "text",
            text: `Frame ${i + 1} — ${frame.timestamp.toFixed(2)}s, from clip ${
              sample.clipIndex
            }${sample.isNamedClip ? " (the named clip)" : ""}`,
          });
          content.push({ type: "image", image: bytes });
        }

        const result = yield* Effect.tryPromise({
          try: () =>
            generateObject({
              model: anthropic(JUDGE_MODEL),
              schema: allowNoMatch ? coarseResult : fineResult,
              system: SCREENSHOT_RUBRIC,
              messages: [{ role: "user", content }],
            }),
          catch: (e) =>
            new ScreenshotProposalError({
              cause: e,
              message: `The screenshot judge failed: ${String(e)}`,
            }),
        }).pipe(
          // The frames are scratch: remove them however the judgement went.
          Effect.ensuring(
            fs.remove(workDir, { recursive: true }).pipe(Effect.ignore)
          )
        );

        const chosen = result.object.frameNumber;
        if (chosen === null || chosen === undefined) {
          return { timestamp: null, reason: result.object.reason };
        }

        // A frame number outside the range it was shown means the judgement
        // cannot be trusted — treat it as no match rather than capturing a
        // frame nobody chose.
        const index = Math.round(chosen) - 1;
        if (index < 0 || index >= samples.length) {
          return {
            timestamp: null,
            reason: `The judge picked frame ${chosen}, which was not one of the ${samples.length} frames it was shown.`,
          };
        }

        return {
          timestamp: samples[index]!.timestamp,
          reason: result.object.reason,
        };
      });

      /**
       * Find the best frame for a `<ChooseScreenshot>` tag, in two passes.
       *
       * Coarse: one small frame per second across the clip and its neighbours,
       * to localise the moment. Fine: full-size frames a fifth of a second
       * apart around the winner, to pick the exact one. Two vision calls,
       * fixed — at ~30 candidate seconds there is nothing worth searching
       * adaptively, and a fixed shape stays debuggable.
       */
      const proposeScreenshot = Effect.fn("proposeScreenshot")(function* (
        input: ProposeScreenshotInput
      ) {
        const window = computeSearchWindow(input.clips, input.clipIndex);
        if (!window) {
          return {
            found: false,
            reason: `Clip ${input.clipIndex} is not in this video.`,
          } satisfies ScreenshotProposal;
        }

        const contextBlock = buildScreenshotJudgeContext({
          alt: input.alt,
          clipTexts: window.clips.map((c) => ({
            index: c.index,
            isNamed: c.index === window.namedClip.index,
            text: c.text,
          })),
          surroundingText: input.surroundingText,
        });

        const coarseSamples = planCoarseSamples(window);
        const coarse = yield* judgeFrames(
          window,
          coarseSamples,
          COARSE_PASS_INSTRUCTIONS,
          contextBlock,
          COARSE_FRAME_HEIGHT,
          true
        );

        if (coarse.timestamp === null) {
          return {
            found: false,
            reason: coarse.reason,
          } satisfies ScreenshotProposal;
        }

        const fineSamples = planFineSamples(window, coarse.timestamp);
        const fine = yield* judgeFrames(
          window,
          fineSamples,
          FINE_PASS_INSTRUCTIONS,
          contextBlock,
          FINE_FRAME_HEIGHT,
          false
        );

        // The fine pass cannot decline; falling back to the coarse winner keeps
        // a malformed frame number from losing a good localisation.
        return {
          found: true,
          timestamp: fine.timestamp ?? coarse.timestamp,
          reason: fine.reason,
        } satisfies ScreenshotProposal;
      });

      return { proposeScreenshot };
    }),
    dependencies: [FFmpegCommandsService.Default, NodeContext.layer],
  }
) {}
