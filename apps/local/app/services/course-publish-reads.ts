import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import type { ClipSourceColumns } from "@/packages/clip-source";
import {
  computeExportHash,
  exportFilename,
  type ExportOverlay,
  toExportClips,
} from "./export-hash";
import { existsOnStorage } from "@/packages/storage/server";
import { locateExportedVideo } from "./finished-videos.server";
import { storageRootsConfig } from "./storage-roots";
import {
  ANNOUNCE_NOTHING,
  type PlaceholderFloor,
} from "@/packages/course-json";
import {
  validatePublishability as validatePublishabilityCore,
  validateVersionPublishability as validateVersionPublishabilityCore,
  type VersionTree,
} from "./course-publish-readiness";

export type VideoForExport = {
  id: string;
  format: string;
  lesson?: {
    section: { repoVersion: { repo: { id: string } } };
  } | null;
  clips: Array<
    ClipSourceColumns & {
      pauseType: string;
      zoomType: string;
      order: string;
      overlays: ExportOverlay[];
    }
  >;
};

/**
 * The read side of Publish: where a Video's export lives, whether it is on
 * disk, and the publish gate. Nothing here spawns a process, so the app
 * server has it (`CoursePublishReadService`, in `layerLive`), and so does the
 * Sidecar's `CoursePublishService`, which adds the export and the Publish
 * themselves (docs/plans/background-jobs-sidecar.md, the spawn guard).
 */
export const makeCoursePublishReads = Effect.gen(function* () {
  const videoOps = yield* VideoOperationsService;
  const effectFs = yield* FileSystem.FileSystem;
  const storageRoots = yield* storageRootsConfig;

  /**
   * Where a Video's Exported Video is: on whichever Storage Root has it, or —
   * when none does — where an export would write it (the first root).
   */
  const resolveExportPath = Effect.fn("resolveExportPath")(function* (
    videoOrId: string | VideoForExport
  ) {
    const video =
      typeof videoOrId === "string"
        ? yield* videoOps.getVideoWithClipsById(videoOrId)
        : videoOrId;
    if (video.clips.length === 0) return null;

    const hash = computeExportHash(
      toExportClips(video.clips),
      video.format,
      storageRoots
    );
    if (!hash) return null;

    const namespace = video.lesson?.section.repoVersion.repo.id ?? video.id;
    return yield* locateExportedVideo(
      storageRoots,
      exportFilename(namespace, hash)
    );
  });

  const isExported = Effect.fn("isExported")(function* (
    videoOrId: string | VideoForExport
  ) {
    const exportPath = yield* resolveExportPath(videoOrId);
    if (!exportPath) return false;
    // An Exported Video on an Offline Storage Root is not there for now.
    return yield* existsOnStorage(exportPath, storageRoots).pipe(
      Effect.provideService(FileSystem.FileSystem, effectFs)
    );
  });

  // The publish validation gate. The computation itself lives in
  // ./course-publish-readiness so it can also be read on its own — by the
  // `cvm course readiness` CLI verb — without dragging in the export stack.
  // Its deps are closed over here so callers of this service method don't
  // inherit them.
  const readinessContext = yield* Effect.context<
    VersionOperationsService | FileSystem.FileSystem
  >();
  const validatePublishability = Effect.fn("validatePublishability")(function* (
    versionId: string,
    placeholderFloor: PlaceholderFloor = ANNOUNCE_NOTHING
  ) {
    return yield* validatePublishabilityCore(versionId, placeholderFloor).pipe(
      Effect.provide(readinessContext)
    );
  });

  // Same gate over a tree the caller already read (the publish page loader).
  const validatePublishabilityOfTree = Effect.fn(
    "validatePublishabilityOfTree"
  )(function* (
    version: VersionTree,
    placeholderFloor: PlaceholderFloor = ANNOUNCE_NOTHING
  ) {
    return yield* validateVersionPublishabilityCore(
      version,
      placeholderFloor
    ).pipe(Effect.provide(readinessContext));
  });

  return {
    resolveExportPath,
    isExported,
    validatePublishability,
    validatePublishabilityOfTree,
  };
});

/** The read side of Publish, for routes: no export, no Publish, no spawn. */
export class CoursePublishReadService extends Effect.Service<CoursePublishReadService>()(
  "CoursePublishReadService",
  { effect: makeCoursePublishReads }
) {}
