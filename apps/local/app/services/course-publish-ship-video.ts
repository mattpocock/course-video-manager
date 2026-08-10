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
  cancelledExports?: {
    restore: (videoId: string) => Effect.Effect<void, ExportError>;
  };
  remoteFilesByPath: Map<string, DropboxFileMetadata>;
  remoteVideoPath: (entry: VideoEntry) => string;
  plannedSourceOf: (entry: VideoEntry) => ReusableSource | undefined;
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
    cancelledExports,
    remoteFilesByPath,
    remoteVideoPath,
    plannedSourceOf,
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
   * Publish was discarded. Reuse makes that common rather than rare, because
   * the plan that put the Video there is the same plan that cancelled its
   * re-encode.
   *
   * The previous Bundle answers it. Its manifest owes the new one this Video's
   * SHA256 and byte count; its listing gives the content hash the landed file
   * must carry. One comparison, and not a byte read from disk or wire.
   *
   * Weaker than `adoptLandedVideo`, and deliberately second to it: where the
   * source and destination are the same file — an unchanged re-Publish, which
   * lands in the same Bundle — the comparison is of a file with itself and
   * cannot detect tampering. Only local bytes can do that, so wherever they
   * exist they are used instead.
   */
  const adoptFromPlan = Effect.fn("adoptVideoFromReusePlan")(function* (
    entry: VideoEntry,
    remoteFile: DropboxFileMetadata,
    source: ReusableSource
  ) {
    // Same Export Hash means identical bytes by construction, so the two
    // hashes must agree. Disagreement is an immutability violation, exactly
    // as it is for a locally-checked adoption, and is never overwritten.
    if (
      remoteFile.content_hash !== source.contentHash ||
      remoteFile.size !== source.bytes
    ) {
      return yield* new ExportError({
        message: `Immutable asset bundle conflict for video ${entry.videoId}`,
      });
    }
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
    function* (
      entry: VideoEntry,
      awaitVideoReady: (videoId: string) => Effect.Effect<void, ExportError>
    ) {
      // The handoff: this Video's own export, and nothing else's.
      yield* awaitVideoReady(entry.videoId);

      const remoteFile = remoteFilesByPath.get(
        remoteVideoPath(entry).toLowerCase()
      );
      const plannedSource = plannedSourceOf(entry);

      let receipt: { sha256: string; bytes: number };
      let onDisk = yield* effectFs.exists(entry.localPath);

      // The local file is the STRONGER witness, so it is always preferred
      // where it exists: it was produced from this Video's Clips, whereas the
      // plan can only report what Dropbox already holds. Adopting from the
      // plan is the fallback for the case that used to have no answer at all.
      if (!onDisk && remoteFile && plannedSource) {
        receipt = yield* adoptFromPlan(entry, remoteFile, plannedSource);
      } else {
        // A Video the plan cancelled the encode for has arrived here with no
        // file and nothing at its address, which means its copy did not
        // happen — the source vanished, or the batch would not run. Nothing
        // else will ever produce these bytes, so "fall back to upload" has to
        // mean encoding it now. Without this the saving would turn a slow
        // Publish into a failed one.
        if (!onDisk && plannedSource && cancelledExports) {
          yield* cancelledExports.restore(entry.videoId);
          onDisk = yield* effectFs.exists(entry.localPath);
        }

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
