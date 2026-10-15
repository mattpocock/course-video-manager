import { Layer, ManagedRuntime } from "effect";
import { makeStillGate, StillGate } from "./still-gate";
import { existingRecorderClient } from "./recorder-client/existing-client.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { NodeContext } from "@effect/platform-node";
import { VideoProcessingService } from "./video-processing-service";
import { BackgroundRemovalService } from "./background-removal-service";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { OpenFolderService } from "./open-folder-service";
import { SpacedeskService } from "./spacedesk-service";
import { CloudinaryService } from "./cloudinary-service";
import { CloudinaryMarkdownService } from "./cloudinary-markdown-service";
import { CourseWriteService } from "@/services/course-write-service";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { CoursePublishReadService } from "./course-publish-reads";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { ClipMockupCommentOperationsService } from "@/services/db-clip-mockup-comment-operations.server";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { ApiTokenOperationsService } from "@/services/db-api-token-operations.server";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "./buffer-api-service.server";
import { ObjectStoreService } from "./object-store-service.server";
import { TextGenerationService } from "./text-generation-service";
import { AutofillService } from "./autofill-service";
import { DiagramThumbnailStoreLive } from "./diagram-thumbnail-store.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { assertServiceUrlOverrides } from "./service-url-guard";
import { assertStorageRoots } from "./storage-roots";

const CloudinaryMarkdownLayer = CloudinaryMarkdownService.Default.pipe(
  Layer.provide(CloudinaryService.Default)
);

const coreLayer = Layer.mergeAll(
  ClipOperationsService.Default,
  CourseOperationsService.Default,
  VideoOperationsService.Default,
  VersionOperationsService.Default,
  LessonSectionOperationsService.Default,
  DiagramOperationsService.Default,
  DiagramComponentOperationsService.Default,
  PitchOperationsService.Default,
  BeatOperationsService.Default,
  ClipMockupOperationsService.Default,
  ClipMockupChapterOperationsService.Default,
  ClipMockupCommentOperationsService.Default,
  OverlayOperationsService.Default,
  DeliverableOperationsService.Default,
  ThumbnailOperationsService.Default,
  LinkAuthOperationsService.Default,
  ApiTokenOperationsService.Default,
  // Background Jobs: the app enqueues them; the Sidecar runs them.
  JobOperationsService.Default,
  VideoPostOperationsService.Default,
  BufferApiService.Default,
  ObjectStoreService.Default,
  TextGenerationService.Default,
  VideoProcessingService.Default,
  BackgroundRemovalService.Default,
  VideoEditorLoggerService.Default,
  OpenFolderService.Default,
  SpacedeskService.Default,
  CloudinaryService.Default,
  CloudinaryMarkdownLayer,
  CourseWriteService.Default,
  FFmpegCommandsService.Default,
  NodeContext.layer
).pipe(
  Layer.provideMerge(
    DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
  ),
  // The Diagram operations store thumbnails through a port `@cvm/core` declares
  // but cannot implement — it has no filesystem. On this machine it is the
  // on-disk store.
  Layer.provide(DiagramThumbnailStoreLive)
);

// The read side of Publish — export addresses and the publish gate. The
// export and the Publish themselves, the vertical render and the Overlay
// renderer are the Sidecar's alone (`sidecar/sidecar-layer.ts`): nothing in
// this layer spawns an encode, so no route can reach one.
const publishReadLayer = CoursePublishReadService.Default.pipe(
  Layer.provide(coreLayer)
);

// The Autofill is a job of its own, not a stage of a Publish (ADR 0024), so
// it sits beside the publish layer rather than inside it.
const autofillLayer = AutofillService.DefaultWithoutDependencies.pipe(
  Layer.provide(coreLayer)
);

// Before any service is built: a base-URL override in .env that names a host
// other than the service's own (or loopback) would send it the real token.
assertServiceUrlOverrides(process.env);
// And before any file is read: without STORAGE_ROOTS no Footage, export or
// Clip Mockup can be found, so the server refuses to start, naming it.
assertStorageRoots(process.env);

// A still's decode waits for the recorder to stop (`still-gate.ts`). Until
// the recorder client is made nothing can be recording, so it reads as idle;
// so does a client made by code from before the gate (it outlives a
// dev-server reload) until `pnpm dev` is restarted.
const stillGateLayer = Layer.sync(StillGate, () => ({
  run: makeStillGate({
    recording: () => existingRecorderClient()?.recording?.() ?? false,
    onRecordingChange: (listener) =>
      existingRecorderClient()?.onRecordingChange?.(listener) ?? (() => {}),
  }),
}));

export const layerLive = Layer.mergeAll(
  coreLayer,
  publishReadLayer,
  autofillLayer,
  stillGateLayer
);

/**
 * Every service `runtimeLive` can hand out.
 *
 * `makeLoader`/`makeAction` constrain a route's requirements to THIS, so a
 * route that asks for a service missing from `layerLive` fails to compile
 * rather than 500-ing on the first request (#1737).
 */
export type LayerLive = Layer.Layer.Success<typeof layerLive>;

export const runtimeLive = ManagedRuntime.make(layerLive);
