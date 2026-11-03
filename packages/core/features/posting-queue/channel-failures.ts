import type { jobs, postingQueueEntries } from "../../db/schema.js";
import {
  SHORT_POSTING_FAILURE_LIMIT,
  type ShortPostingJobKind,
} from "./posting-jobs.js";

// ===========================================================================
// A Posting Queue entry's failed channels (#2618, ADR 0057 item 9): what
// the post checks' answers do to the entry. The Sidecar's tick gathers the
// failures and their checks; this decides; one transaction applies it.
// ===========================================================================

type Job = typeof jobs.$inferSelect;
type PostingQueueEntry = typeof postingQueueEntries.$inferSelect;

/** One channel of a Posting or Held entry whose latest posting Job failed. */
export type ChannelFailure = {
  readonly kind: ShortPostingJobKind;
  readonly job: Job;
  /** Its `render-vertical` failed for good, so it never ran: why. */
  readonly renderFailure: string | null;
};

export type EntryFailures = {
  readonly entryId: string;
  readonly videoId: string;
  readonly failures: ReadonlyArray<ChannelFailure>;
};

/** What the post check (or a failed render) said about one failed channel. */
export type ChannelOutcome = {
  readonly kind: ShortPostingJobKind;
  readonly jobId: string;
  /** The run the check looked at. */
  readonly attempt: number;
  readonly verdict: "posted" | "not-posted" | "unknown";
  readonly detail: string;
  readonly url: string | null;
  readonly renderFailure: string | null;
};

/** How a channel is named in a failure reason. */
export const CHANNEL_NAME: Record<ShortPostingJobKind, string> = {
  "youtube-shorts": "YouTube",
  buffer: "TikTok (Buffer)",
};

/** A Job's `error` as one line. */
export const messageOf = (error: unknown) =>
  String((error as { message?: unknown } | null)?.message ?? "no reason given");

/**
 * What the post checks' answers do to an entry (#2618), counting only the
 * outcomes still about its channels' latest runs: the channels to record
 * as posted, the channels to retry, its failure counts, reason and state.
 */
export const decideChannelFailures = (input: {
  entry: PostingQueueEntry;
  outcomes: ReadonlyArray<ChannelOutcome>;
  latest: ReadonlyMap<ShortPostingJobKind, Job>;
  posted: ReadonlySet<string>;
}) => {
  const failures = {
    "youtube-shorts": input.entry.youtubeFailures,
    buffer: input.entry.tiktokFailures,
  };
  const posted: ShortPostingJobKind[] = [];
  const retry: { kind: ShortPostingJobKind; title: string }[] = [];
  let held = false;
  let reason: string | null = null;
  const current = input.outcomes.flatMap((o) => {
    const job = input.latest.get(o.kind);
    const stillThisRun =
      job?.id === o.jobId &&
      job.attempt === o.attempt &&
      (job.status === "failed" || job.status === "interrupted") &&
      !input.posted.has(o.kind);
    return stillThisRun && job ? [{ o, job }] : [];
  });
  for (const { o, job } of current) {
    if (o.verdict === "posted") {
      posted.push(o.kind);
    } else if (o.verdict === "unknown") {
      held = true;
      reason = `${CHANNEL_NAME[o.kind]}: ${o.detail}${o.url ? ` (${o.url})` : ""}`;
    } else {
      failures[o.kind] += 1;
      reason =
        o.renderFailure ?? `${CHANNEL_NAME[o.kind]}: ${messageOf(job.error)}`;
      retry.push({ kind: o.kind, title: job.title });
    }
  }
  const failed = Object.values(failures).some(
    (n) => n >= SHORT_POSTING_FAILURE_LIMIT
  );
  const state: PostingQueueEntry["state"] = failed
    ? "failed"
    : held
      ? "held"
      : retry.length > 0
        ? "posting"
        : input.entry.state;
  return { posted, retry, failures, reason, state };
};
