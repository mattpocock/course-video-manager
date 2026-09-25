import { Effect } from "effect";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { clipMockupFileExists } from "@/services/clip-mockup-files";
import {
  clipMockupAudioUrl,
  clipMockupFrameUrl,
} from "@/features/clip-mockups/clip-mockup-frame-url";
import { makeLoader } from "@/services/route-action.server";
import {
  VIDEO_FORMAT_DIMENSIONS,
  resolveVideoFormat,
} from "@/features/videos/video-format";
import { AnimaticPlayer } from "@/features/animatic/animatic-player";
import type { AnimaticClipMockup } from "@/features/animatic/animatic-timeline";
import { AnimaticEmptyState } from "@/features/animatic/animatic-empty-state";
import type { Route } from "./+types/_app.videos.$videoId.animatic";

/**
 * `/videos/:videoId/animatic` — the author watches the Lesson from the
 * student's seat.
 *
 * ONE TAB OF THE VIDEO, inside the `_app` layout, so it carries the same
 * breadcrumb and PREVIOUS/NEXT as every other page of a Video. An Animatic is
 * watched a Lesson at a time and the note it produces is per Video, so walking
 * the Lesson's Videos in order is the whole motion; a page of its own outside
 * the layout made that a trip back through the editor.
 *
 * `fullscreen`, like every other page of a Video: the frame is the thing being
 * judged, so the left sidebar folds away to the floating button and the width
 * goes to the picture.
 */
export const handle = { fullscreen: true };

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const clipMockupOps = yield* ClipMockupOperationsService;

      // The flat row: the page needs a `lineageId`, a title and a format,
      // and no part of the Lesson/Section/Version chain above them (#1671).
      const video = yield* videoOps.getVideoRowById(videoId);
      const rows = yield* clipMockupOps.listClipMockupsByVideoId(videoId);

      // Every file is checked HERE, once, before anything plays. A frame or a
      // WAV the row names but the disk does not have has to be reported as
      // missing — a Clip Mockup that silently plays as a black rectangle reads
      // as a bad frame rather than as a broken file, and the author would go
      // looking in the wrong place.
      const mockups: AnimaticClipMockup[] = yield* Effect.all(
        rows.map((row, index) =>
          Effect.gen(function* () {
            const imageExists = yield* clipMockupFileExists(
              video.lineageId,
              row.imagePath
            ).pipe(Effect.catchAll(() => Effect.succeed(false)));

            const audioExists = yield* clipMockupFileExists(
              video.lineageId,
              row.audioPath
            ).pipe(Effect.catchAll(() => Effect.succeed(false)));

            return {
              id: row.id,
              line: row.line,
              position: index + 1,
              durationSeconds: row.durationSeconds,
              imageUrl: clipMockupFrameUrl(row.id),
              audioUrl: clipMockupAudioUrl(row.id),
              imageMissing: !imageExists,
              audioMissing: !audioExists,
            } satisfies AnimaticClipMockup;
          })
        )
      );

      return {
        video: {
          id: video.id,
          title: video.title,
          format: resolveVideoFormat(video.format),
        },
        mockups,
      };
    }),
});

export default function AnimaticRoute({ loaderData }: Route.ComponentProps) {
  const { video, mockups } = loaderData;
  const { width, height } = VIDEO_FORMAT_DIMENSIONS[video.format];

  // An Animatic is WATCHED WHILE IT IS STILL BEING WRITTEN — an agent redraws a
  // frame or rewrites a line in the background, and the author should see it on
  // the next loop rather than after a reload. Same hook, same shape as the
  // Course view, plus a short interval because the edits arrive one at a time.
  //
  // The poll is only safe because `useStableMockups` in the player holds the
  // rows by value: a revalidation that found no change reaches the Player as
  // the identical props it already has, so playback is never restarted. Do not
  // remove that guard while this poll exists.
  useFocusRevalidate({ intervalMs: 2000 });

  if (mockups.length === 0) {
    return <AnimaticEmptyState videoId={video.id} />;
  }

  return <AnimaticPlayer mockups={mockups} width={width} height={height} />;
}
