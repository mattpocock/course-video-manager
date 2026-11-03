import { Effect } from "effect";
import {
  JobOperationsService,
  POST_CHECK_EVENT,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import type {
  ChannelFailure,
  ChannelOutcome,
} from "@cvm/core/features/posting-queue/channel-failures";
import { isShortExportStale } from "@/services/short-export-hash";
import type { ShortPostingJobKind } from "@cvm/core/features/posting-queue/posting-jobs";
import type { PostCheck } from "./job-kind";
import { bufferJobKind } from "./kinds/buffer";
import { youtubeShortsJobKind } from "./kinds/youtube-shorts";

type CheckContext =
  | Effect.Effect.Context<ReturnType<typeof bufferJobKind.checkPostedRaw>>
  | Effect.Effect.Context<
      ReturnType<typeof youtubeShortsJobKind.checkPostedRaw>
    >;

/** The read-only post check of the kind a Posting Queue channel posts with. */
const checkPosted = (
  kind: ShortPostingJobKind,
  ...args: Parameters<typeof bufferJobKind.checkPostedRaw>
): Effect.Effect<PostCheck, unknown, CheckContext> =>
  kind === "buffer"
    ? bufferJobKind.checkPostedRaw(...args)
    : youtubeShortsJobKind.checkPostedRaw(...args);

/** A post check that hangs says `unknown`, as the post-check sweep's does. */
const CHECK_TIMEOUT_MS = 60_000;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * What the kind's read-only post check says about the failed run `job`. A
 * run already looked at (by an earlier tick, or by the post-check sweep for
 * an interrupted post) is not looked at again: its `post-check` Job Event
 * for that attempt is the answer. A new look is written as one, so the
 * author's Job Retry refuses a run the check found posted.
 */
const postCheckOf = (kind: ShortPostingJobKind, job: Job) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const events = yield* ops.listJobEvents(job.id);
    const looked = events.findLast(
      (e) =>
        e.type === POST_CHECK_EVENT &&
        (e.data as { attempt?: unknown }).attempt === job.attempt
    );
    if (looked) return looked.data as unknown as PostCheck;
    const check = yield* checkPosted(kind, job.params, {
      id: job.id,
      title: job.title,
      startedAt: job.startedAt,
    }).pipe(
      Effect.timeout(CHECK_TIMEOUT_MS),
      Effect.catchAll((e) =>
        Effect.succeed<PostCheck>({
          verdict: "unknown",
          detail: `Could not check: ${messageOf(e)}`,
          url: null,
        })
      )
    );
    yield* ops.appendJobEvent({
      jobId: job.id,
      type: POST_CHECK_EVENT,
      data: { ...check, attempt: job.attempt },
    });
    return check;
  });

const outcomeOf = (failure: ChannelFailure) =>
  Effect.map(
    // A render that failed for good, or a Cancel before it started: the
    // post never ran, so nothing went out.
    failure.renderFailure || failure.job.startedAt === null
      ? Effect.succeed<PostCheck>({
          verdict: "not-posted",
          detail: failure.renderFailure ?? "It never started.",
          url: null,
        })
      : postCheckOf(failure.kind, failure.job),
    (check): ChannelOutcome => ({
      kind: failure.kind,
      jobId: failure.job.id,
      attempt: failure.job.attempt,
      verdict: check.verdict,
      detail: check.detail,
      url: check.url,
      renderFailure: failure.renderFailure,
    })
  );

/**
 * POSTING QUEUE FAILURES (#2618, ADR 0057): for each Posting or Held entry,
 * every channel whose latest posting Job ended failed, interrupted or
 * cancelled is looked for at its service, read-only, and settled on the
 * answer: posted is recorded, unknown Holds the entry, not-posted counts a
 * failure and enqueues a NEW Job for that channel only (rendering first
 * when the export is stale). No Job is ever re-run.
 */
export const settlePostingFailures = (now: number) =>
  Effect.gen(function* () {
    const queue = yield* PostingQueueSidecarService;
    for (const entry of yield* queue.channelFailures()) {
      const outcomes = yield* Effect.forEach(entry.failures, outcomeOf);
      const render = outcomes.some((o) => o.verdict === "not-posted")
        ? yield* isShortExportStale(entry.videoId)
        : false;
      yield* queue.settleChannelFailures({
        entryId: entry.entryId,
        outcomes,
        now,
        render,
      });
    }
  });
