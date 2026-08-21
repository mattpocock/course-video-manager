import { Effect, Stream } from "effect";
import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { ExportError } from "./course-publish-errors";
import {
  extractErrorMessage,
  type EmitPublishDetailEvent,
} from "./course-publish-export-events";
import {
  uploadFileFromDisk,
  type DropboxFileMetadata,
} from "./dropbox-http-client";
import type { ReusableSource } from "./course-publish-reuse-plan";
import { DropboxContentHasher } from "./dropbox-content-hash";
import { readExportDigest, writeExportDigest } from "./export-sha256-sidecar";

/**
 * One Video's place in the bundle, all of it read off the DATABASE: where it
 * lands inside the bundle, which local file it comes from, and the Export Hash
 * that addresses that file. Knowable before a single frame has been encoded.
 */
export type VideoEntry = {
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
    // Bytes alone cannot say how long a file plays for. Whoever needs the
    // duration measures it; this read is not the place to shell out to ffprobe.
    durationInSeconds: null,
  };
});

/**
 * Everything one Video's trip through `shipVideo` needs from the enclosing
 * `syncFrozenCourseVersionToDropbox` — split out here purely to keep that
 * module under the repo's file-token budget. This is a factory rather than a
 * bag of free functions because every one of these callbacks closes over
 * mutable state (`videoByteSizes`, `uploadedByVideo`, `missingVideos`) that
 * the caller owns and reads back after the upload pool finishes.
 */
export function createShipVideo(deps: {
  effectFs: FileSystem.FileSystem;
  accessToken: string;
  onDetailEvent?: EmitPublishDetailEvent;
  remoteFilesByPath: Map<string, DropboxFileMetadata>;
  remoteVideoPath: (entry: VideoEntry) => string;
  /**
   * The previous Bundle's numbers for a landed file, found by the Byte Hash
   * Dropbox reports for it. See `adoptFromPlan`.
   */
  plannedSourceOf: (
    remoteFile: DropboxFileMetadata
  ) => ReusableSource | undefined;
  /**
   * Offer a Video with its export on disk to the copy batch, and answer
   * whether the batch took it. A Video it took sends nothing from here: the
   * caller issues one `copy_batch_v2` for the whole bundle once every export
   * has landed, and marks this Video complete when its copy does.
   */
  offerToCopyBatch: (entry: VideoEntry) => Effect.Effect<boolean>;
  videoByteSizes: Map<string, number>;
  uploadedByVideo: Map<string, number>;
  reportProgress: () => void;
  /** Mutated in place — Videos whose file never appeared are pushed here. */
  missingVideos: Array<{
    videoId: string;
    videoTitle: string;
    lessonPath: string;
  }>;
}) {
  const {
    effectFs,
    accessToken,
    onDetailEvent,
    remoteFilesByPath,
    remoteVideoPath,
    plannedSourceOf,
    offerToCopyBatch,
    videoByteSizes,
    uploadedByVideo,
    reportProgress,
    missingVideos,
  } = deps;

  const emitVideoError = (videoId: string, message: string) =>
    onDetailEvent?.({
      event: "upload-video-error",
      data: { videoId, message },
    });

  /**
   * Adopt a landed Video with NO local file to check it against.
   *
   * This is the case that used to have no answer: an earlier attempt put the
   * Video at its address, and the export it was made from has since been
   * collected — so the manifest's SHA256 could not be recovered and the whole
   * Publish was discarded. It arises only where no export phase runs in front
   * of this one, i.e. the manual re-sync of an already-Published Version.
   *
   * The previous Bundle answers it. The landed file's own Byte Hash finds the
   * previous manifest's entry for those exact bytes, and that entry owes the
   * new manifest their SHA256. One lookup, and not a byte read from disk or
   * wire.
   *
   * Weaker than `adoptLandedVideo`, and deliberately second to it: matching by
   * Byte Hash says only that some earlier manifest described these bytes, and
   * where the source and destination are the same file that is a comparison of
   * a file with itself. Only local bytes can detect tampering, so wherever they
   * exist they are used instead.
   */
  const adoptFromPlan = Effect.fn("adoptVideoFromReusePlan")(function* (
    entry: VideoEntry,
    source: ReusableSource
  ) {
    videoByteSizes.set(entry.videoId, source.bytes);
    uploadedByVideo.set(entry.videoId, source.bytes);
    reportProgress();
    return { sha256: source.sha256, bytes: source.bytes };
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
        onDetailEvent?.({
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

    // Carry forward any duration measured when this file was exported: it is
    // the truncation check's cache, and nothing in an upload can re-derive it.
    const measured = yield* readExportDigest(
      effectFs,
      entry.localPath,
      fileSize
    );
    const digest = {
      sha256: sha256Hash.digest("hex"),
      contentHash,
      bytes: streamedBytes,
      durationInSeconds: measured?.durationInSeconds ?? null,
    };
    // These numbers were free this time — they came off the upload stream. Bank
    // them so a resumed or unchanged re-Publish, which sends nothing and so
    // streams nothing, does not have to read the file back to recover them.
    yield* writeExportDigest(effectFs, entry.localPath, digest);

    return { sha256: digest.sha256, bytes: digest.bytes };
  });

  /** One Video's whole trip: wait for its export, then skip it or send it. */
  const shipVideo = Effect.fn("shipVideo")(
    function* (
      entry: VideoEntry,
      awaitVideoReady: (videoId: string) => Effect.Effect<void, ExportError>
    ) {
      // The handoff: this Video's own export, and nothing else's.
      yield* awaitVideoReady(entry.videoId);

      const remoteFile = remoteFilesByPath.get(
        remoteVideoPath(entry).toLowerCase()
      );
      const plannedSource = remoteFile
        ? plannedSourceOf(remoteFile)
        : undefined;

      let receipt: { sha256: string; bytes: number };
      const onDisk = yield* effectFs.exists(entry.localPath);

      // The local file is the STRONGER witness, so it is always preferred
      // where it exists: it was produced from this Video's Clips, whereas the
      // plan can only report what Dropbox already holds. Adopting from the
      // plan is the fallback for the case that used to have no answer at all.
      if (!onDisk && plannedSource) {
        receipt = yield* adoptFromPlan(entry, plannedSource);
      } else {
        if (!onDisk) {
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

        // Dropbox may already hold these exact bytes, in which case this
        // Video's trip ends here: it is collected into the copy batch and
        // completed when that batch lands. A Video already at its own address
        // is not offered — it needs nothing at all, and is adopted below.
        if (!remoteFile && (yield* offerToCopyBatch(entry))) {
          return null;
        }

        // This Video has a slot and a size: it is uploading, not queued. The
        // size rides along from the very first event so a consumer can weight
        // this Video against its siblings before a byte has moved.
        onDetailEvent?.({
          event: "upload-video-progress",
          data: {
            videoId: entry.videoId,
            uploadedBytes: 0,
            totalBytes: fileSize,
          },
        });

        receipt = remoteFile
          ? yield* adoptLandedVideo(entry, remoteFile, fileSize)
          : yield* streamVideo(entry, fileSize);
      }

      onDetailEvent?.({
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

  return shipVideo;
}
