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

/**
 * Read an Exported Video off disk purely to digest it. Only Videos this
 * Publish is NOT sending go through here — anything actually uploaded is
 * digested off the upload's own byte stream instead, so no file is ever read
 * twice and the whole-course pre-hash pass no longer exists.
 */
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

  // The Export Hash is the recipe an Exported Video is addressed by — Clip
  // filenames, source timings, order, Video Format and the Export Version Key.
  // It is pure database state, so it is knowable before a single frame is
  // encoded, which is what lets the bundle path below be knowable too.
  const videoExportHashes = new Map<string, string>();
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
        videoExportHashes.set(video.id, hash);
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

  const videoEntries: Array<{
    videoId: string;
    localPath: string;
    relativeAssetPath: string;
    exportHash: string | null;
  }> = [];

  for (const section of sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        const relativeAssetPath = `${section.path}/${lesson.path}/${video.name}.mp4`;
        videoEntries.push({
          videoId: video.id,
          localPath: video.absolutePath,
          relativeAssetPath,
          exportHash: videoExportHashes.get(video.id) ?? null,
        });
      }
    }
  }

  const schemaJson = JSON.stringify(buildCourseJsonSchema(), null, 2);
  // The bundle is addressed by its RECIPE, not by its bytes: each Video
  // contributes its Export Hash rather than a SHA256 of the encoded file. Every
  // ingredient is therefore database state, so the destination path is known
  // before any encoding or reading happens — which is what lets export and
  // upload overlap. Two files at one address are asserted identical because
  // they came from identical Clips and Video Format; the Export Version Key is
  // the manual lever for invalidating that assertion (see ADR on bundle
  // addressing).
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
          exportHash: entry.exportHash,
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

  // Sizes come from stat, not from a read: they weight the progress aggregate
  // and pick each Video's upload strategy.
  const videoByteSizes = new Map<string, number>();
  for (const entry of videoEntries) {
    const info = yield* effectFs.stat(entry.localPath);
    videoByteSizes.set(entry.videoId, Number(info.size));
  }

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

  // Byte-weighted progress across every Video in the bundle. Uploads report
  // interleaved once several are in flight, so the aggregate is recomputed
  // from the per-Video counters rather than accumulated as they complete.
  const uploadedByVideo = new Map<string, number>(
    videoEntries.map((entry) => [entry.videoId, 0])
  );
  const totalBytes = videoEntries.reduce(
    (sum, entry) => sum + videoByteSizes.get(entry.videoId)!,
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

  const uploadConcurrencyLimit = yield* uploadConcurrency;

  // Ship each Video, digesting it off the same pass. A Video already present
  // with a matching content_hash and size is skipped; one present but
  // different is an immutability violation rather than an interrupted
  // transfer, and is never overwritten.
  const receipts = yield* Effect.forEach(
    videoEntries,
    (entry) =>
      Effect.gen(function* () {
        const remoteFile = remoteFilesByPath.get(
          remoteVideoPath(entry).toLowerCase()
        );

        if (remoteFile) {
          // Landed by a previous attempt. Its SHA256 is still owed to the
          // manifest and nothing streamed it, so this is the one place a
          // local read survives — and only for Videos this Publish is NOT
          // sending.
          const hashes = yield* hashFileLocally(effectFs, entry.localPath);
          if (
            remoteFile.content_hash !== hashes.contentHash ||
            remoteFile.size !== hashes.bytes
          ) {
            return yield* new ExportError({
              message: `Immutable asset bundle conflict for video ${entry.videoId}`,
            });
          }
          // A resumed Publish counts it as done rather than reporting itself
          // back at zero.
          uploadedByVideo.set(entry.videoId, hashes.bytes);
          reportProgress();
          return {
            videoId: entry.videoId,
            sha256: hashes.sha256,
            bytes: hashes.bytes,
          };
        }

        // The manifest's proven-source-revision guarantee is met off the
        // upload's own byte stream: no separate read pass exists any more.
        const sha256Hash = createHash("sha256");
        const contentHasher = new DropboxContentHasher();
        let streamedBytes = 0;

        const metadata = yield* uploadFileFromDisk({
          accessToken,
          path: remoteVideoPath(entry),
          filePath: entry.localPath,
          fileSize: videoByteSizes.get(entry.videoId)!,
          onChunk: (chunk) => {
            sha256Hash.update(chunk);
            contentHasher.update(chunk);
            streamedBytes += chunk.byteLength;
          },
          onProgress: (uploaded) => {
            uploadedByVideo.set(entry.videoId, uploaded);
            reportProgress();
          },
        });

        // Verify the upload via content_hash.
        if (metadata.content_hash !== contentHasher.digest()) {
          return yield* new ExportError({
            message: `Upload verification failed for video ${entry.videoId}: content_hash mismatch`,
          });
        }

        return {
          videoId: entry.videoId,
          sha256: sha256Hash.digest("hex"),
          bytes: streamedBytes,
        };
      }),
    { concurrency: uploadConcurrencyLimit }
  );

  const videoAssets = new Map(
    receipts.map((receipt) => [
      receipt.videoId,
      { sha256: receipt.sha256, bytes: receipt.bytes },
    ])
  );

  // The manifest is built last because it carries every Video's SHA256 and
  // byte count, and those are only known once the bytes have gone past.
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
