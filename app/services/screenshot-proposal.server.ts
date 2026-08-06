import {
  COARSE_FRAME_HEIGHT,
  FINE_FRAME_HEIGHT,
  computeSearchWindow,
  planCoarseSamples,
  planFineSampleGroups,
  selectDistinctMoments,
  type FrameSample,
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

export interface ScreenshotCandidate {
  /** Absolute time in the source file. */
  readonly timestamp: number;
  /** The clip this frame was drawn from, which need not be the named one. */
  readonly clipIndex: number;
}

export type ScreenshotProposal =
  | { readonly found: true; readonly candidates: ScreenshotCandidate[] }
  | { readonly found: false; readonly reason: string };

export interface ProposeScreenshotInput {
  readonly alt: string;
  readonly clipIndex: number;
  readonly clips: IndexedClip[];
  readonly surroundingText: string;
}

// Frame numbers are deliberately plain numbers rather than `.int()`: zod v4
// renders `.int()` as JSON-schema `minimum`/`maximum` safe-integer bounds, and
// Anthropic's structured output rejects those on an integer type. They are
// rounded and range-checked against the frames actually shown, below.
const coarseResult = z.object({
  frameNumbers: z
    .array(z.number())
    .describe("Up to six frame numbers, best first. Empty if none match."),
  reason: z
    .string()
    .describe(
      "One sentence, written for Matt. Only read when the list is empty."
    ),
});

const fineResult = z.object({
  picks: z
    .array(
      z.object({
        group: z.number().describe("The group number."),
        frameNumber: z.number().describe("The best frame in that group."),
      })
    )
    .describe("Exactly one pick per group."),
});

/** A frame handed to the model, with the label that identifies it. */
interface LabelledSample {
  readonly sample: FrameSample;
  readonly label: string;
}

export class ScreenshotProposalService extends Effect.Service<ScreenshotProposalService>()(
  "ScreenshotProposalService",
  {
    effect: Effect.gen(function* () {
      const ffmpeg = yield* FFmpegCommandsService;
      const fs = yield* FileSystem.FileSystem;

      /**
       * Extract the frames, label each one, and ask the model about them.
       *
       * Every frame goes as its own labelled text part followed by its own
       * image part, rather than tiled into one contact sheet. A contact sheet
       * would be cheaper, but it makes the model responsible for mapping a
       * tile position back to a timestamp — and a silent off-by-one there
       * returns a confident, plausible, wrong frame.
       */
      const askJudge = <A>(opts: {
        videoFilename: string;
        labelled: LabelledSample[];
        height: number;
        instructions: string;
        contextBlock: string;
        schema: z.ZodType<A>;
      }) =>
        Effect.gen(function* () {
          const workDir = path.join(
            tmpdir(),
            `screenshot-judge-${crypto.randomUUID()}`
          );

          const frames = yield* ffmpeg
            .captureFramesAtTimes(
              opts.videoFilename,
              opts.labelled.map((l) => l.sample.timestamp),
              workDir,
              opts.height
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
            | { type: "text"; text: string }
            | { type: "image"; image: Uint8Array }
          > = [
            {
              type: "text",
              text: `${opts.contextBlock}\n\n${opts.instructions}`,
            },
          ];

          for (const [i, frame] of frames.entries()) {
            const bytes = yield* fs.readFile(frame.outputPath).pipe(
              Effect.mapError(
                (e) =>
                  new ScreenshotProposalError({
                    cause: e,
                    message: `Could not read extracted frame: ${e.message}`,
                  })
              )
            );
            content.push({ type: "text", text: opts.labelled[i]!.label });
            content.push({ type: "image", image: bytes });
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              generateObject({
                model: anthropic(JUDGE_MODEL),
                schema: opts.schema,
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

          return result.object;
        });

      /**
       * Find candidate frames for a `<ChooseScreenshot>` tag, in two passes.
       *
       * Coarse: one small frame per second across the clip and its neighbours,
       * ranking up to six plausible moments. Those are thinned to genuinely
       * distinct ones, then a single fine pass sees every survivor's
       * neighbourhood at full size and picks the most presentable frame of
       * each. Two vision calls whatever the candidate count — the fine pass
       * batches rather than looping, so the cost is flat.
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
        const coarse = yield* askJudge({
          videoFilename: window.videoFilename,
          labelled: coarseSamples.map((sample, i) => ({
            sample,
            label: `Frame ${i + 1} — ${sample.timestamp.toFixed(
              2
            )}s, from clip ${sample.clipIndex}${
              sample.isNamedClip ? " (the named clip)" : ""
            }`,
          })),
          height: COARSE_FRAME_HEIGHT,
          instructions: COARSE_PASS_INSTRUCTIONS,
          contextBlock,
          schema: coarseResult,
        });

        // Frame numbers outside the range shown are dropped rather than
        // clamped: a number nobody was offered is not a near miss, it is a
        // judgement that cannot be trusted to point anywhere.
        const ranked = coarse.frameNumbers
          .map((n) => coarseSamples[Math.round(n) - 1])
          .filter((s): s is FrameSample => s !== undefined);

        if (ranked.length === 0) {
          return {
            found: false,
            reason: coarse.reason,
          } satisfies ScreenshotProposal;
        }

        const moments = selectDistinctMoments(ranked);
        const groups = planFineSampleGroups(
          window,
          moments.map((m) => m.timestamp)
        );

        // Frames are numbered across the whole call and also tagged with their
        // group, so a pick is checked twice: the number has to exist, and it
        // has to belong to the group it was offered for.
        const flat = groups.flatMap((group, groupIndex) =>
          group.samples.map((sample) => ({ sample, groupIndex }))
        );

        const fine = yield* askJudge({
          videoFilename: window.videoFilename,
          labelled: flat.map(({ sample, groupIndex }, i) => ({
            sample,
            label: `Frame ${i + 1} — group ${groupIndex + 1}, ${sample.timestamp.toFixed(
              2
            )}s, from clip ${sample.clipIndex}${
              sample.isNamedClip ? " (the named clip)" : ""
            }`,
          })),
          height: FINE_FRAME_HEIGHT,
          instructions: FINE_PASS_INSTRUCTIONS,
          contextBlock,
          schema: fineResult,
        });

        const candidates = groups.map((group, groupIndex) => {
          const pick = fine.picks.find(
            (p) => Math.round(p.group) === groupIndex + 1
          );
          const chosen = pick
            ? flat[Math.round(pick.frameNumber) - 1]
            : undefined;

          // A missing or misfiled pick loses the refinement, not the
          // candidate: the coarse moment was already a real frame.
          if (!chosen || chosen.groupIndex !== groupIndex) {
            const fallback =
              group.samples.find((s) => s.timestamp === group.center) ??
              group.samples[0]!;
            return {
              timestamp: fallback.timestamp,
              clipIndex: fallback.clipIndex,
            };
          }

          return {
            timestamp: chosen.sample.timestamp,
            clipIndex: chosen.sample.clipIndex,
          };
        });

        return { found: true, candidates } satisfies ScreenshotProposal;
      });

      return { proposeScreenshot };
    }),
    dependencies: [FFmpegCommandsService.Default, NodeContext.layer],
  }
) {}
