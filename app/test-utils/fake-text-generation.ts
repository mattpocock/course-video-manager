import { Effect, Layer } from "effect";
import {
  TextGenerationError,
  TextGenerationService,
  type AutofillChapterProposal,
  type AutofillChaptersRequest,
  type AutofillDescriptionRequest,
} from "@/services/text-generation-service";

/** How the fake answers one call for one field. */
export type FakeTextGenerationOutcome =
  | { readonly kind: "ok" }
  /** A refusal that says "no" — this consumes the Video's one attempt. */
  | { readonly kind: "fail"; readonly message?: string }
  /**
   * A refusal that says "later" — a rate limit or a server error. The Autofill
   * backs off and tries again, and it does NOT consume the attempt.
   * `until` many calls are refused before the field starts succeeding.
   */
  | { readonly kind: "rate-limit"; readonly until: number }
  /** The model names a **Clip** this Video does not have. */
  | { readonly kind: "invalid-clip-id" };

const OK: FakeTextGenerationOutcome = { kind: "ok" };

/**
 * A TextGeneration fake, following the pattern set by the Dropbox and
 * video-processing fakes: the whole model boundary replaced by canned answers
 * that a test can steer per Video.
 *
 * The Autofill's rules are the behaviour under test; what the model says is
 * not. So this returns predictable text and, crucially, can be told to fail —
 * plainly, or with the retryable rate limit that must NOT count against a
 * Video's one attempt.
 */
export const createFakeTextGeneration = (opts?: {
  /** Keyed by the marker the test plants in the Video's body / first clip. */
  readonly descriptionOutcomes?: Record<string, FakeTextGenerationOutcome>;
  readonly chapterOutcomes?: Record<string, FakeTextGenerationOutcome>;
  readonly describe?: (input: AutofillDescriptionRequest) => string;
}) => {
  const descriptionCalls: AutofillDescriptionRequest[] = [];
  const chapterCalls: AutofillChaptersRequest[] = [];
  const attempts = { description: 0, chapters: 0 };

  const rateLimited = new Map<string, number>();

  /**
   * A call is steered by the marker in the text it was handed, so a test can
   * fail exactly one Video without threading ids through the service.
   */
  const outcomeFor = (
    outcomes: Record<string, FakeTextGenerationOutcome> | undefined,
    haystack: string
  ): FakeTextGenerationOutcome => {
    for (const [marker, outcome] of Object.entries(outcomes ?? {})) {
      if (haystack.includes(marker)) return outcome;
    }
    return OK;
  };

  const applyOutcome = <A>(
    key: string,
    outcome: FakeTextGenerationOutcome,
    succeed: () => A
  ): Effect.Effect<A, TextGenerationError> => {
    if (outcome.kind === "fail") {
      return Effect.fail(
        new TextGenerationError({
          message: outcome.message ?? "the model refused",
          retryable: false,
        })
      );
    }
    if (outcome.kind === "rate-limit") {
      const seen = (rateLimited.get(key) ?? 0) + 1;
      rateLimited.set(key, seen);
      if (seen <= outcome.until) {
        return Effect.fail(
          new TextGenerationError({
            message: "rate limited",
            retryable: true,
          })
        );
      }
    }
    return Effect.sync(succeed);
  };

  // Everything below is deferred with Effect.suspend, because a retry re-runs
  // the same Effect value: bookkeeping done while BUILDING it would count one
  // call and replay one verdict forever, and a rate limit would never clear.
  const layer = Layer.succeed(TextGenerationService, {
    autofillDescription: (input: AutofillDescriptionRequest) =>
      Effect.suspend(() => {
        descriptionCalls.push(input);
        attempts.description += 1;
        const outcome = outcomeFor(opts?.descriptionOutcomes, input.body);
        return applyOutcome(
          `description:${input.body}`,
          outcome,
          () =>
            opts?.describe?.(input) ??
            `Autofilled description for ${input.body}`
        );
      }),

    autofillChapters: (input: AutofillChaptersRequest) =>
      Effect.suspend(() => {
        chapterCalls.push(input);
        attempts.chapters += 1;
        const transcript = input.clips.map((clip) => clip.text).join(" ");
        const outcome = outcomeFor(opts?.chapterOutcomes, transcript);
        return applyOutcome(`chapters:${transcript}`, outcome, () => {
          // An invented id is the one thing the real service refuses to pass on,
          // so the fake needs to be able to produce one.
          const proposals: AutofillChapterProposal[] =
            outcome.kind === "invalid-clip-id"
              ? [{ beforeClipId: "no-such-clip", title: "Invented" }]
              : input.clips.length === 0
                ? []
                : [
                    {
                      beforeClipId: input.clips[0]!.id,
                      title: "Autofilled opening",
                    },
                  ];
          for (const proposal of proposals) input.onChapter?.(proposal);
          return proposals;
        });
      }),
  } as TextGenerationService);

  return {
    layer,
    descriptionCalls,
    chapterCalls,
    attempts,
  };
};
