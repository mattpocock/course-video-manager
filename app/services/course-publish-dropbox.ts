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
import { uploadConcurrency } from "./dropbox-upload-config";

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

  // Take stock of whatever of this bundle already landed. A bundle left
  // half-written by an interrupted Publish is resumed, not rejected: the
  // listing already says precisely which files are absent.
  const remoteFilesByPath = new Map<string, DropboxFileMetadata>();
  const existingBundle = yield* getMetadata({
    accessToken,
    path: remoteBundleDir,
  }).pipe(Effect.catchTag("DropboxApiError", () => Effect.succeed(null)));

  if (existingBundle && existingBundle[".tag"] === "folder") {
    const remoteEntries = yield* listFolder({
      accessToken,
      path: remoteBundleDir,
      recursive: true,
    });
    for (const entry of remoteEntries) {
      if (entry[".tag"] === "file") {
        remoteFilesByPath.set(entry.path_display.toLowerCase(), entry);
      }
    }
  }

  const remoteVideoPath = (entry: (typeof videoEntries)[number]) =>
    `${remoteBundleDir}/${entry.relativeAssetPath}`;

  // Partition the bundle's Videos into "already landed" and "still to send".
  // A Video present with a matching content_hash and size is skipped; one
  // present but different is an immutability violation rather than an
  // interrupted transfer, and is never overwritten.
  const pendingUploads: typeof videoEntries = [];
  // Bytes of each Video that are already in Dropbox — the input to the
  // byte-weighted progress below.
  const uploadedByVideo = new Map<string, number>();
  for (const entry of videoEntries) {
    const remoteFile = remoteFilesByPath.get(
      remoteVideoPath(entry).toLowerCase()
    );
    if (!remoteFile) {
      pendingUploads.push(entry);
      uploadedByVideo.set(entry.videoId, 0);
      continue;
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
    // Landed by a previous attempt — a resumed Publish counts it as done
    // rather than reporting itself back at zero.
    uploadedByVideo.set(entry.videoId, expected.bytes);
  }

  // Byte-weighted progress across every Video in the bundle. Uploads report
  // interleaved once several are in flight, so the aggregate is recomputed
  // from the per-Video counters rather than accumulated as they complete.
  const totalBytes = videoEntries.reduce(
    (sum, entry) => sum + videoAssets.get(entry.videoId)!.bytes,
    0
  );
  let lastReportedPercentage = 0;
  const reportProgress = () => {
    if (totalBytes <= 0) return;
    let uploaded = 0;
    for (const bytes of uploadedByVideo.values()) uploaded += bytes;
    const percentage = Math.min(
      Math.round((uploaded / totalBytes) * 100),
      // 100 is reserved for the commit receipt landing.
      99
    );
    if (percentage <= lastReportedPercentage) return;
    lastReportedPercentage = percentage;
    input.onProgress?.("progress", { percentage });
  };
  reportProgress();

  const uploadConcurrencyLimit = yield* uploadConcurrency;

  yield* Effect.forEach(
    pendingUploads,
    (entry) =>
      Effect.gen(function* () {
        const metadata = yield* uploadFileFromDisk({
          accessToken,
          path: remoteVideoPath(entry),
          filePath: entry.localPath,
          fileSize: videoAssets.get(entry.videoId)!.bytes,
          onProgress: (uploaded) => {
            uploadedByVideo.set(entry.videoId, uploaded);
            reportProgress();
          },
        });

        // Verify the upload via content_hash.
        const expectedHash = videoContentHashes.get(entry.videoId)!;
        if (metadata.content_hash !== expectedHash) {
          return yield* new ExportError({
            message: `Upload verification failed for video ${entry.videoId}: content_hash mismatch`,
          });
        }
      }),
    { concurrency: uploadConcurrencyLimit }
  );

  // Schema and manifest are content-identical for a given bundle path, so
  // whichever of them a previous attempt landed is left alone.
  const schemaRemotePath = `${remoteBundleDir}/course.schema.json`;
  const manifestRemotePath = `${remoteBundleDir}/manifest.json`;
  if (!remoteFilesByPath.has(schemaRemotePath.toLowerCase())) {
    yield* uploadFile({
      accessToken,
      path: schemaRemotePath,
      content: Buffer.from(schemaJson, "utf-8"),
    });
  }
  if (!remoteFilesByPath.has(manifestRemotePath.toLowerCase())) {
    yield* uploadFile({
      accessToken,
      path: manifestRemotePath,
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
