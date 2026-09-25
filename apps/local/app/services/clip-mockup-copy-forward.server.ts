import { Effect } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { copyClipMockupFiles } from "./clip-mockup-files";

/**
 * The file half of duplicating a Video's Animatic.
 *
 * A Clip Mockup is half a row and half a file. `@cvm/core` copies the rows —
 * it is deployed to a box with no disk, and dependency-cruiser enforces that —
 * so the frames and the WAVs have to be carried over HERE, at the duplicate's
 * call site in `apps/local`, which is the half of the app that owns a machine.
 *
 * Both duplicate paths land on this module: `POST /api/videos/:videoId/copy`
 * for one Video, and `POST /api/courses/:courseId/duplicate` for every Video
 * in a Course. The Draft Version snapshot path deliberately does NOT — it
 * copies `lineageId`, so source and copy already share one directory.
 */

/** A duplicated Video, paired with the Video it was copied from. */
export interface DuplicatedVideo {
  /** The SOURCE Video's `lineageId` — the directory the files are in today. */
  readonly sourceLineageId: string;
  /** The DUPLICATE's own `lineageId` — the directory they have to reach. */
  readonly newLineageId: string;
  /** The duplicate's row id, whose Clip Mockups name the files to carry. */
  readonly newVideoId: string;
}

/**
 * Carry one duplicated Video's frames and speech across, and say how many
 * files landed.
 *
 * The paths come from the DUPLICATE's own Clip Mockup rows, read the way the
 * Animatic reads them — non-archived, in order. That is what satisfies "an
 * archived Clip Mockup's files are not copied" without a second filter: an
 * archived row is never copied forward, so nothing ever names its frame.
 */
export const copyClipMockupAssetsForVideo = Effect.fn(
  "copyClipMockupAssetsForVideo"
)(function* (video: DuplicatedVideo) {
  const clipMockupOps = yield* ClipMockupOperationsService;
  const rows = yield* clipMockupOps.listClipMockupsByVideoId(video.newVideoId);
  if (rows.length === 0) return 0;

  return yield* copyClipMockupFiles(
    video.sourceLineageId,
    video.newLineageId,
    rows.flatMap((row) => [row.imagePath, row.audioPath])
  );
});

/** The same, for every Video a duplicated Course produced. */
export const copyClipMockupAssetsForVideos = Effect.fn(
  "copyClipMockupAssetsForVideos"
)(function* (videos: readonly DuplicatedVideo[]) {
  const counts = yield* Effect.forEach(videos, copyClipMockupAssetsForVideo);
  return counts.reduce((total, n) => total + n, 0);
});
