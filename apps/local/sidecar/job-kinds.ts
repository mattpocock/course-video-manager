import { Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { SidecarServices } from "./sidecar-layer";
import type { EnqueueJob, JobKind } from "./job-kind";
import { enqueueJob, type JobKindSpecs } from "./job-specs";
import { autofillJobKind } from "./kinds/autofill";
import { batchExportJobKind } from "./kinds/batch-export";
import { duplicateCourseJobKind } from "./kinds/duplicate-course";
import { exportJobKind } from "./kinds/export";
import { exportAnimaticJobKind } from "./kinds/export-animatic";
import { noopJobKind } from "./kinds/noop";
import { publishJobKind } from "./kinds/publish";
import { renderVerticalJobKind } from "./kinds/render-vertical";
import { transcribeClipsJobKind } from "./kinds/transcribe-clips";
import { transcribeFootageJobKind } from "./kinds/transcribe-footage";
import {
  removeLocalImagesJobKind,
  uploadImagesJobKind,
} from "./kinds/upload-images";
import { clipMockupVoiceJobKind } from "./kinds/clip-mockup-voice";
import { aiHeroJobKind } from "./kinds/ai-hero";
import { bufferJobKind } from "./kinds/buffer";
import { skillsChangelogJobKind } from "./kinds/skills-changelog";
import { storageDeleteJobKind } from "./kinds/storage-delete";
import { storageMoveJobKind } from "./kinds/storage-move";
import { youtubeJobKind } from "./kinds/youtube";
import { youtubeShortsJobKind } from "./kinds/youtube-shorts";

/**
 * Every kind of background job the sidecar can run. A new kind is a handler
 * file under `kinds/` and one line here; there is no other way in.
 */
export const JOB_KINDS = {
  noop: noopJobKind,
  export: exportJobKind,
  "export-animatic": exportAnimaticJobKind,
  "render-vertical": renderVerticalJobKind,
  "batch-export": batchExportJobKind,
  autofill: autofillJobKind,
  "transcribe-clips": transcribeClipsJobKind,
  "transcribe-footage": transcribeFootageJobKind,
  "upload-images": uploadImagesJobKind,
  "remove-local-images": removeLocalImagesJobKind,
  "duplicate-course": duplicateCourseJobKind,
  "clip-mockup-voice": clipMockupVoiceJobKind,
  "storage-move": storageMoveJobKind,
  "storage-delete": storageDeleteJobKind,
  // The `publish` lane, one at a time; never run again on its own.
  publish: publishJobKind,
  // Posting kinds (decision 5): one attempt each, never re-queued.
  youtube: youtubeJobKind,
  "youtube-shorts": youtubeShortsJobKind,
  buffer: bufferJobKind,
  "ai-hero": aiHeroJobKind,
  "skills-changelog": skillsChangelogJobKind,
} as const satisfies Record<string, JobKind<JobServices>>;

export type JobKindName = keyof typeof JOB_KINDS;

/**
 * Every service a handler in `JOB_KINDS` may ask for: the app server's own
 * (`layerLive`), the work only the Sidecar does (`sidecar-layer.ts`: the
 * encodes, the Overlay renderer, the export and Publish), and the
 * `SidecarContext` that proves it.
 */
export type JobServices = SidecarServices;

export type JobKindRegistry<R = JobServices> = Readonly<
  Record<string, JobKind<R>>
>;

// The one way in, and the author's Retry, live with the kinds' specs so the
// app server can reach them without importing a single handler.
export {
  enqueueJob,
  retryJob,
  UnknownJobKindError,
  NoAttemptsLeftError,
  JobNotFoundError,
  JobNotRetryableError,
} from "./job-specs";

/**
 * How a handler starts another Job (`ctx.enqueue`): `enqueueJob` over the
 * sidecar's registry and database, then `then` (the sidecar's nudge, so a
 * lane picks it up now rather than at the next poll).
 */
export const enqueueThrough =
  (opts: {
    readonly registry: JobKindSpecs;
    readonly ops: JobOperationsService;
    readonly then: Effect.Effect<void>;
  }): EnqueueJob =>
  (request) =>
    enqueueJob({ id: null, ...request, registry: opts.registry }).pipe(
      Effect.provideService(JobOperationsService, opts.ops),
      Effect.tap(() => opts.then)
    );
