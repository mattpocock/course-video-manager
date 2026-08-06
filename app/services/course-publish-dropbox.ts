import { Config, Effect, Stream } from "effect";
import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  buildCourseJson,
  buildCourseJsonSchema,
  computeEffectiveSections,
} from "@/packages/course-json";
import {
  computeExportHash,
  resolveExportPath,
  toExportClips,
} from "./export-hash";
import { VersionOperationsService } from "./db-version-operations.server";
import { ExportError, PublishValidationError } from "./course-publish-errors";
import {
  extractErrorMessage,
  type EmitPublishDetailEvent,
} from "./course-publish-export-events";
import {
  uploadFile,
  uploadFileFromDisk,
  getMetadata,
  listFolder,
  copyBatch,
  type DropboxFileMetadata,
} from "./dropbox-http-client";
import {
  planBundleReuse,
  type ReusePlan,
  type ReusableSource,
} from "./course-publish-reuse-plan";
import { DropboxContentHasher } from "./dropbox-content-hash";
import { getValidDropboxAccessToken } from "./dropbox-auth-service";
import { uploadConcurrency } from "./dropbox-upload-config";
import { readExportDigest, writeExportDigest } from "./export-sha256-sidecar";

/**
 * One Video's place in the bundle, all of it read off the DATABASE: where it
 * lands inside the bundle, which local file it comes from, and the Export Hash
 * that addresses that file. Knowable before a single frame has been encoded.
 */
type VideoEntry = {
  videoId: string;
  videoTitle: string;
  lessonPath: string;
  localPath: string;
  relativeAssetPath: string;
  exportHash: string | null;
};

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

/**
 * The handoff for a sync with no export phase in front of it — the manual
 * re-sync of an already-Published Version. Every Video's bytes are either on
 * disk already or missing, and no latch will ever change that.
 */
export const noExportPhase = (): Effect.Effect<void, ExportError> =>
  Effect.void;

/**
 * Where a Course's Bundles live. Exported because the reuse plan has to be
 * drawn BEFORE the export pool starts, which is upstream of this module.
 */
export const resolveDropboxCourseDir = (courseName: string) =>
  Config.string("DROPBOX_REMOTE_PATH").pipe(
    Effect.map((remotePath) => `${remotePath}/${courseName}`)
  );

export const syncFrozenCourseVersionToDropbox = Effect.fn(
  "syncFrozenCourseVersionToDropbox"
)(function* (input: {
  courseId: string;
  courseVersionId: string;
  includeTodoLessons: boolean;
  /**
   * The observable surface of the upload: the bundle-wide `progress`
   * percentage plus one task's worth of events per shipping Video.
   */
  onDetailEvent?: EmitPublishDetailEvent;
  /**
   * The handoff queue out of the export pool. A Video's upload waits on this
   * before touching its file, so a Publish can start shipping the Videos that
   * have finished encoding while the rest are still on the GPU. It fails if
   * that Video's export failed, which fails this sync.
   *
   * Required rather than optional: omitting it would silently mean "every
   * Video is ready", i.e. upload-before-export, which is a race rather than a
   * type error. The manual re-sync path says so explicitly with
   * `noExportPhase`.
   */
  awaitVideoReady: (videoId: string) => Effect.Effect<void, ExportError>;
  /**
   * Which Videos already exist in the previously Published Bundle, keyed by
   * Export Hash. The caller computes this when it wants to act on it BEFORE
   * the export pool starts — a reused Video needs no encoding, so a Publish
   * that knows the plan up front can drop it from the export roster entirely.
   *
   * Omitted by the manual re-sync, which has no export phase to inform and so
   * simply lets this function work the plan out for itself.
   */
  reusePlan?: ReusePlan;
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

  const dropboxCourseDir = `${dropboxRemotePath}/${repoWithSections.name}`;

  // The Export Hash is the recipe an Exported Video is addressed by — Clip
  // filenames, source timings, order, Video Format and the Export Version Key —
  // and is pure database state, which is what lets the bundle path below be
  // knowable up front too. Whether a Video's file has actually appeared yet is
  // checked per Video, after its handoff.
  const videoEntries: VideoEntry[] = effectiveSections.flatMap((section) =>
    section.lessons.flatMap((lesson) =>
      lesson.videos.map((video) => {
        const exportHash =
          video.clips.length > 0
            ? computeExportHash(toExportClips(video.clips), video.format)
            : null;
        return {
          videoId: video.id,
          videoTitle: video.title,
          lessonPath: lesson.path,
          localPath: exportHash
            ? resolveExportPath(
                finishedVideosDirectory,
                input.courseId,
                exportHash
              )
            : path.join(finishedVideosDirectory, `${video.id}.mp4`),
          relativeAssetPath: `${section.path}/${lesson.path}/${video.title}.mp4`,
          exportHash,
        };
      })
    )
  );

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

  const remoteVideoPath = (entry: VideoEntry) =>
    `${remoteBundleDir}/${entry.relativeAssetPath}`;

  // ── The reuse plan ────────────────────────────────────────────────────────
  // What the previously Published Bundle can hand this one for free. Videos
  // matched here are copied inside Dropbox rather than sent from this machine.
  const reusePlan =
    input.reusePlan ??
    (yield* planBundleReuse({ accessToken, dropboxCourseDir }));

  const reusableByVideoId = new Map<
    string,
    { entry: VideoEntry; source: ReusableSource }
  >();
  for (const entry of videoEntries) {
    // A Video with no Clips has no Export Hash and no file anywhere. Nothing
    // identifies its bytes, so nothing can be reused for it.
    if (!entry.exportHash) continue;
    // Precedence: a file already at this Publish's own address needs nothing
    // at all, so the resume listing wins over the plan.
    if (remoteFilesByPath.has(remoteVideoPath(entry).toLowerCase())) continue;
    const source = reusePlan.get(entry.exportHash);
    if (!source) continue;
    reusableByVideoId.set(entry.videoId, { entry, source });
  }

  // Everything the upload pool is still responsible for. A reused Video is not
  // in here, so it neither waits for an export nor occupies an upload slot.
  const uploadingEntries = videoEntries.filter(
    (entry) => !reusableByVideoId.has(entry.videoId)
  );

  // Announced before a frame is encoded or a byte moves, so the size of the
  // saving is visible in the first second of the Publish rather than at the
  // end of it.
  if (reusableByVideoId.size > 0) {
    input.onDetailEvent?.({
      event: "upload-videos-reused",
      data: {
        videos: Array.from(reusableByVideoId.values()).map(
          ({ entry, source }) => ({ id: entry.videoId, bytes: source.bytes })
        ),
      },
    });
  }

  // Sizes come from stat, not from a read, and only once a Video's export has
  // landed — so under pipelining they arrive one at a time rather than upfront.
  const videoByteSizes = new Map<string, number>();

  // Byte-weighted progress across every Video in the bundle. Uploads report
  // interleaved once several are in flight, so the aggregate is recomputed
  // from the per-Video counters rather than accumulated as they complete.
  // Reused Videos are deliberately absent: their bytes never cross the wire,
  // so counting them would make the percentage describe work nobody is doing.
  // A Video whose copy fails is added back here when it rejoins the queue.
  const uploadedByVideo = new Map<string, number>(
    uploadingEntries.map((entry) => [entry.videoId, 0])
  );
  let lastReportedPercentage = 0;
  const reportProgress = () => {
    const knownSizes = Array.from(videoByteSizes.values());
    if (knownSizes.length === 0) return;
    const knownTotal = knownSizes.reduce((sum, bytes) => sum + bytes, 0);
    // A Video still encoding has no size yet. Standing it in at the mean of
    // the Videos already measured keeps the denominator from collapsing to
    // whatever has landed so far, which would otherwise read as ~100% the
    // moment the first Video finishes. Once every size is known this is
    // exactly the byte-weighted total.
    const meanKnown = knownTotal / knownSizes.length;
    const denominator =
      knownTotal + (uploadedByVideo.size - knownSizes.length) * meanKnown;
    if (denominator <= 0) return;
    let uploaded = 0;
    for (const bytes of uploadedByVideo.values()) uploaded += bytes;
    const percentage = Math.min(
      Math.round((uploaded / denominator) * 100),
      // 100 is reserved for the commit receipt landing.
      99
    );
    if (percentage <= lastReportedPercentage) return;
    lastReportedPercentage = percentage;
    input.onDetailEvent?.({ event: "progress", data: { percentage } });
  };

  const uploadConcurrencyLimit = yield* uploadConcurrency;

  // Videos whose file never appeared. Under pipelining this is only knowable
  // per Video, after its handoff — so unlike the old upfront disk walk, other
  // Videos may already have shipped by the time one turns up missing. Harmless:
  // the caller Discards without writing a manifest, and the half-written bundle
  // is resumed rather than rejected by the next attempt.
  const missingVideos: Array<{
    videoId: string;
    videoTitle: string;
    lessonPath: string;
  }> = [];

  const emitVideoError = (videoId: string, message: string) =>
    input.onDetailEvent?.({
      event: "upload-video-error",
      data: { videoId, message },
    });

  /**
   * A Video already sitting at its address, put there by a previous attempt.
   * Its SHA256 is still owed to the manifest and nothing streamed it, so the
   * numbers have to come from somewhere other than the upload: the sidecar
   * written when this export was last digested, or — if that is missing or
   * disagrees with the file — one local read that then writes the sidecar for
   * next time. A mismatch against the remote is an immutability violation
   * rather than an interrupted transfer, and is never overwritten.
   */
  const adoptLandedVideo = Effect.fn("adoptLandedVideo")(function* (
    entry: VideoEntry,
    remoteFile: DropboxFileMetadata,
    fileSize: number
  ) {
    const cached = yield* readExportDigest(effectFs, entry.localPath, fileSize);
    const hashes =
      cached ?? (yield* hashFileLocally(effectFs, entry.localPath));
    if (!cached) {
      yield* writeExportDigest(effectFs, entry.localPath, hashes);
    }
    if (
      remoteFile.content_hash !== hashes.contentHash ||
      remoteFile.size !== hashes.bytes
    ) {
      return yield* new ExportError({
        message: `Immutable asset bundle conflict for video ${entry.videoId}`,
      });
    }
    // A resumed Publish counts it as done rather than reporting itself back
    // at zero.
    uploadedByVideo.set(entry.videoId, hashes.bytes);
    reportProgress();
    return { sha256: hashes.sha256, bytes: hashes.bytes };
  });

  /**
   * Send the Video's bytes, digesting them off the same pass — the manifest's
   * proven-source-revision guarantee is met without a separate read.
   */
  const streamVideo = Effect.fn("streamVideoToDropbox")(function* (
    entry: VideoEntry,
    fileSize: number
  ) {
    const sha256Hash = createHash("sha256");
    const contentHasher = new DropboxContentHasher();
    let streamedBytes = 0;

    const metadata = yield* uploadFileFromDisk({
      accessToken,
      path: remoteVideoPath(entry),
      filePath: entry.localPath,
      fileSize,
      onChunk: (chunk) => {
        sha256Hash.update(chunk);
        contentHasher.update(chunk);
        streamedBytes += chunk.byteLength;
      },
      onProgress: (uploaded, total) => {
        uploadedByVideo.set(entry.videoId, uploaded);
        reportProgress();
        input.onDetailEvent?.({
          event: "upload-video-progress",
          data: {
            videoId: entry.videoId,
            uploadedBytes: uploaded,
            totalBytes: total,
          },
        });
      },
    });

    const contentHash = contentHasher.digest();
    if (metadata.content_hash !== contentHash) {
      return yield* new ExportError({
        message: `Upload verification failed for video ${entry.videoId}: content_hash mismatch`,
      });
    }

    const digest = {
      sha256: sha256Hash.digest("hex"),
      contentHash,
      bytes: streamedBytes,
    };
    // These numbers were free this time — they came off the upload stream. Bank
    // them so a resumed or unchanged re-Publish, which sends nothing and so
    // streams nothing, does not have to read the file back to recover them.
    yield* writeExportDigest(effectFs, entry.localPath, digest);

    return { sha256: digest.sha256, bytes: digest.bytes };
  });

  /** One Video's whole trip: wait for its export, then skip it or send it. */
  const shipVideo = Effect.fn("shipVideo")(
    function* (entry: VideoEntry) {
      // The handoff: this Video's own export, and nothing else's.
      yield* input.awaitVideoReady(entry.videoId);

      if (!(yield* effectFs.exists(entry.localPath))) {
        missingVideos.push({
          videoId: entry.videoId,
          videoTitle: entry.videoTitle,
          lessonPath: entry.lessonPath,
        });
        emitVideoError(entry.videoId, "No exported file to upload");
        return null;
      }

      const fileSize = Number((yield* effectFs.stat(entry.localPath)).size);
      videoByteSizes.set(entry.videoId, fileSize);
      // This Video has a slot and a size: it is uploading, not queued. The
      // size rides along from the very first event so a consumer can weight
      // this Video against its siblings before a byte has moved.
      input.onDetailEvent?.({
        event: "upload-video-progress",
        data: {
          videoId: entry.videoId,
          uploadedBytes: 0,
          totalBytes: fileSize,
        },
      });

      const remoteFile = remoteFilesByPath.get(
        remoteVideoPath(entry).toLowerCase()
      );
      const receipt = remoteFile
        ? yield* adoptLandedVideo(entry, remoteFile, fileSize)
        : yield* streamVideo(entry, fileSize);

      input.onDetailEvent?.({
        event: "upload-video-complete",
        data: { videoId: entry.videoId, bytes: receipt.bytes },
      });
      return { videoId: entry.videoId, ...receipt };
    },
    // Whatever went wrong for this Video — a missing file, a rejected request,
    // a hash that did not verify — belongs to that Video by name rather than
    // to the Publish as an undifferentiated whole.
    (effect, entry) =>
      Effect.tapError(effect, (error) => {
        emitVideoError(
          entry.videoId,
          extractErrorMessage(error, "Upload failed unexpectedly")
        );
        return Effect.void;
      })
  );

  /** Receipts owed to the manifest by Videos that were copied, not sent. */
  const copyReceipts = new Map<string, { sha256: string; bytes: number }>();

  /**
   * Ask Dropbox to duplicate every reusable Video inside its own storage.
   *
   * One batch call for the whole bundle. The route is asynchronous even for a
   * single entry, so the wait is unconditional — but it is a wait on Dropbox's
   * own block copy, not on 25 GB leaving this machine.
   *
   * Returns the Videos that must be uploaded after all. A source that vanished
   * between the plan and the copy is ordinary and falls back quietly; a copy
   * whose content hash does not match its source is an identity failure and
   * fails the Publish, exactly as a mismatched adoption does.
   */
  const copyPhase = Effect.fn("copyReusedVideos")(function* () {
    const shipments = Array.from(reusableByVideoId.values());
    if (shipments.length === 0) return [] as VideoEntry[];

    const results = yield* copyBatch({
      accessToken,
      entries: shipments.map((shipment) => ({
        fromPath: shipment.source.fromPath,
        toPath: remoteVideoPath(shipment.entry),
      })),
    }).pipe(
      // A batch that could not be launched or polled at all leaves every Video
      // in it to the upload pool. Nothing is lost but the saving.
      Effect.catchTag("DropboxApiError", () => Effect.succeed(null))
    );
    if (results === null) return shipments.map((shipment) => shipment.entry);

    const fallbacks: VideoEntry[] = [];
    for (const [index, shipment] of shipments.entries()) {
      const result = results[index];
      if (!result?.ok) {
        fallbacks.push(shipment.entry);
        continue;
      }
      if (result.metadata.content_hash !== shipment.source.contentHash) {
        return yield* new ExportError({
          message: `Copy verification failed for video ${shipment.entry.videoId}: content_hash mismatch`,
        });
      }
      copyReceipts.set(shipment.entry.videoId, {
        sha256: shipment.source.sha256,
        bytes: shipment.source.bytes,
      });
      input.onDetailEvent?.({
        event: "upload-video-reused",
        data: {
          videoId: shipment.entry.videoId,
          bytes: shipment.source.bytes,
        },
      });
    }
    return fallbacks;
  });

  // The copy runs FIRST, and on its own. It is a wait on Dropbox duplicating
  // its own blocks — seconds — where the upload pool is a wait on tens of
  // gigabytes, so there is nothing to gain by overlapping them and one real
  // thing to lose: a Video whose copy fails has to reach the upload pool, and
  // that pool must not already have finished. Running them in order also
  // leaves every copied file in place before the first upload starts, so an
  // interrupted Publish resumes against a bundle that is further along.
  const fallbackEntries = yield* copyPhase();

  // A Video whose copy failed now joins the byte-weighted denominator it was
  // excluded from, because it is about to move real bytes after all.
  for (const entry of fallbackEntries) uploadedByVideo.set(entry.videoId, 0);

  const receipts = yield* Effect.forEach(
    [...uploadingEntries, ...fallbackEntries],
    shipVideo,
    { concurrency: uploadConcurrencyLimit }
  );

  if (missingVideos.length > 0) return { missingVideos };

  const videoAssets = new Map([
    ...copyReceipts,
    ...receipts
      .filter((receipt) => receipt !== null)
      .map(
        (receipt) =>
          [
            receipt.videoId,
            { sha256: receipt.sha256, bytes: receipt.bytes },
          ] as const
      ),
  ]);

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

  input.onDetailEvent?.({ event: "progress", data: { percentage: 100 } });

  return { missingVideos };
});
