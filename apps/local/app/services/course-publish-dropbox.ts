import { Config, Effect, Either } from "effect";
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
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { ExportError, PublishValidationError } from "./course-publish-errors";
import type { EmitPublishDetailEvent } from "./course-publish-export-events";
import {
  uploadFile,
  getMetadata,
  listFolder,
  copyBatch,
  type DropboxFileMetadata,
} from "./dropbox-http-client";
import {
  planBundleReuse,
  type ReusableSource,
} from "./course-publish-reuse-plan";
import { getValidDropboxAccessToken } from "./dropbox-auth-service";
import { uploadConcurrency } from "./dropbox-upload-config";
import { createShipVideo, type VideoEntry } from "./course-publish-ship-video";
import { ensureExportDigest } from "./export-sha256-sidecar";

/**
 * The handoff for a sync with no export phase in front of it — the manual
 * re-sync of an already-Published Version. Every Video's bytes are either on
 * disk already or missing, and no latch will ever change that.
 */
export const noExportPhase = (): Effect.Effect<void, ExportError> =>
  Effect.void;

/** Where a Course's Bundles live. */
const resolveDropboxCourseDir = (courseName: string) =>
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
}) {
  const effectFs = yield* FileSystem.FileSystem;
  const versionOps = yield* VersionOperationsService;
  const finishedVideosDirectory = yield* Config.string(
    "FINISHED_VIDEOS_DIRECTORY"
  );
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

  const dropboxCourseDir = yield* resolveDropboxCourseDir(
    repoWithSections.name
  );

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
  // matched here are copied inside Dropbox rather than sent from this machine
  // — matched by BYTE HASH, so a re-export is never mistaken for the file it
  // replaces. Drawn here and consulted per Video, because a Video's
  // copyability is knowable only once its own export has landed.
  const reusePlan = yield* planBundleReuse({ accessToken, dropboxCourseDir });

  /**
   * The previous manifest's numbers for a file already sitting at this
   * Publish's address, found by the Byte Hash Dropbox reports for it. Only
   * reached where this machine holds no export to digest — see
   * `adoptFromPlan`.
   */
  const plannedSourceOf = (remoteFile: DropboxFileMetadata) =>
    reusePlan.get(remoteFile.content_hash);

  /**
   * Which Videos Dropbox can produce from its own storage, and the numbers the
   * new manifest is owed for each.
   *
   * The receipt is deliberately separate from the source. The source says
   * WHERE to copy from; the receipt says WHICH BYTES the release carries, and
   * that answer always comes from the local Export Digest rather than from the
   * previous manifest. That is what makes a re-export reach Dropbox: the bytes
   * on disk decide, and the receipt then describes the bytes actually shipped.
   */
  const reusableByVideoId = new Map<
    string,
    {
      entry: VideoEntry;
      source: ReusableSource;
      receipt: { sha256: string; bytes: number };
    }
  >();

  /** Videos the copy batch would not take. They upload, and are never copied. */
  const copyRefused = new Set<string>();

  /** Book a Video in, if its own bytes say it is copyable. */
  const considerForCopyBatch = Effect.fn("considerForCopyBatch")(function* (
    entry: VideoEntry
  ) {
    if (copyRefused.has(entry.videoId)) return false;
    // The Byte Hash of the export on THIS machine. A Video that has been
    // re-exported hashes differently from the file the previous Bundle holds
    // at the same Export Hash, and so is not copyable.
    const local = yield* ensureExportDigest(effectFs, entry.localPath, null);
    if (!local) return false;
    const source = reusePlan.get(local.contentHash);
    if (!source) return false;
    reusableByVideoId.set(entry.videoId, {
      entry,
      source,
      receipt: { sha256: local.sha256, bytes: local.bytes },
    });
    return true;
  });

  /**
   * Videos that left the upload pool on the strength of the copy batch. One
   * that did so BEFORE the batch was issued may be one the batch then would
   * not take, and nothing else is left to send it — so those, and only those,
   * take a second trip through the pool.
   */
  const steppedOutOfPool = new Set<string>();

  const offerToCopyBatch = (entry: VideoEntry) =>
    Effect.map(considerForCopyBatch(entry), (taken) => {
      if (taken) steppedOutOfPool.add(entry.videoId);
      return taken;
    });

  // Sizes come from stat, not from a read, and only once a Video's export has
  // landed — so under pipelining they arrive one at a time rather than upfront.
  const videoByteSizes = new Map<string, number>();

  // Byte-weighted progress across every Video in the bundle. Uploads report
  // interleaved once several are in flight, so the aggregate is recomputed
  // from the per-Video counters rather than accumulated as they complete.
  // EVERY Video is in here, including the ones that turn out to be copyable:
  // which those are is not known until their exports land, and a denominator
  // that shrank underneath a running percentage would make it go backwards. A
  // copied Video is simply marked complete when its copy lands.
  const uploadedByVideo = new Map<string, number>(
    videoEntries.map((entry) => [entry.videoId, 0])
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
  // per Video, after its handoff — so other Videos may already have shipped by
  // the time one turns up missing. Harmless: the caller Discards without
  // writing a manifest, and the half-written bundle is resumed rather than
  // rejected by the next attempt.
  const missingVideos: Array<{
    videoId: string;
    videoTitle: string;
    lessonPath: string;
  }> = [];

  // One Video's whole trip — wait for its export, then adopt or stream it —
  // lives in its own module purely to keep this one under the repo's
  // file-token budget. See course-publish-ship-video.ts for the adoption and
  // streaming strategies and why a failure there is attributed to its own
  // Video rather than to the Publish as a whole.
  const shipVideo = createShipVideo({
    effectFs,
    accessToken,
    onDetailEvent: input.onDetailEvent,
    remoteFilesByPath,
    remoteVideoPath,
    plannedSourceOf,
    offerToCopyBatch,
    videoByteSizes,
    uploadedByVideo,
    reportProgress,
    missingVideos,
  });

  /** Receipts owed to the manifest by Videos that were copied, not sent. */
  const copyReceipts = new Map<string, { sha256: string; bytes: number }>();

  /**
   * Ask Dropbox to duplicate every reusable Video inside its own storage.
   *
   * One batch call for the whole bundle, issued beside the upload pool. The
   * route is asynchronous even for a single entry, so the wait is
   * unconditional — but it is a wait on Dropbox's own block copy, not on 25 GB
   * leaving this machine.
   *
   * Returns the Videos that must be uploaded after all. A source that vanished
   * between the plan and the copy is ordinary and falls back quietly; a copy
   * whose content hash does not match its source is an identity failure and
   * fails the Publish, exactly as a mismatched adoption does.
   *
   * The manifest receipt for each copy was settled when the Video was offered
   * to this batch, from its local Export Digest. The previous Bundle's SHA256
   * is never copied forward.
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
    // A Video the batch would not take must move real bytes after all. It is
    // refused HERE rather than after the batch returns, because a Video still
    // queued for an upload slot reads this on its own turn and must never be
    // offered to a batch that has already gone.
    const refuse = (entry: VideoEntry) => {
      copyRefused.add(entry.videoId);
      return entry;
    };
    if (results === null) return shipments.map((s) => refuse(s.entry));

    const fallbacks: VideoEntry[] = [];
    for (const [index, shipment] of shipments.entries()) {
      const result = results[index];
      if (!result?.ok) {
        fallbacks.push(refuse(shipment.entry));
        continue;
      }
      if (result.metadata.content_hash !== shipment.source.contentHash) {
        return yield* new ExportError({
          message: `Copy verification failed for video ${shipment.entry.videoId}: content_hash mismatch`,
        });
      }
      copyReceipts.set(shipment.entry.videoId, shipment.receipt);
      // Every Video is in the byte-weighted denominator, copyable or not, so
      // a copy left at zero would leave a Publish that copied everything
      // reporting 0%. Its bytes are in the bundle: they are delivered.
      videoByteSizes.set(shipment.entry.videoId, shipment.receipt.bytes);
      uploadedByVideo.set(shipment.entry.videoId, shipment.receipt.bytes);
      reportProgress();
      input.onDetailEvent?.({
        event: "upload-video-reused",
        data: {
          videoId: shipment.entry.videoId,
          bytes: shipment.receipt.bytes,
        },
      });
    }
    return fallbacks;
  });

  // ── The two pools ─────────────────────────────────────────────────────────
  // Each Video gets the whole trip, win or lose: shipVideo is wrapped in Either
  // so one Video's rejected upload fails ITS slot without Effect.forEach's
  // default fail-fast interrupting siblings still mid-transfer. Losing that
  // would mean a Video that finished successfully never gets to report its own
  // `upload-video-complete` — exactly the "belongs to that Video by name"
  // guarantee shipVideo's own error handler documents. The first failure is
  // re-raised below, once every Video has had its turn.
  //
  // Every Video goes through here, because no encode is cancelled any more and
  // so nothing is known to be copyable until its own export lands (#1562). A
  // Video that turns out to be copyable steps out without sending anything;
  // the rest upload the moment their own export lands, so export and upload
  // still overlap. The copy batch runs BESIDE this pool — see `copyPipeline`.
  const uploadPool = Effect.forEach(
    videoEntries,
    (entry) => Effect.either(shipVideo(entry, input.awaitVideoReady)),
    { concurrency: uploadConcurrencyLimit }
  );

  /**
   * Decide every Video's copyability, then issue the one batch.
   *
   * Deciding runs unbounded, per Video, the moment that Video's own export
   * lands — so the copyable set is whole when the EXPORT pool drains, not when
   * the upload pool does. Left to each Video's turn in the bounded upload pool
   * the batch would sit behind every upload and miss any Video still queued.
   * Nothing here moves bytes: it reads the Export Digest beside a file already
   * on disk. A Video at its own address is adopted, not copied.
   */
  const copyPipeline = Effect.gen(function* () {
    yield* Effect.forEach(
      videoEntries,
      (entry) =>
        Effect.ignore(
          Effect.gen(function* () {
            yield* input.awaitVideoReady(entry.videoId);
            const landed = remoteFilesByPath.has(
              remoteVideoPath(entry).toLowerCase()
            );
            if (landed || !(yield* effectFs.exists(entry.localPath))) return;
            yield* considerForCopyBatch(entry);
          })
        ),
      { concurrency: "unbounded", discard: true }
    );
    return yield* copyPhase();
  });

  const [shipResults, refusedEntries] = yield* Effect.all(
    [uploadPool, copyPipeline],
    { concurrency: 2 }
  );

  // A Video that left the pool for a batch that then refused it has nothing
  // else to send it. One still queued when the batch was issued needs no
  // second trip: `copyRefused` already named it by the time its turn came.
  const fallbackEntries = refusedEntries.filter((entry) =>
    steppedOutOfPool.has(entry.videoId)
  );
  const fallbackResults = yield* Effect.forEach(
    fallbackEntries,
    (entry) => Effect.either(shipVideo(entry, input.awaitVideoReady)),
    { concurrency: uploadConcurrencyLimit }
  );
  const allResults = [...shipResults, ...fallbackResults];
  const receipts = allResults
    .filter(Either.isRight)
    .map((result) => result.right);
  const shipFailure = allResults.find(Either.isLeft);

  if (missingVideos.length > 0) return { missingVideos };

  if (shipFailure) {
    return yield* Effect.fail(shipFailure.left);
  }

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
