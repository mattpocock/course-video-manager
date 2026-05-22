import { Layer, ManagedRuntime } from "effect";
import { DrizzleService } from "./drizzle-service.server";
import { DatabaseDumpService } from "./dump-service";
import { CourseRepoParserService } from "./course-repo-parser";
import { NodeContext } from "@effect/platform-node";
import { VideoProcessingService } from "./video-processing-service";
import { BackgroundRemovalService } from "./background-removal-service";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { FeatureFlagService } from "./feature-flag-service";
import { OpenFolderService } from "./open-folder-service";
import { CloudinaryService } from "./cloudinary-service";
import { CloudinaryMarkdownService } from "./cloudinary-markdown-service";
import { CourseRepoWriteService } from "./course-repo-write-service";
import { CourseWriteService } from "./course-write-service";
import { CourseRepoSyncValidationService } from "./course-repo-sync-validation";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { CoursePublishService } from "./course-publish-service";
import { ClipOperationsService } from "./db-clip-operations.server";
import { CourseOperationsService } from "./db-course-operations.server";
import { VideoOperationsService } from "./db-video-operations.server";
import { VersionOperationsService } from "./db-version-operations.server";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { DiagramOperationsService } from "./db-diagram-operations.server";
import { PitchOperationsService } from "./db-pitch-operations.server";
import { DeliverableOperationsService } from "./db-deliverable-operations.server";
import { ThumbnailOperationsService } from "./db-thumbnail-operations.server";
import { LinkAuthOperationsService } from "./db-link-auth-operations.server";

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
  DeliverableOperationsService.Default,
  ThumbnailOperationsService.Default,
  LinkAuthOperationsService.Default,
  CourseRepoParserService.Default,
  DatabaseDumpService.Default,
  VideoProcessingService.Default,
  BackgroundRemovalService.Default,
  VideoEditorLoggerService.Default,
  FeatureFlagService.Default,
  OpenFolderService.Default,
  CloudinaryService.Default,
  CloudinaryMarkdownLayer,
  CourseRepoWriteService.Default,
  CourseWriteService.Default,
  CourseRepoSyncValidationService.Default,
  FFmpegCommandsService.Default,
  NodeContext.layer
).pipe(Layer.provideMerge(DrizzleService.Default));

const publishLayer = CoursePublishService.Default.pipe(
  Layer.provide(coreLayer)
);

export const layerLive = Layer.merge(coreLayer, publishLayer);

export const runtimeLive = ManagedRuntime.make(layerLive);
