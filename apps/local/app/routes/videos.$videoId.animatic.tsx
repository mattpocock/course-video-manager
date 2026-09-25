import { Effect } from "effect";
import { Link } from "react-router";
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
import type { Route } from "./+types/videos.$videoId.animatic";

/**
 * `/videos/:videoId/animatic` — the author watches the Lesson from the
 * student's seat.
 *
 * DELIBERATELY OUTSIDE THE `_app` LAYOUT. The `handle: { fullscreen: true }`
 * escape hatch the editor's sub-routes use still leaves a floating sidebar
 * rail on screen, and an Animatic is watched, not edited: the same choice
 * `teleprompter.tsx` and the Diagram Playground make.
 */

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

  if (mockups.length === 0) {
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black px-8 text-center text-white">
        <h1 className="text-xl font-semibold">{video.title}</h1>
        <p className="max-w-lg text-sm text-white/70">
          This Video has no Clip Mockups yet, so there is no Animatic to watch.
          Author them with{" "}
          <code className="font-mono">cvm clip-mockup add</code> and this page
          will play them in order.
        </p>
        <Link
          to={`/videos/${video.id}/edit`}
          className="rounded-md border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
        >
          Back to the editor
        </Link>
      </main>
    );
  }

  return <AnimaticPlayer mockups={mockups} width={width} height={height} />;
}
