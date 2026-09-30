import { Effect } from "effect";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { ClipMockupCommentOperationsService } from "@/services/db-clip-mockup-comment-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
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
import type { AnimaticChapter } from "@/features/animatic/animatic-chapters";
import {
  AnimaticCommentsProvider,
  type AnimaticComment,
} from "@/features/animatic/animatic-comments";
import type { AnimaticClipMockup } from "@/features/animatic/animatic-timeline";
import {
  sectionRunTime,
  type AnimaticSectionLesson,
} from "@/features/animatic/animatic-section-clock";
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
      const chapterOps = yield* ClipMockupChapterOperationsService;
      const commentOps = yield* ClipMockupCommentOperationsService;

      // The flat row: the page needs a `lineageId`, a title and a format,
      // and no part of the Lesson/Section/Version chain above them (#1671).
      const video = yield* videoOps.getVideoRowById(videoId);
      const rows = yield* clipMockupOps.listClipMockupsByVideoId(videoId);

      // BOTH TABLES, not the merged `listAnimaticOrder`: that read hands back
      // positions alone, and the sidebar prints a Chapter's title. The two
      // lists are merged by their shared `order` key in
      // `buildAnimaticChapterLayout`, where the grouping arithmetic lives.
      const chapterRows =
        yield* chapterOps.listClipMockupChaptersByVideoId(videoId);
      const commentRows =
        yield* commentOps.listClipMockupCommentsByVideoId(videoId);

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
              order: row.order,
              imageUrl: clipMockupFrameUrl(row.id),
              audioUrl: clipMockupAudioUrl(row.id),
              imageMissing: !imageExists,
              audioMissing: !audioExists,
            } satisfies AnimaticClipMockup;
          })
        )
      );

      const sectionLessons = yield* loadSectionLessons(videoId);

      return {
        sectionRunTime: sectionRunTime({
          lessons: sectionLessons,
          currentVideoId: videoId,
          currentDurationsSeconds: rows.map((row) => row.durationSeconds),
        }),
        video: {
          id: video.id,
          title: video.title,
          format: resolveVideoFormat(video.format),
        },
        mockups,
        chapters: chapterRows.map(
          (row) =>
            ({
              id: row.id,
              name: row.name,
              order: row.order,
            }) satisfies AnimaticChapter
        ),
        comments: commentRows.map(
          (row) =>
            ({
              id: row.id,
              clipMockupId: row.clipMockupId,
              clipMockupChapterId: row.clipMockupChapterId,
              body: row.body,
            }) satisfies AnimaticComment
        ),
      };
    }),
});

/**
 * The Lessons of the current Video's Section, in Section order, each Video
 * with the speech durations of its Clip Mockups — what the Section clock sums.
 *
 * The Section is read off the Course's navigation tree, the same tree
 * PREVIOUS/NEXT walks, so the clock counts the Videos NEXT will stop on. The
 * durations are ONE query for the whole Section, not one per Video, because
 * this loader is polled every two seconds. A standalone Video has no Section,
 * and gets an empty list.
 */
const loadSectionLessons = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const courseOps = yield* CourseOperationsService;
    const clipMockupOps = yield* ClipMockupOperationsService;

    const video = yield* videoOps.getVideoWithLessonById(videoId);
    const lesson = video.lesson;
    if (!lesson) return [] as AnimaticSectionLesson[];

    const courseNav = yield* courseOps.getCourseNavigationData(
      lesson.section.repoVersion.repo.id
    );
    const section = (courseNav.versions[0]?.sections ?? []).find(
      (candidate) => candidate.id === lesson.section.id
    );
    if (!section) return [] as AnimaticSectionLesson[];

    const videoIds = section.lessons.flatMap((l) => l.videos.map((v) => v.id));
    const durationRows =
      yield* clipMockupOps.listClipMockupDurationsByVideoIds(videoIds);
    const durationsByVideo = new Map<string, number[]>();
    for (const row of durationRows) {
      const list = durationsByVideo.get(row.videoId) ?? [];
      list.push(row.durationSeconds);
      durationsByVideo.set(row.videoId, list);
    }

    return section.lessons.map((l): AnimaticSectionLesson => ({
      videos: l.videos.map((v) => ({
        id: v.id,
        title: v.title,
        durationsSeconds: durationsByVideo.get(v.id) ?? [],
      })),
    }));
  });

export default function AnimaticRoute({ loaderData }: Route.ComponentProps) {
  const { video, mockups, chapters, comments, sectionRunTime } = loaderData;
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

  return (
    // KEYED BY THE VIDEO, so NEXT starts the next Animatic at its first frame.
    // This is one route: PREVIOUS/NEXT changes `:videoId` alone, React keeps
    // the same `AnimaticPlayer` mounted, and everything the player holds —
    // the Remotion Player's own playhead above all — survives the move. Walk
    // off clip seven while it plays and the next Video picks up playing at
    // clip seven, halfway through a Lesson the author has not started
    // watching. The editor keys itself the same way, for the same reason.
    //
    // A POLL MUST NOT REMOUNT IT. The `videoId` is the one thing a
    // revalidation of this page cannot change, which is why the key is the
    // Video and not the rows; the rows are held by value instead, in
    // `useStableMockups`. Comments reach the sidebar through their own
    // provider, so they are never part of what the Player is handed.
    <AnimaticCommentsProvider comments={comments}>
      <AnimaticPlayer
        key={video.id}
        mockups={mockups}
        chapters={chapters}
        sectionRunTime={sectionRunTime}
        width={width}
        height={height}
      />
    </AnimaticCommentsProvider>
  );
}
