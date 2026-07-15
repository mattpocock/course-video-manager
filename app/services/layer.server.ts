import { Layer, ManagedRuntime } from "effect";
import { DrizzleService } from "./drizzle-service.server";
import { DatabaseDumpService, PgDumpRunner } from "./dump-service";
import { NodeContext } from "@effect/platform-node";
import { VideoProcessingService } from "./video-processing-service";
import { BackgroundRemovalService } from "./background-removal-service";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { FeatureFlagService } from "./feature-flag-service";
import { OpenFolderService } from "./open-folder-service";
import { CloudinaryService } from "./cloudinary-service";
import { CloudinaryMarkdownService } from "./cloudinary-markdown-service";
import { CourseWriteService } from "./course-write-service";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { CoursePublishService } from "./course-publish-service";
import { ClipOperationsService } from "./db-clip-operations.server";
import { CourseOperationsService } from "./db-course-operations.server";
import { VideoOperationsService } from "./db-video-operations.server";
import { VersionOperationsService } from "./db-version-operations.server";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { DiagramOperationsService } from "./db-diagram-operations.server";
import { PitchOperationsService } from "./db-pitch-operations.server";
import { BeatOperationsService } from "./db-beat-operations.server";
import { DeliverableOperationsService } from "./db-deliverable-operations.server";
import { ThumbnailOperationsService } from "./db-thumbnail-operations.server";
import { LinkAuthOperationsService } from "./db-link-auth-operations.server";
import { RenderVerticalVideoService } from "./render-vertical-video-service";
import { VideoPostOperationsService } from "./db-video-post-operations.server";
import { BufferApiService } from "./buffer-api-service.server";
import { VercelBlobService } from "./vercel-blob-service.server";

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
  PitchOperationsService.Default,
  BeatOperationsService.Default,
  DeliverableOperationsService.Default,
  ThumbnailOperationsService.Default,
  LinkAuthOperationsService.Default,
  VideoPostOperationsService.Default,
  BufferApiService.Default,
  VercelBlobService.Default,
  DatabaseDumpService.Default,
  VideoProcessingService.Default,
  BackgroundRemovalService.Default,
  VideoEditorLoggerService.Default,
  FeatureFlagService.Default,
  OpenFolderService.Default,
  CloudinaryService.Default,
  CloudinaryMarkdownLayer,
  CourseWriteService.Default,
  FFmpegCommandsService.Default,
  NodeContext.layer
).pipe(
  Layer.provide(PgDumpRunner.Default),
  Layer.provideMerge(DrizzleService.Default)
);

const publishLayer = CoursePublishService.Default.pipe(
  Layer.provide(coreLayer)
);

const renderVerticalLayer = RenderVerticalVideoService.Default.pipe(
  Layer.provide(coreLayer)
);

export const layerLive = Layer.mergeAll(
  coreLayer,
  publishLayer,
  renderVerticalLayer
);

export const runtimeLive = ManagedRuntime.make(layerLive);
