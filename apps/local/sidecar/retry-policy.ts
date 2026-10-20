import { PUBLISH_INTERRUPTED_MESSAGE } from "@/features/jobs/job-wire";
import type { LaneName } from "./lanes";

/**
 * How many times each kind of job runs before it fails, and which lane it
 * runs in — COPIED from the Upload Manager, per Matt's decision
 * (docs/plans/background-jobs-sidecar.md, section 6). The sidecar adds no
 * policy of its own.
 *
 * Copied from the browser Upload Manager (deleted in batch 8), as found on
 * 2026-10-08 (section 7.1 of the plan):
 *
 * - A job's failure counted an attempt; while fewer than 3 had run and the
 *   entry was not `terminal`, it went to `retrying` and the browser re-ran it
 *   AT ONCE with the params it started with. No delay, no backoff, and every
 *   error was retryable. So: 3 attempts.
 * - A Publish and an Autofill reported every failure as fatal, which set
 *   `terminal` — and so did the per-Video rows each fans out into.
 *   So: 1 attempt.
 * - EXCEPT posting (YouTube, Shorts, Buffer, AI Hero, Skills Changelog):
 *   Matt's decision 5 gives each exactly 1 attempt and no re-queue — see
 *   `PostingJobPolicy` below.
 * - A dropped stream is a failure like any other: the reader rejects, the
 *   client calls `onError`, and the job spends an attempt. The sidecar treats
 *   a run it LOST — its lease ran out (`recoverExpiredJobs`), or it lost the
 *   lease mid-run — the same way: retried while attempts remain,
 *   `interrupted` on the last. A deliberate stop (a signal) is not a lost
 *   run: it puts the Job back at the same attempt (`returnJobToQueue`).
 * - When a job fails for good, every job waiting on it fails with
 *   `Dependency "<title>" failed`. The sidecar does the same, in the same
 *   transaction (`failDependents`), and fails a Job enqueued behind one that
 *   had already failed.
 *
 * The narrow retries INSIDE a service stay inside it, untouched: an export
 * inside a Publish or batch `recurs(2)` (`course-publish-export-events.ts:160`),
 * the Dropbox commit retried once (`commitPhase` in `CoursePublishService`), Dropbox HTTP
 * `recurs(5)` on a 429/5xx, a dropped connection or a timeout (`dropboxFetch`), an AI Hero part 5
 * (`ai-hero-upload-service.ts:12`), Autofill's `recurs(3)` per Video
 * (`autofill-service.ts:57-62`).
 */
/**
 * A kind that retries: copied from the Upload Manager, attempts as listed.
 */
export type RetryingJobPolicy = {
  readonly lane: LaneName;
  readonly posting?: false;
} & (
  | {
      readonly maxAttempts: number;
      readonly neverRequeued?: undefined;
      /**
       * `true` for a kind whose run picks up where a lost run left off (a
       * storage move resumes each file by size). A LOST run — its sidecar
       * died, or lost its lease — then goes back to the queue at the same
       * attempt, up to `FREE_LOST_RUNS` times, instead of spending one
       * (#2167). A run that FAILS still spends an attempt.
       */
      readonly resumable?: boolean;
    }
  | {
      /**
       * A kind that must never run again on its own has exactly one attempt:
       * the type will not hold a second one for recovery to spend.
       */
      readonly maxAttempts: 1;
      /**
       * `true` for a kind that must never run again on its own — not put back
       * by a deliberate stop (section 7.5 puts every other kind back at the
       * same attempt), not re-run by recovery after a crash. A Publish cut off
       * halfway leaves a Pending Version that only the author may Promote or
       * Discard (section 7.2), so it ends `interrupted` (`isNeverReRun`).
       */
      readonly neverRequeued: true;
      /**
       * What its row says once it ends `interrupted`, whichever way it was
       * cut off (a stop, a lost lease, recovery after a crash): the never-
       * re-run message, in this kind's own words.
       */
      readonly interruptedMessage: string;
    }
);

/**
 * A kind that POSTS to an outside service (YouTube, Buffer, AI Hero). Matt's
 * decision 5 (docs/plans/background-jobs-sidecar.md, section 6): "Posting
 * twice would be disastrous." So a posting kind runs EXACTLY ONCE:
 *
 * - `maxAttempts` is the literal `1`: no automatic retry when it fails;
 * - `posting: true` makes the sidecar end a run cut off by a deliberate stop
 *   as `interrupted` instead of putting it back in the queue (section 7.5's
 *   rule does not apply), and makes recovery after a crash end it the same
 *   way whatever its attempt counts say;
 * - only the author's Retry runs it again (`retryJob`).
 *
 * The browser used to retry a failed post up to 3 times; that is removed on
 * purpose. `posting-kinds.test.ts` fails if any posting kind slips back.
 */
export interface PostingJobPolicy {
  readonly lane: LaneName;
  readonly maxAttempts: 1;
  readonly posting: true;
}

export type JobPolicy = RetryingJobPolicy | PostingJobPolicy;

/** The one policy every posting kind has. */
export const POSTING_JOB_POLICY = {
  lane: "default",
  maxAttempts: 1,
  posting: true,
} as const satisfies PostingJobPolicy;

/**
 * Every Upload Manager job type, and the policy it brings with it to the
 * sidecar. The five posting types are the exception decision 5 makes: the
 * browser Upload Manager (deleted in batch 8) gave each of them 3 attempts;
 * the sidecar gives each exactly 1.
 */
export const UPLOAD_MANAGER_POLICIES = {
  export: { lane: "default", maxAttempts: 3 },
  youtube: POSTING_JOB_POLICY,
  "youtube-shorts": POSTING_JOB_POLICY,
  buffer: POSTING_JOB_POLICY,
  "ai-hero": POSTING_JOB_POLICY,
  "skills-changelog": POSTING_JOB_POLICY,
  "render-vertical": { lane: "default", maxAttempts: 3 },
  /**
   * A Batch export has no row and no retry of its own in the browser: it is
   * one stream, and its retries are per Video — `recurs(2)` inside the
   * service (`course-publish-export-events.ts:160`), then the browser's
   * standalone export with the attempts the row had left
   * (`upload-context.tsx`, the `initiate: null` hand-off). So: 1 attempt for
   * the batch; its Videos carry the retries (`kinds/batch-export.ts`).
   */
  "batch-export": { lane: "default", maxAttempts: 1 },
  /**
   * A Publish: every failure was `UPLOAD_FATAL_ERROR` (1 attempt), and it
   * ran one at a time (the service's one-permit semaphore, now gone) — the
   * `publish` lane.
   * It is never put back after a stop either (`neverRequeued`): a run cut off
   * after Submit leaves a Pending Version for the author (section 7.2).
   */
  publish: {
    lane: "publish",
    maxAttempts: 1,
    neverRequeued: true,
    interruptedMessage: PUBLISH_INTERRUPTED_MESSAGE,
  },
  autofill: { lane: "default", maxAttempts: 1 },
} as const satisfies Record<string, JobPolicy>;

/**
 * **Clip transcription** (#12) was never an Upload Manager job: the editor
 * awaited one `POST /clips/transcribe`, and a failure was final — no retry
 * (`edit-effect-handlers.ts`). So: 1 attempt, nothing holding a second one
 * back (the 20 Whisper permits stay in the service,
 * `whisper-transcription-service.ts`). Not
 * `neverRequeued`: a transcription is safe to run again, so a deliberate stop
 * puts it back (section 7.5's rule).
 */
export const CLIP_TRANSCRIPTION_POLICY = {
  lane: "default",
  maxAttempts: 1,
} as const satisfies RetryingJobPolicy;

/**
 * **Footage transcription** (#16) was never an Upload Manager job either:
 * `cvm footage transcribe` ran it in-process, and a failure was final — no
 * retry. So: 1 attempt, in the `default` lane like a Clip transcription; the
 * two share the Sidecar's one `WhisperTranscriptionService` and so its 20
 * Whisper permits (the limit stays in the service, as section 6 decided). Not
 * `neverRequeued`: a stop puts it back, and it resumes from its chunk cache.
 */
export const FOOTAGE_TRANSCRIPTION_POLICY = {
  lane: "default",
  maxAttempts: 1,
} as const satisfies RetryingJobPolicy;

/**
 * **Image upload** to Cloudinary was never an Upload Manager job either: the
 * Article Writer's Apply and the Skills Changelog's "Upload Images" awaited
 * one `POST /api/videos/<id>/upload-images`, and a failure was final — no
 * retry. So: 1 attempt, both for the upload and for removing the local files
 * afterwards. Not `neverRequeued`: both are safe to run again (an image
 * already recorded is not uploaded twice, and a file already gone is the goal
 * reached), so a deliberate stop puts them back (section 7.5's rule).
 */
export const IMAGE_UPLOAD_POLICY = {
  lane: "default",
  maxAttempts: 1,
} as const satisfies RetryingJobPolicy;

/**
 * **Course duplicate** was never an Upload Manager job: the modal awaited one
 * `POST /api/courses/<id>/duplicate`, and a failure was final. It gets 2
 * attempts, not the browser's 1 (the chief of staff's call, batch 10), so a run
 * the Sidecar loses mid-copy is resumed rather than leaving the copy without
 * its frames, WAVs and Thumbnails. Both halves are safe to run again: the row
 * copy is one transaction, recorded as a Job Event, and skipped once recorded;
 * a file already in place at its size is skipped
 * (`services/course-duplicate-files.ts`). Not `neverRequeued`: a stop puts it
 * back too.
 */
export const COURSE_DUPLICATE_POLICY = {
  lane: "default",
  maxAttempts: 2,
  resumable: true,
} as const satisfies RetryingJobPolicy;

/**
 * **Storage move** (#2109): copies a Storage Bucket's files to another drive,
 * checking each by checksum. 2 attempts, like a Course duplicate: a lost run
 * resumes each file by size, and a copy already in place is checked, never
 * copied again. A stop puts it back. The author's Cancel ends it `cancelled`.
 * Resumable: a lost run (a Sidecar restart, a lapsed lease) spends no attempt,
 * so a move of 100+ GB outlasts restarts (#2167).
 */
export const STORAGE_MOVE_POLICY = {
  lane: "default",
  maxAttempts: 2,
  resumable: true,
} as const satisfies RetryingJobPolicy;

/**
 * **Storage delete** (#2110): "Delete originals", and every other delete on
 * the Storage page as it moves here. 1 attempt: a file it could not delete
 * (Windows holds it open) fails the Job with "N files still on D:, retry",
 * and the author's Retry runs it again, checking every file afresh. A stop
 * puts it back; it never deletes a file it has not just verified, so a
 * re-run is safe. The author's Cancel ends it `cancelled`.
 */
export const STORAGE_DELETE_POLICY = {
  lane: "default",
  maxAttempts: 1,
} as const satisfies RetryingJobPolicy;

/**
 * **Clip Mockup voice**: Kokoro, on this machine's GPU, through the Clip
 * Mockup daemon. Never an Upload Manager job — `cvm clip-mockup add` used to
 * voice the line before it returned — so this policy is chosen, not copied
 * (Matt, 2026-10-09: "auto-retry OK"). Voicing is local, free and
 * content-addressed (a WAV is named by a hash of its line), so a run again
 * repeats nothing that already landed. 3 attempts, the Upload Manager's
 * ordinary count, then the Clip Mockups it holds are marked `failed`; the
 * author's `cvm clip-mockup update` queues them again. Not a posting kind,
 * and safe to put back after a deliberate stop.
 */
export const CLIP_MOCKUP_VOICE_POLICY = {
  lane: "default",
  maxAttempts: 3,
} as const satisfies RetryingJobPolicy;

/**
 * The Upload Manager types that post to an outside service: each must be a
 * posting kind in the sidecar's registry (`posting-kinds.test.ts`).
 */
export const POSTING_KIND_NAMES = [
  "youtube",
  "youtube-shorts",
  "buffer",
  "ai-hero",
  "skills-changelog",
] as const;

/** The policy of an ordinary, retrying Upload Manager job. */
export const RETRYING_JOB_POLICY: RetryingJobPolicy =
  UPLOAD_MANAGER_POLICIES.export;
