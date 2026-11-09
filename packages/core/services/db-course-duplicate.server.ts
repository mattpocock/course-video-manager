import type { Database } from "./drizzle-service.server.js";
import {
  clips,
  chapters,
  courses,
  courseVersions,
  sections,
  lessons,
  beats,
  clipMockups,
  clipMockupChapters,
  clipMockupComments,
  thumbnails,
  videos,
  learningGoals,
  beatLearningGoals,
} from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import {
  rebaseLineagePath,
  rebaseLineagePathsDeep,
} from "./thumbnail-path-rebase.js";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { copiedVoice } from "../features/clip-mockups/voice-status.js";
import {
  copyClipMockupCommentValues,
  newIdsFor,
} from "./clip-mockup-comment-copy.js";
import {
  clipChildrenWith,
  copyBeatLearningGoalValues,
  copyClipChildren,
  copyLearningGoalValues,
  insertInChunks,
  type ClipWithChildren,
} from "./copy-child-rows.js";

/**
 * Another Course, archived or not, already holds the name the copy asked for.
 * Checked inside the copy's own transaction, under a lock on the name, so two
 * copies racing for one name cannot both commit.
 */
export class CourseNameTakenError extends Data.TaggedError(
  "CourseNameTakenError"
)<{ readonly name: string; readonly message: string }> {}

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Deep-copies a course's latest draft version into a brand-new course: a single
 * fresh draft version, then every non-archived section (and its Learning
 * Goals) → lesson → video and each video's clips (with their Web Links,
 * Transcript Words and Overlays), chapters, beats (with their Learning Goal
 * links), clip mockups, clip mockup chapters and thumbnails — all in ONE
 * transaction, one batched insert per table, so a failure part-way leaves no
 * half-copied Course behind to block a retry under the same name. Split out of
 * `db-course-operations.server.ts` to keep that module under the file-token
 * cap.
 *
 * Returns the Video lineage pairs alongside the new course. Every duplicated
 * Video gets a FRESH `lineageId` — it is a new Video, not the same one in a
 * new version — and THREE things are keyed by one. Its copied Clip Mockups
 * keep `imagePath`/`audioPath` verbatim (#1669); its Video Files are a
 * directory the duplicate does not have yet; and its Thumbnails store
 * ABSOLUTE paths that, copied verbatim, aliased the SOURCE Video's PNGs
 * rather than stranding — so editing the copy's Thumbnail wrote over the
 * source's picture (#1674). The Thumbnail paths are rewritten onto the copy's
 * own lineage HERE, which is pure string work; moving the bytes is the
 * caller's, because `@cvm/core` is filesystem-free. The pairs are the only
 * thing it can hand over.
 */
export const makeDuplicateCourse = (db: Database) =>
  Effect.fn("duplicateCourse")(function* (input: {
    sourceCourseId: string;
    name: string;
    /**
     * The new Course's id, when the caller has already chosen it: a
     * `duplicate-course` Job names it up front, so a resumed run can tell
     * whether this copy already committed.
     */
    newCourseId?: string;
    /**
     * Commit the Course archived: the `duplicate-course` Job keeps it out of
     * sight until its files have copied, and only then un-archives it.
     */
    archived?: boolean;
  }) {
    // Fetch source course
    const sourceCourse = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, input.sourceCourseId),
      })
    );

    if (!sourceCourse) {
      return yield* new NotFoundError({
        type: "duplicateCourse",
        params: { sourceCourseId: input.sourceCourseId },
      });
    }

    // Get latest draft version
    const latestVersion = yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: eq(courseVersions.repoId, input.sourceCourseId),
        orderBy: desc(courseVersions.createdAt),
      })
    );

    if (!latestVersion) {
      return yield* new NotFoundError({
        type: "duplicateCourse",
        params: { sourceCourseId: input.sourceCourseId },
        message: "Source course has no versions",
      });
    }

    // Deep-copy from source's latest draft, excluding archived entities
    // except Clips (KEEPS_ARCHIVED_CLIPS in version-copy-manifest.ts)
    const sourceSections = yield* makeDbCall(() =>
      db.query.sections.findMany({
        where: and(
          eq(sections.repoVersionId, latestVersion.id),
          isNull(sections.archivedAt)
        ),
        orderBy: asc(sections.order),
        with: {
          learningGoals: {
            orderBy: asc(learningGoals.order),
            where: eq(learningGoals.archived, false),
          },
          lessons: {
            orderBy: asc(lessons.order),
            where: eq(lessons.archived, false),
            with: {
              videos: {
                orderBy: asc(videos.title),
                where: eq(videos.archived, false),
                with: {
                  // Archived Clips too, still archived: see KEEPS_ARCHIVED_CLIPS in
                  // version-copy-manifest.ts.
                  clips: {
                    orderBy: asc(clips.order),
                    with: clipChildrenWith,
                  },
                  chapters: {
                    orderBy: asc(chapters.order),
                    where: eq(chapters.archived, false),
                  },
                  beats: {
                    orderBy: asc(beats.order),
                    where: eq(beats.archived, false),
                    with: { beatLearningGoals: true },
                  },
                  clipMockups: {
                    orderBy: asc(clipMockups.order),
                    where: eq(clipMockups.archived, false),
                  },
                  clipMockupChapters: {
                    orderBy: asc(clipMockupChapters.order),
                    where: eq(clipMockupChapters.archived, false),
                  },
                  clipMockupComments: true,
                  thumbnails: true,
                },
              },
            },
          },
        },
      })
    );

    /** Source → duplicate, per Video, for the caller that owns the disk. */
    const videoLineageMappings: Array<{
      sourceLineageId: string;
      newLineageId: string;
      newVideoId: string;
    }> = [];

    // Every id is made up front, so each table goes in as one batched insert
    // rather than one round trip per row — and the whole copy is one
    // transaction: a failure part-way leaves no half-copied Course holding
    // the name, so the author can simply try again.
    const goalIds = newIdsFor(
      sourceSections.flatMap((section) => section.learningGoals)
    );
    const sectionValues: (typeof sections.$inferInsert)[] = [];
    const goalValues: (typeof learningGoals.$inferInsert)[] = [];
    const lessonValues: (typeof lessons.$inferInsert)[] = [];
    const videoValues: (typeof videos.$inferInsert)[] = [];
    const clipValues: (typeof clips.$inferInsert)[] = [];
    const sourceClips: ClipWithChildren[] = [];
    const clipIds = new Map<string, string>();
    const chapterValues: (typeof chapters.$inferInsert)[] = [];
    const beatValues: (typeof beats.$inferInsert)[] = [];
    const beatLinkValues: (typeof beatLearningGoals.$inferInsert)[] = [];
    const clipMockupValues: (typeof clipMockups.$inferInsert)[] = [];
    const clipMockupChapterValues: (typeof clipMockupChapters.$inferInsert)[] =
      [];
    const commentValues: (typeof clipMockupComments.$inferInsert)[] = [];
    const thumbnailValues: (typeof thumbnails.$inferInsert)[] = [];

    const newCourseId = input.newCourseId ?? crypto.randomUUID();
    const newVersionId = crypto.randomUUID();

    for (const sourceSection of sourceSections) {
      const newSectionId = crypto.randomUUID();
      sectionValues.push({
        id: newSectionId,
        repoVersionId: newVersionId,
        previousVersionSectionId: null,
        title: sourceSection.title,
        order: sourceSection.order,
        description: sourceSection.description,
      });
      goalValues.push(
        ...copyLearningGoalValues(
          sourceSection.learningGoals,
          newSectionId,
          goalIds
        )
      );

      for (const sourceLesson of sourceSection.lessons) {
        const newLessonId = crypto.randomUUID();
        lessonValues.push({
          id: newLessonId,
          sectionId: newSectionId,
          previousVersionLessonId: null,
          order: sourceLesson.order,
          title: sourceLesson.title,
          description: sourceLesson.description,
          icon: sourceLesson.icon,
          priority: sourceLesson.priority,
          dependencies: sourceLesson.dependencies,
          authoringStatus: sourceLesson.authoringStatus,
          optional: sourceLesson.optional,
        });

        for (const sourceVideo of sourceLesson.videos) {
          const newVideoId = crypto.randomUUID();
          const newLineageId = crypto.randomUUID();
          videoValues.push({
            id: newVideoId,
            lineageId: newLineageId,
            lessonId: newLessonId,
            title: sourceVideo.title,
            originalFootagePath: sourceVideo.originalFootagePath,
            body: sourceVideo.body,
            description: sourceVideo.description,
            script: sourceVideo.script,
            format: sourceVideo.format,
            recorder: sourceVideo.recorder,
          });
          videoLineageMappings.push({
            sourceLineageId: sourceVideo.lineageId,
            newLineageId,
            newVideoId,
          });

          for (const clip of sourceVideo.clips) {
            const id = crypto.randomUUID();
            clipIds.set(clip.id, id);
            sourceClips.push(clip);
            clipValues.push({
              id,
              videoId: newVideoId,
              videoFilename: clip.videoFilename,
              sourceStartTime: clip.sourceStartTime,
              sourceEndTime: clip.sourceEndTime,
              order: clip.order,
              archived: clip.archived,
              // When the take was filmed, which the footage stats date it by.
              createdAt: clip.createdAt,
              text: clip.text,
              transcribedAt: clip.transcribedAt,
              transcriptionStatus: clip.transcriptionStatus,
              scene: clip.scene,
              profile: clip.profile,
              pauseType: clip.pauseType,
              zoomType: clip.zoomType,
              diagramSnapshotId: clip.diagramSnapshotId,
              // Shared, not copied: see SHARED_FOOTAGE in version-copy-manifest.ts.
              recordingSessionId: clip.recordingSessionId,
              sceneOverride: clip.sceneOverride,
              // A duplicated Course is a user-made copy: the original Course
              // keeps its Clips, so these are not new filming (CLIP_ORIGINS).
              origin: "copy",
            });
          }

          chapterValues.push(
            ...sourceVideo.chapters.map((chapter) => ({
              videoId: newVideoId,
              name: chapter.name,
              order: chapter.order,
              archived: false,
            }))
          );

          const beatIds = newIdsFor(sourceVideo.beats);
          beatLinkValues.push(
            ...copyBeatLearningGoalValues(
              sourceVideo.beats.flatMap((beat) => beat.beatLearningGoals),
              beatIds,
              (goalId) => goalIds.get(goalId)
            )
          );
          beatValues.push(
            ...sourceVideo.beats.map((beat) => ({
              id: beatIds.get(beat.id)!,
              videoId: newVideoId,
              kind: beat.kind,
              title: beat.title,
              description: beat.description,
              order: beat.order,
            }))
          );

          // Clip Mockups copy the way Beats do — verbatim `order`, archived
          // rows already filtered out by the read above. Their Chapters share
          // the Clip Mockups' order space, so verbatim `order` keeps the two
          // interleaved as the source has them.
          const clipMockupIds = newIdsFor(sourceVideo.clipMockups);
          const clipMockupChapterIds = newIdsFor(
            sourceVideo.clipMockupChapters
          );
          clipMockupValues.push(
            ...sourceVideo.clipMockups.map((clipMockup) => ({
              id: clipMockupIds.get(clipMockup.id)!,
              videoId: newVideoId,
              line: clipMockup.line,
              imagePath: clipMockup.imagePath,
              ...copiedVoice(clipMockup),
              order: clipMockup.order,
            }))
          );
          clipMockupChapterValues.push(
            ...sourceVideo.clipMockupChapters.map((chapter) => ({
              id: clipMockupChapterIds.get(chapter.id)!,
              videoId: newVideoId,
              name: chapter.name,
              order: chapter.order,
            }))
          );
          commentValues.push(
            ...copyClipMockupCommentValues(
              sourceVideo.clipMockupComments,
              newVideoId,
              clipMockupIds,
              clipMockupChapterIds
            )
          );

          thumbnailValues.push(
            ...sourceVideo.thumbnails.map((thumbnail) => ({
              videoId: newVideoId,
              layers: rebaseLineagePathsDeep(
                thumbnail.layers,
                sourceVideo.lineageId,
                newLineageId
              ),
              filePath:
                thumbnail.filePath === null
                  ? null
                  : rebaseLineagePath(
                      thumbnail.filePath,
                      sourceVideo.lineageId,
                      newLineageId
                    ),
              selectedForUpload: thumbnail.selectedForUpload,
            }))
          );
        }
      }
    }

    const nameTaken = new CourseNameTakenError({
      name: input.name,
      message: "A course with this name already exists",
    });
    const { newCourse, newVersion } = yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          // Two copies under one name take turns here; the second then sees
          // the first's committed Course and stops.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`course-name:${input.name}`}))`
          );
          const [holder] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(eq(courses.name, input.name))
            .limit(1);
          if (holder) throw nameTaken;
          const [newCourse] = await tx
            .insert(courses)
            .values({
              id: newCourseId,
              name: input.name,
              memory: sourceCourse.memory,
              archived: input.archived ?? false,
            })
            .returning();
          // A single fresh draft version
          const [newVersion] = await tx
            .insert(courseVersions)
            .values({ id: newVersionId, repoId: newCourseId, name: "v1.0" })
            .returning();

          // Parents before children, so every foreign key already resolves.
          await insertInChunks(tx, sections, sectionValues);
          await insertInChunks(tx, learningGoals, goalValues);
          await insertInChunks(tx, lessons, lessonValues);
          await insertInChunks(tx, videos, videoValues);
          await insertInChunks(tx, clips, clipValues);
          await copyClipChildren(tx, sourceClips, clipIds);
          await insertInChunks(tx, chapters, chapterValues);
          await insertInChunks(tx, beats, beatValues);
          await insertInChunks(tx, clipMockups, clipMockupValues);
          await insertInChunks(tx, clipMockupChapters, clipMockupChapterValues);
          await insertInChunks(tx, clipMockupComments, commentValues);
          await insertInChunks(tx, thumbnails, thumbnailValues);
          await insertInChunks(tx, beatLearningGoals, beatLinkValues);

          return { newCourse: newCourse!, newVersion: newVersion! };
        }),
      catch: (e) =>
        e === nameTaken ? nameTaken : new UnknownDBServiceError({ cause: e }),
    });

    return {
      course: newCourse,
      version: newVersion,
      videoLineageMappings,
    };
  });
