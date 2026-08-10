import { Layer, ManagedRuntime } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { NodeContext } from "@effect/platform-node";
import { VideoProcessingService } from "./video-processing-service";
import { BackgroundRemovalService } from "./background-removal-service";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { FeatureFlagService } from "./feature-flag-service";
import { OpenFolderService } from "./open-folder-service";
import { SpacedeskService } from "./spacedesk-service";
import { CloudinaryService } from "./cloudinary-service";
import { CloudinaryMarkdownService } from "./cloudinary-markdown-service";
import { CourseWriteService } from "./course-write-service";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { CoursePublishService } from "./course-publish-service";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { ApiTokenOperationsService } from "@/services/db-api-token-operations.server";
import { RenderVerticalVideoService } from "./render-vertical-video-service";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "./buffer-api-service.server";
import { ObjectStoreService } from "./object-store-service.server";
import { TextGenerationService } from "./text-generation-service";
import { AutofillService } from "./autofill-service";
import { DiagramThumbnailStoreLive } from "./diagram-thumbnail-store.server";

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
  DeliverableOperationsService.Default,
  ThumbnailOperationsService.Default,
  LinkAuthOperationsService.Default,
  ApiTokenOperationsService.Default,
  VideoPostOperationsService.Default,
  BufferApiService.Default,
  ObjectStoreService.Default,
  TextGenerationService.Default,
  VideoProcessingService.Default,
  BackgroundRemovalService.Default,
  VideoEditorLoggerService.Default,
  FeatureFlagService.Default,
  OpenFolderService.Default,
  SpacedeskService.Default,
  CloudinaryService.Default,
  CloudinaryMarkdownLayer,
  CourseWriteService.Default,
  FFmpegCommandsService.Default,
  NodeContext.layer
).pipe(
  Layer.provideMerge(DrizzleService.Default),
  // The Diagram operations store thumbnails through a port `@cvm/core` declares
  // but cannot implement — it has no filesystem. On this machine it is the
  // on-disk store.
  Layer.provide(DiagramThumbnailStoreLive)
);

const publishLayer = CoursePublishService.Default.pipe(
  Layer.provide(coreLayer)
);

// The Autofill is a job of its own, not a stage of a Publish (ADR 0024), so
// it sits beside the publish layer rather than inside it.
const autofillLayer = AutofillService.DefaultWithoutDependencies.pipe(
  Layer.provide(coreLayer)
);

const renderVerticalLayer = RenderVerticalVideoService.Default.pipe(
  Layer.provide(coreLayer)
);

export const layerLive = Layer.mergeAll(
  coreLayer,
  publishLayer,
  autofillLayer,
  renderVerticalLayer
);

export const runtimeLive = ManagedRuntime.make(layerLive);
