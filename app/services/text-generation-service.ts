import { Data, Effect } from "effect";
import { anthropic } from "@ai-sdk/anthropic";
import { APICallError, generateText, streamObject } from "ai";
import { z } from "zod";
import {
  autofillChaptersSystemPrompt,
  buildChaptersUserMessage,
} from "@/prompts/autofill-chapters";
import { autofillDescriptionPrompt } from "@/prompts/autofill-description";
import type { GlobalLink } from "@/prompts/link-instructions";

/**
 * TEXT GENERATION — the sole boundary between the **Autofill** and the model
 * provider.
 *
 * Exactly two operations, one per field the Autofill owns: an SEO
 * `description` written from a **Video**'s **Body**, and a **Chapter** set
 * written from its **Transcript**. Both the per-Video actions in the UI and
 * the batch `AutofillService` call them, so there is one generator per field
 * and two callers — the batch pass and the editor can never drift.
 *
 * The models are PINNED. Nothing reviews this output any more, so a model
 * change and a workflow change landing together would hide which one caused a
 * regression. Changing either is a deliberate, separate act.
 */
export const AUTOFILL_DESCRIPTION_MODEL = "claude-haiku-4-5-20251001";
export const AUTOFILL_CHAPTERS_MODEL = "claude-sonnet-4-5";

/**
 * Anything the provider refused. `retryable` marks the refusals that say
 * "later", not "no" — a rate limit or a server error — which the Autofill
 * backs off and retries rather than counting against a Video's one attempt.
 */
export class TextGenerationError extends Data.TaggedError(
  "TextGenerationError"
)<{
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

/** A 429 or a 5xx is worth another attempt; a malformed request is not. */
const isRetryableProviderError = (error: unknown): boolean => {
  if (!APICallError.isInstance(error)) return false;
  if (error.isRetryable) return true;
  const status = error.statusCode;
  return status === 429 || (status !== undefined && status >= 500);
};

const toTextGenerationError = (error: unknown) =>
  new TextGenerationError({
    message: error instanceof Error ? error.message : String(error),
    retryable: isRetryableProviderError(error),
    cause: error,
  });

/** A **Chapter** the model proposes: a title, and the **Clip** it opens on. */
export type AutofillChapterProposal = {
  readonly beforeClipId: string;
  readonly title: string;
};

const proposalSchema = z.object({
  sections: z.array(
    z.object({
      beforeClipId: z.string(),
      title: z.string(),
    })
  ),
});

const isCompleteProposal = (value: unknown): value is AutofillChapterProposal =>
  !!value &&
  typeof (value as AutofillChapterProposal).beforeClipId === "string" &&
  typeof (value as AutofillChapterProposal).title === "string";

export interface AutofillDescriptionInput {
  /** The lesson **Body**. The description is written from this and nothing else. */
  readonly body: string;
  readonly links: readonly GlobalLink[];
}

export interface AutofillChaptersInput {
  readonly clips: ReadonlyArray<{
    readonly id: string;
    readonly order: string;
    readonly text: string;
  }>;
  /** Chapters already on the Video — a soft guide the model may overrule. */
  readonly existingChapters: ReadonlyArray<{
    readonly order: string;
    readonly name: string;
  }>;
  /**
   * Called once per Chapter as it completes, for the editor's streaming
   * preview. Omit it and the operation is simply its non-streaming form: one
   * whole result, which is what the batch pass wants.
   */
  readonly onChapter?: (chapter: AutofillChapterProposal) => void;
  readonly signal?: AbortSignal;
}

export interface TextGeneration {
  readonly autofillDescription: (
    input: AutofillDescriptionInput
  ) => Effect.Effect<string, TextGenerationError>;
  readonly autofillChapters: (
    input: AutofillChaptersInput
  ) => Effect.Effect<AutofillChapterProposal[], TextGenerationError>;
}

const autofillDescription = (input: AutofillDescriptionInput) =>
  Effect.tryPromise({
    try: () =>
      generateText({
        model: anthropic(AUTOFILL_DESCRIPTION_MODEL),
        system: autofillDescriptionPrompt({
          body: input.body,
          links: [...input.links],
        }),
        messages: [{ role: "user", content: "Go" }],
      }),
    catch: toTextGenerationError,
  }).pipe(Effect.map((result) => result.text));

/**
 * The Chapter set, streamed internally and returned whole. A proposal naming a
 * Clip this Video does not have is dropped rather than passed on — the model
 * is the one thing here nobody reviews, so an id it invented must never reach
 * the timeline.
 */
const autofillChapters = (input: AutofillChaptersInput) =>
  Effect.tryPromise({
    try: async () => {
      const validIds = new Set(input.clips.map((clip) => clip.id));
      const result = streamObject({
        model: anthropic(AUTOFILL_CHAPTERS_MODEL),
        schema: proposalSchema,
        system: autofillChaptersSystemPrompt,
        messages: [
          {
            role: "user",
            content: buildChaptersUserMessage({
              clips: [...input.clips],
              existingSections: input.existingChapters.map((chapter) => ({
                order: chapter.order,
                name: chapter.name,
              })),
            }),
          },
        ],
        abortSignal: input.signal,
      });

      const accepted: AutofillChapterProposal[] = [];
      const seen = new Set<string>();
      const accept = (proposal: unknown) => {
        if (!isCompleteProposal(proposal)) return;
        if (!validIds.has(proposal.beforeClipId)) return;
        if (seen.has(proposal.beforeClipId)) return;
        seen.add(proposal.beforeClipId);
        const chapter = {
          beforeClipId: proposal.beforeClipId,
          title: proposal.title,
        };
        accepted.push(chapter);
        input.onChapter?.(chapter);
      };

      // Every element but the last of a partial array is finished, so it can
      // be handed on the moment it appears; the tail is flushed once the
      // stream closes.
      let emitted = 0;
      let latest: unknown[] = [];
      for await (const partial of result.partialObjectStream) {
        latest = (partial.sections ?? []) as unknown[];
        while (emitted < latest.length - 1) accept(latest[emitted++]);
      }
      while (emitted < latest.length) accept(latest[emitted++]);

      return accepted;
    },
    catch: toTextGenerationError,
  });

export class TextGenerationService extends Effect.Service<TextGenerationService>()(
  "TextGenerationService",
  {
    succeed: {
      autofillDescription,
      autofillChapters,
    } satisfies TextGeneration,
  }
) {}
