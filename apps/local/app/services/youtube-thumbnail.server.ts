import { Data, Effect } from "effect";
import { existsSync } from "node:fs";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { locateStoredVideoFile } from "@/services/video-files";

/**
 * The Thumbnail a YouTube upload sends: one made in the CVM, for this Video,
 * never an arbitrary image. Both the `youtube` Job (the Sidecar, before it
 * sends anything) and `cvm video post-youtube` (before it queues anything)
 * ask this one question, so they can never disagree about which Thumbnails
 * may go out.
 */

export type ThumbnailRefusal =
  /** No Thumbnail has this id. */
  | "not-found"
  /** The Thumbnail is another Video's. */
  | "other-video"
  /** The Thumbnail was never rendered to a file. */
  | "no-file"
  /** The author deleted it: an archived Thumbnail is never uploaded. */
  | "archived";

/** The Thumbnail cannot be uploaded with this Video. */
export class ThumbnailNotUploadableError extends Data.TaggedError(
  "ThumbnailNotUploadableError"
)<{
  readonly thumbnailId: string;
  readonly videoId: string;
  readonly reason: ThumbnailRefusal;
  readonly message: string;
}> {}

const REFUSAL_MESSAGES: Record<ThumbnailRefusal, string> = {
  "not-found": "no Thumbnail has this id",
  "other-video": "it is another Video's Thumbnail",
  "no-file": "it has no rendered file",
  archived: "it was deleted (archived)",
};

export interface UploadableThumbnail {
  readonly id: string;
  /** As the row stores it (root-relative on a Storage Root, ADR 0040). */
  readonly storedPath: string;
  /** Where it is on disk; the stored path when no Storage Root has it. */
  readonly path: string;
  /** Whether the file is there now. */
  readonly onDisk: boolean;
  readonly selectedForUpload: boolean;
}

export const loadUploadableThumbnail = Effect.fn("loadUploadableThumbnail")(
  function* (input: {
    readonly thumbnailId: string;
    readonly videoId: string;
  }) {
    const thumbnails = yield* ThumbnailOperationsService;
    const thumbnail = yield* thumbnails
      .getThumbnailById(input.thumbnailId)
      .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null)));
    const refuse = (reason: ThumbnailRefusal) =>
      new ThumbnailNotUploadableError({
        thumbnailId: input.thumbnailId,
        videoId: input.videoId,
        reason,
        message: `Thumbnail ${input.thumbnailId} cannot be uploaded with Video ${input.videoId}: ${REFUSAL_MESSAGES[reason]}. Pick one of this Video's own Thumbnails: 'cvm thumbnail list --video ${input.videoId}'.`,
      });
    if (!thumbnail) return yield* refuse("not-found");
    if (thumbnail.videoId !== input.videoId) {
      return yield* refuse("other-video");
    }
    if (thumbnail.archivedAt) return yield* refuse("archived");
    if (!thumbnail.filePath) return yield* refuse("no-file");
    const located = locateStoredVideoFile(thumbnail.filePath);
    return {
      id: thumbnail.id,
      storedPath: thumbnail.filePath,
      path: located ?? thumbnail.filePath,
      onDisk: located !== null && existsSync(located),
      selectedForUpload: thumbnail.selectedForUpload,
    } satisfies UploadableThumbnail;
  }
);
