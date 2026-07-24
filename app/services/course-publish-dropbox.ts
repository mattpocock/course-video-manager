import { Config, Effect, Stream } from "effect";
import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import {
  buildCourseJson,
  buildCourseJsonSchema,
  computeEffectiveSections,
} from "@/packages/course-json";
import {
  computeExportHash,
  resolveExportPath,
  type ExportClip,
} from "./export-hash";
import { VersionOperationsService } from "./db-version-operations.server";
import { ExportError, PublishValidationError } from "./course-publish-errors";
import { resolveSectionsWithVideos } from "./publish-to-dropbox";
import {
  uploadFile,
  uploadFileFromDisk,
  getMetadata,
  listFolder,
  type DropboxFileMetadata,
} from "./dropbox-http-client";
import { DropboxContentHasher } from "./dropbox-content-hash";
import { getValidDropboxAccessToken } from "./dropbox-auth-service";

const toExportClips = (
  clips: Array<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    order: string;
  }>
): ExportClip[] =>
  clips.map((clip) => ({
    videoFilename: clip.videoFilename,
    sourceStartTime: clip.sourceStartTime,
    sourceEndTime: clip.sourceEndTime,
  }));

const hashFileLocally = Effect.fn("hashFileLocally")(function* (
  effectFs: FileSystem.FileSystem,
  filePath: string
) {
  const sha256Hash = createHash("sha256");
  const contentHasher = new DropboxContentHasher();
  const bytes = yield* effectFs.stream(filePath).pipe(
    Stream.runFold(0, (total, chunk) => {
      sha256Hash.update(chunk);
      contentHasher.update(chunk);
      return total + chunk.byteLength;
    })
  );
  return {
    sha256: sha256Hash.digest("hex"),
    bytes,
    contentHash: contentHasher.digest(),
  };
});

export const syncFrozenCourseVersionToDropbox = Effect.fn(
  "syncFrozenCourseVersionToDropbox"
)(function* (input: {
  courseId: string;
  courseVersionId: string;
  includeTodoLessons: boolean;
  onProgress?: (event: "progress", data: { percentage: number }) => void;
}) {
  const effectFs = yield* FileSystem.FileSystem;
  const versionOps = yield* VersionOperationsService;
  const finishedVideosDirectory = yield* Config.string(
    "FINISHED_VIDEOS_DIRECTORY"
  );
  const dropboxRemotePath = yield* Config.string("DROPBOX_REMOTE_PATH");
  const accessToken = yield* getValidDropboxAccessToken;

  const targetVersion = yield* versionOps.getCourseVersionById(
    input.courseVersionId
  );
  if (
    targetVersion.repoId !== input.courseId ||
    targetVersion.commitState === "draft"
  ) {
    return yield* new PublishValidationError({
      unfrozenCourseVersionId: input.courseVersionId,
    });
  }

  const repoWithSections = yield* versionOps.getCourseWithSectionsByVersion({
    repoId: input.courseId,
    versionId: input.courseVersionId,
  });

  const effectiveSections = computeEffectiveSections(
    repoWithSections.sections,
    input.includeTodoLessons
  );

  const videoPathOverrides = new Map<string, string>();
  for (const section of effectiveSections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        if (video.clips.length === 0) continue;
        const hash = computeExportHash(
          toExportClips(video.clips),
          video.format
        );
        if (!hash) continue;
        videoPathOverrides.set(
          video.id,
          resolveExportPath(finishedVideosDirectory, input.courseId, hash)
        );
      }
    }
  }

  const { sections, missingVideos } = yield* resolveSectionsWithVideos({
    sectionsInDb: effectiveSections,
    finishedVideosDirectory,
    videoPathOverrides,
  });
  if (missingVideos.length > 0) return { missingVideos };

  const dropboxCourseDir = `${dropboxRemotePath}/${repoWithSections.name}`;
  const videoAssets = new Map<string, { sha256: string; bytes: number }>();
  const videoContentHashes = new Map<string, string>();

  const videoEntries: Array<{
    videoId: string;
    localPath: string;
    relativeAssetPath: string;
  }> = [];

  for (const section of sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        const relativeAssetPath = `${section.path}/${lesson.path}/${video.name}.mp4`;
        videoEntries.push({
          videoId: video.id,
          localPath: video.absolutePath,
          relativeAssetPath,
        });
      }
    }
  }

  // Hash all local video files to compute the asset fingerprint and
  // content_hashes for verification — before any upload begins.
  for (const entry of videoEntries) {
    const hashes = yield* hashFileLocally(effectFs, entry.localPath);
    videoAssets.set(entry.videoId, {
      sha256: hashes.sha256,
      bytes: hashes.bytes,
    });
    videoContentHashes.set(entry.videoId, hashes.contentHash);
  }

  const schemaJson = JSON.stringify(buildCourseJsonSchema(), null, 2);
  const assetFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        schemaJson,
        courseId: input.courseId,
        courseVersionId: input.courseVersionId,
        courseName: repoWithSections.name,
        includeTodoLessons: input.includeTodoLessons,
        sections: repoWithSections.sections,
        videos: videoEntries.map((entry) => ({
          relativeAssetPath: entry.relativeAssetPath,
          ...videoAssets.get(entry.videoId)!,
        })),
      })
    )
    .digest("hex")
    .slice(0, 32);
  const versionFingerprint = createHash("sha256")
    .update(input.courseVersionId)
    .digest("hex")
    .slice(0, 16);
  const assetBasePath = `versions/${versionFingerprint}-${assetFingerprint}`;
  const remoteBundleDir = `${dropboxCourseDir}/${assetBasePath}`;

  const courseJsonDoc = yield* buildCourseJson({
    courseId: input.courseId,
    courseVersionId: input.courseVersionId,
    courseName: repoWithSections.name,
    assetBasePath,
    sections: repoWithSections.sections,
    videoAssets,
    includeTodoLessons: input.includeTodoLessons,
  });
  const manifestJson = JSON.stringify(courseJsonDoc, null, 2);

  // Check if the bundle already exists remotely.
  const existingBundle = yield* getMetadata({
    accessToken,
    path: remoteBundleDir,
  }).pipe(Effect.catchTag("DropboxApiError", () => Effect.succeed(null)));

  if (existingBundle && existingBundle[".tag"] === "folder") {
    // Verify the existing bundle's integrity via content_hash + size.
    const remoteEntries = yield* listFolder({
      accessToken,
      path: remoteBundleDir,
      recursive: true,
    });
    const remoteFilesByPath = new Map<string, DropboxFileMetadata>();
    for (const entry of remoteEntries) {
      if (entry[".tag"] === "file") {
        remoteFilesByPath.set(entry.path_display.toLowerCase(), entry);
      }
    }

    for (const entry of videoEntries) {
      const remotePath =
        `${remoteBundleDir}/${entry.relativeAssetPath}`.toLowerCase();
      const remoteFile = remoteFilesByPath.get(remotePath);
      if (!remoteFile) {
        return yield* new ExportError({
          message: `Immutable asset bundle is missing video ${entry.videoId}`,
        });
      }
      const expectedHash = videoContentHashes.get(entry.videoId)!;
      const expected = videoAssets.get(entry.videoId)!;
      if (
        remoteFile.content_hash !== expectedHash ||
        remoteFile.size !== expected.bytes
      ) {
        return yield* new ExportError({
          message: `Immutable asset bundle conflict for video ${entry.videoId}`,
        });
      }
    }

    // Verify schema and manifest in the existing bundle.
    const remoteSchemaPath =
      `${remoteBundleDir}/course.schema.json`.toLowerCase();
    const remoteManifestPath = `${remoteBundleDir}/manifest.json`.toLowerCase();
    const remoteSchema = remoteFilesByPath.get(remoteSchemaPath);
    const remoteManifest = remoteFilesByPath.get(remoteManifestPath);
    if (!remoteSchema || !remoteManifest) {
      return yield* new ExportError({
        message: "Immutable asset bundle is missing schema or manifest",
      });
    }
  } else {
    // Upload the bundle.
    let totalBytes = 0;
    let uploadedBytes = 0;

    for (const entry of videoEntries) {
      totalBytes += videoAssets.get(entry.videoId)!.bytes;
    }

    for (const entry of videoEntries) {
      const fileSize = videoAssets.get(entry.videoId)!.bytes;
      const remotePath = `${remoteBundleDir}/${entry.relativeAssetPath}`;
      const metadata = yield* uploadFileFromDisk({
        accessToken,
        path: remotePath,
        filePath: entry.localPath,
        fileSize,
        onProgress: (uploaded) => {
          if (totalBytes > 0) {
            const pct = Math.round(
              ((uploadedBytes + uploaded) / totalBytes) * 100
            );
            input.onProgress?.("progress", {
              percentage: Math.min(pct, 99),
            });
          }
        },
      });

      uploadedBytes += fileSize;

      // Verify the upload via content_hash.
      const expectedHash = videoContentHashes.get(entry.videoId)!;
      if (metadata.content_hash !== expectedHash) {
        return yield* new ExportError({
          message: `Upload verification failed for video ${entry.videoId}: content_hash mismatch`,
        });
      }
    }

    // Upload schema and manifest.
    yield* uploadFile({
      accessToken,
      path: `${remoteBundleDir}/course.schema.json`,
      content: Buffer.from(schemaJson, "utf-8"),
    });
    yield* uploadFile({
      accessToken,
      path: `${remoteBundleDir}/manifest.json`,
      content: Buffer.from(manifestJson, "utf-8"),
    });
  }

  // Write the root course.json receipt with overwrite mode — the sole
  // commit marker. This is the last write; consumers read it to know
  // which bundle is current.
  yield* uploadFile({
    accessToken,
    path: `${dropboxCourseDir}/course.json`,
    content: Buffer.from(manifestJson, "utf-8"),
    mode: "overwrite",
  });

  input.onProgress?.("progress", { percentage: 100 });

  return { missingVideos };
});
