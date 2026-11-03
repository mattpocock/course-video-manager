/**
 * The posting Jobs a claimed Posting Slot enqueues (ADR 0057): one per
 * channel, of the existing posting kinds. `youtube-shorts` posts to YouTube
 * direct; `buffer` hands the Short to Buffer with "share now", Buffer being
 * TikTok's pipe only. Each carries the Posting Queue entry it posts, and
 * reads the Short's title and description from the Video when it runs.
 */
export const SHORT_POSTING_JOB_KINDS = ["youtube-shorts", "buffer"] as const;

export type ShortPostingJobKind = (typeof SHORT_POSTING_JOB_KINDS)[number];

/**
 * The posting kinds' policy (ADR 0032 decision 5): one attempt, never
 * re-queued. The Sidecar's registry gives both kinds this same policy
 * (`apps/local/sidecar/retry-policy.ts`, `POSTING_JOB_POLICY`).
 */
export const SHORT_POSTING_JOB_POLICY = {
  lane: "default",
  maxAttempts: 1,
} as const;

/** A posting Job's params when the Posting Queue enqueued it. */
export type QueuedShortPostParams = {
  readonly videoId: string;
  readonly postingQueueEntryId: string;
};

/**
 * The render a claim enqueues when the Short's vertical export is stale
 * (#2615): the Sidecar's `render-vertical` kind, with its own policy
 * (`apps/local/sidecar/retry-policy.ts`, tied to this one at compile
 * time). Both posting Jobs wait on it, so a render that fails for good
 * posts nothing.
 */
export const SHORT_RENDER_JOB = {
  kind: "render-vertical",
  lane: "default",
  maxAttempts: 3,
} as const;

/** A `render-vertical` Job's params. */
export type ShortRenderParams = { readonly videoId: string };
