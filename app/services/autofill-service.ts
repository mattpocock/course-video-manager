import { videos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Data, Effect, Schedule } from "effect";
import {
  selectAutofillCandidates,
  type AutofillCandidate,
  type AutofillField,
  type AutofillSelection,
  type AutofillSkip,
} from "./autofill-candidates";
import { replaceVideoChapters } from "./autofill-chapters-write.server";
import { LinkAuthOperationsService } from "./db-link-auth-operations.server";
import { VersionOperationsService } from "./db-version-operations.server";
import { requireDraftVersionForVideo } from "./draft-guard.server";
import { DrizzleService, type Database } from "./drizzle-service.server";
import {
  TextGenerationService,
  type AutofillChapterProposal,
} from "./text-generation-service";
import { withDbTransaction } from "./with-db-transaction.server";

/**
 * THE AUTOFILL — a review-free generation pass that writes every shipping
 * **Video**'s missing `description` and missing **Chapters** in one go.
 *
 * It is deliberately a JOB OF ITS OWN, not a stage of a **Publish** (ADR
 * 0024). **Missing Chapters** is a blocking lint, so the Publish button is
 * disabled in exactly the situation the Autofill exists to fix — a stage
 * inside a Publish would be unreachable. And a Publish is long, holds a global
 * mutation semaphore and has a **Pending Version** to unwind; a rate limit
 * from Anthropic must not be able to touch any of that.
 *
 * Its rules, all of which the tests are about:
 *
 *   Candidates    are chosen by selectAutofillCandidates — the same rule the
 *                 publish page counts its button with.
 *   Execution     six Videos at a time, with a Video's two fields written
 *                 concurrently inside that.
 *   Commit        a Video's two fields land in ONE transaction or neither
 *                 does, so there is never a Video with new chapters and a
 *                 half-written description.
 *   Isolation     one Video's failure never stops the rest; failures are
 *                 collected the way the publish export loop collects its own.
 *   Retry         a refusal that says "later" — a rate limit, a server error —
 *                 backs off and tries again, and does NOT consume the Video's
 *                 one attempt. Everything else does.
 */

/** Six Videos at a time: enough that thirty finish in minutes. */
export const AUTOFILL_CONCURRENCY = 6;

/** How many times a retryable refusal is waited out before it counts. */
export const AUTOFILL_RETRY_LIMIT = 3;

const retrySchedule = Schedule.exponential("500 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(AUTOFILL_RETRY_LIMIT))
);

export class AutofillVersionNotDraftError extends Data.TaggedError(
  "AutofillVersionNotDraftError"
)<{ readonly versionId: string; readonly commitState: string }> {}

export type AutofillVideoResult = {
  readonly videoId: string;
  readonly title: string;
  readonly status: "filled" | "failed";
  /** The fields actually written. Empty on a failure — nothing landed. */
  readonly fields: readonly AutofillField[];
  readonly message?: string;
};

export type AutofillRunResult = {
  readonly versionId: string;
  readonly candidates: readonly AutofillCandidate[];
  readonly skipped: readonly AutofillSkip[];
  readonly results: readonly AutofillVideoResult[];
};

export interface AutofillRunOptions {
  readonly versionId: string;
  readonly includeTodoLessons: boolean;
  /** The roster, announced once selection is done and before any work starts. */
  readonly onCandidates?: (selection: AutofillSelection) => void;
  readonly onVideoStarted?: (candidate: AutofillCandidate) => void;
  readonly onVideoSettled?: (result: AutofillVideoResult) => void;
}

/** Everything one candidate Video's generation needs, gathered on one walk. */
type CandidatePayload = {
  readonly body: string;
  readonly clips: ReadonlyArray<{ id: string; order: string; text: string }>;
  readonly chapters: ReadonlyArray<{ order: string; name: string }>;
};

const makeAutofillService = (
  db: Database,
  deps: {
    versionOps: VersionOperationsService;
    linkAuthOps: LinkAuthOperationsService;
    textGeneration: TextGenerationService;
  }
) => {
  const { versionOps, linkAuthOps, textGeneration } = deps;

  /**
   * Write a Video's two fields together. The draft guard runs inside the same
   * transaction as the writes, so the Autofill serialises against **Submit**
   * exactly as every other write does — an immutable version is never touched.
   */
  const commitVideo = (input: {
    videoId: string;
    description: string | null;
    chapters: readonly AutofillChapterProposal[] | null;
  }) =>
    withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* requireDraftVersionForVideo(tx, input.videoId);
        if (input.description !== null) {
          yield* Effect.promise(() =>
            tx
              .update(videos)
              .set({ description: input.description, updatedAt: new Date() })
              .where(eq(videos.id, input.videoId))
          );
        }
        if (input.chapters !== null) {
          const chapters = input.chapters;
          yield* Effect.promise(() =>
            replaceVideoChapters(tx, {
              videoId: input.videoId,
              proposals: chapters,
            })
          );
        }
      })
    );

  const autofillVideo = (
    candidate: AutofillCandidate,
    payload: CandidatePayload,
    links: Effect.Effect.Success<ReturnType<typeof linkAuthOps.getLinks>>
  ) =>
    Effect.gen(function* () {
      const wantsDescription = candidate.fields.includes("description");
      const wantsChapters = candidate.fields.includes("chapters");

      // The two fields of one Video run together; the whole Video is one
      // attempt, so the first refusal that sticks takes both down with it and
      // neither is written.
      const [description, chapters] = yield* Effect.all(
        [
          wantsDescription
            ? textGeneration
                .autofillDescription({ body: payload.body, links })
                .pipe(
                  Effect.retry({
                    schedule: retrySchedule,
                    while: (error) => error.retryable,
                  })
                )
            : Effect.succeed(null),
          wantsChapters
            ? textGeneration
                .autofillChapters({
                  clips: payload.clips,
                  existingChapters: payload.chapters,
                })
                .pipe(
                  Effect.retry({
                    schedule: retrySchedule,
                    while: (error) => error.retryable,
                  })
                )
            : Effect.succeed(null),
        ],
        { concurrency: "unbounded" }
      );

      // TextGeneration is a boundary, so what comes back through it is not
      // trusted: an id the model invented is refused here rather than written.
      // A set that validates to nothing is a failure, not an instruction to
      // archive the Chapters already there.
      let validChapters: AutofillChapterProposal[] | null = null;
      if (chapters !== null) {
        const clipIds = new Set(payload.clips.map((clip) => clip.id));
        validChapters = chapters.filter((chapter) =>
          clipIds.has(chapter.beforeClipId)
        );
        if (validChapters.length === 0) {
          return yield* Effect.fail(
            new Error(
              "the model proposed no Chapter naming a clip of this video"
            )
          );
        }
      }

      yield* commitVideo({
        videoId: candidate.videoId,
        description,
        chapters: validChapters,
      });

      return {
        videoId: candidate.videoId,
        title: candidate.title,
        status: "filled",
        fields: candidate.fields,
      } satisfies AutofillVideoResult;
    });

  const autofillCourseVersion = Effect.fn("autofillCourseVersion")(function* (
    options: AutofillRunOptions
  ) {
    const version = yield* versionOps.getVersionWithSections(options.versionId);
    // Only the Draft Version is ever written to. Refusing up front is cheaper
    // and clearer than letting every per-Video guard refuse in turn.
    if (version.commitState !== "draft") {
      return yield* new AutofillVersionNotDraftError({
        versionId: options.versionId,
        commitState: version.commitState,
      });
    }

    const selection = selectAutofillCandidates(
      version.sections,
      options.includeTodoLessons
    );
    options.onCandidates?.(selection);

    const payloads = new Map<string, CandidatePayload>();
    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        for (const video of lesson.videos) {
          payloads.set(video.id, {
            body: (video.body ?? "").trim(),
            clips: video.clips.map((clip) => ({
              id: clip.id,
              order: clip.order,
              text: clip.text ?? "",
            })),
            chapters: video.chapters.map((chapter) => ({
              order: chapter.order,
              name: chapter.name,
            })),
          });
        }
      }
    }

    const links = yield* linkAuthOps.getLinks();

    const results = yield* Effect.forEach(
      selection.candidates,
      (candidate) =>
        Effect.gen(function* () {
          options.onVideoStarted?.(candidate);
          const payload = payloads.get(candidate.videoId)!;
          // Nothing here may fail the run: thirty Videos are never held
          // hostage by one.
          const result: AutofillVideoResult = yield* autofillVideo(
            candidate,
            payload,
            links
          ).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                videoId: candidate.videoId,
                title: candidate.title,
                status: "failed",
                fields: [],
                message:
                  error instanceof Error
                    ? error.message
                    : String((error as { message?: string }).message ?? error),
              } satisfies AutofillVideoResult)
            ),
            Effect.catchAllDefect((defect) =>
              Effect.succeed({
                videoId: candidate.videoId,
                title: candidate.title,
                status: "failed",
                fields: [],
                message:
                  defect instanceof Error ? defect.message : String(defect),
              } satisfies AutofillVideoResult)
            )
          );
          options.onVideoSettled?.(result);
          return result;
        }),
      { concurrency: AUTOFILL_CONCURRENCY }
    );

    const runResult: AutofillRunResult = {
      versionId: options.versionId,
      candidates: selection.candidates,
      skipped: selection.skipped,
      results,
    };
    return runResult;
  });

  return { autofillCourseVersion };
};

export class AutofillService extends Effect.Service<AutofillService>()(
  "AutofillService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      const versionOps = yield* VersionOperationsService;
      const linkAuthOps = yield* LinkAuthOperationsService;
      const textGeneration = yield* TextGenerationService;
      return makeAutofillService(db, {
        versionOps,
        linkAuthOps,
        textGeneration,
      });
    }),
    dependencies: [
      VersionOperationsService.Default,
      LinkAuthOperationsService.Default,
      TextGenerationService.Default,
    ],
  }
) {}
