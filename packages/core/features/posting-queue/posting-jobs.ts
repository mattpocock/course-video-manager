/**
 * The posting Jobs a claimed Posting Slot enqueues (ADR 0057): one per
 * channel the Short is not Posted on yet, of the existing posting kinds.
 * `youtube-shorts` posts to YouTube direct; `buffer` hands the Short to
 * Buffer with "share now", Buffer being TikTok's pipe only. Each carries the
 * Posting Queue entry it posts, and the title and description the claim
 * read from the Video.
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

/**
 * The failures on one channel that mark a Posting Queue entry Failed
 * (#2618). A render that fails for good counts once per channel waiting on it.
 */
export const SHORT_POSTING_FAILURE_LIMIT = 3;

/**
 * A posting Job's params: the Posting Queue entry it posts, and the Short's
 * words as they were when its slot was claimed. The post and its post check
 * both use these, so renaming the Short after the claim can neither change
 * what goes out nor hide a post that went out. A retry copies them.
 * TikTok's caption is the title.
 */
export type QueuedShortPostParams = {
  readonly videoId: string;
  readonly postingQueueEntryId: string;
  readonly title: string;
  readonly description: string;
};

/** Whether a posting Job's stored params are `QueuedShortPostParams`. */
export const isQueuedShortPostParams = (
  params: unknown
): params is QueuedShortPostParams => {
  if (typeof params !== "object" || params === null) return false;
  const p = params as Record<string, unknown>;
  return ["videoId", "postingQueueEntryId", "title", "description"].every(
    (key) => typeof p[key] === "string"
  );
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
