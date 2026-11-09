import { type Database } from "./drizzle-service.server.js";
import {
  clips,
  chapters,
  lessons,
  courseVersions,
  sections,
  beats,
  clipMockups,
  clipMockupChapters,
  clipMockupComments,
  thumbnails,
  videos,
  learningGoals,
  beatLearningGoals,
} from "../db/schema.js";
import {
  NotLatestVersionError,
  UnknownDBServiceError,
  VersionNotDraftError,
} from "./db-service-errors.js";
import { asc, and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { copiedVoice } from "../features/clip-mockups/voice-status.js";
import { requireDraftVersion } from "./draft-guard.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";
import { assertCopyComplete } from "./version-copy-check.server.js";
import {
  freezeAndCloneVersion as freezeAndCloneVersionTransaction,
  lockCourseForVersionMutation,
  type CopyVersionStructureInput,
} from "./db-version-mutation.server.js";
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
} from "./copy-child-rows.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/**
 * The version copy-forward seam, split out of db-version-operations.server.ts
 * for the repo's per-file token budget (same pattern as
 * db-version-lifecycle.server.ts and db-version-paths.server.ts). Everything
 * here answers one question — "what does a CourseVersion snapshot carry
 * forward?" — so the per-entity insert list that grows with every new child
 * table lives in one file of its own, away from the version readers.
 *
 * A new child table of a Section, Lesson, Video, Clip or Beat must be decided
 * for this copy (and duplicateCourse, and the Video copy) in
 * version-copy-manifest.ts, or CI fails (copy-paths-table-guard.test.ts). The
 * copy then checks itself: `assertCopyComplete` refuses a Submit whose new
 * Draft is missing rows of any `copied` table: live ones, and archived Clips.
 *
 * Both exits from `copyVersionStructureInDb` are here: `copyVersionStructure`
 * (which freezes its source itself; no app path calls it any more, only tests
 * that need a Published Version in one step) and
 * `freezeAndCloneVersion` (**Submit**, whose transaction lives in
 * db-version-mutation.server.ts). Spread into VersionOperationsService's
 * returned object, so callers see them as ordinary service methods.
 */
export const createVersionCopyOps = (db: Database) => {
  const copyVersionStructureInDb = (
    transaction: Database,
    input: CopyVersionStructureInput
  ) =>
    Effect.gen(function* () {
      yield* lockCourseForVersionMutation(transaction, input.repoId);
      const latestVersion = yield* makeDbCall(() =>
        transaction.query.courseVersions.findFirst({
          where: eq(courseVersions.repoId, input.repoId),
          orderBy: desc(courseVersions.createdAt),
        })
      );

      if (!latestVersion || latestVersion.id !== input.sourceVersionId) {
        return yield* new NotLatestVersionError({
          sourceVersionId: input.sourceVersionId,
          latestVersionId: latestVersion?.id ?? "none",
        });
      }

      // Only a Draft may be cloned from — the commit state is authoritative.
      if (latestVersion.commitState !== "draft") {
        return yield* new VersionNotDraftError({
          versionId: latestVersion.id,
          commitState: latestVersion.commitState,
        });
      }

      const newVersion = yield* makeDbCall(() =>
        transaction
          .insert(courseVersions)
          .values({
            repoId: input.repoId,
            name: input.newVersionName ?? "",
          })
          .returning()
      ).pipe(
        Effect.andThen((arr) => {
          const v = arr[0];
          if (!v) {
            return Effect.fail(
              new UnknownDBServiceError({ cause: "No version returned" })
            );
          }
          return Effect.succeed(v);
        })
      );

      const sourceSections = yield* makeDbCall(() =>
        transaction.query.sections.findMany({
          where: and(
            eq(sections.repoVersionId, input.sourceVersionId),
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

      const videoIdMappings: Array<{
        sourceVideoId: string;
        newVideoId: string;
      }> = [];

      // Learning Goals get their new ids up front, version-wide: a Beat may
      // serve a Goal of another Section, and its links are written last, once
      // every Goal exists.
      const goalIds = newIdsFor(
        sourceSections.flatMap((section) => section.learningGoals)
      );
      const beatLinkValues: (typeof beatLearningGoals.$inferInsert)[] = [];

      for (const sourceSection of sourceSections) {
        const [newSection] = yield* makeDbCall(() =>
          transaction
            .insert(sections)
            .values({
              repoVersionId: newVersion.id,
              previousVersionSectionId: sourceSection.id,
              lineageId: sourceSection.lineageId,
              title: sourceSection.title,
              order: sourceSection.order,
              description: sourceSection.description,
            })
            .returning()
        );

        if (!newSection) continue;

        const goalValues = copyLearningGoalValues(
          sourceSection.learningGoals,
          newSection.id,
          goalIds
        );
        if (goalValues.length > 0) {
          yield* makeDbCall(() =>
            transaction.insert(learningGoals).values(goalValues)
          );
        }

        for (const sourceLesson of sourceSection.lessons) {
          const [newLesson] = yield* makeDbCall(() =>
            transaction
              .insert(lessons)
              .values({
                sectionId: newSection.id,
                previousVersionLessonId: sourceLesson.id,
                lineageId: sourceLesson.lineageId,
                order: sourceLesson.order,
                title: sourceLesson.title,
                description: sourceLesson.description,
                icon: sourceLesson.icon,
                priority: sourceLesson.priority,
                dependencies: sourceLesson.dependencies,
                authoringStatus: sourceLesson.authoringStatus,
                optional: sourceLesson.optional,
              })
              .returning()
          );

          if (!newLesson) continue;

          for (const sourceVideo of sourceLesson.videos) {
            const [newVideo] = yield* makeDbCall(() =>
              transaction
                .insert(videos)
                .values({
                  lessonId: newLesson.id,
                  lineageId: sourceVideo.lineageId,
                  title: sourceVideo.title,
                  originalFootagePath: sourceVideo.originalFootagePath,
                  body: sourceVideo.body,
                  description: sourceVideo.description,
                  script: sourceVideo.script,
                  format: sourceVideo.format,
                  recorder: sourceVideo.recorder,
                })
                .returning()
            );

            if (!newVideo) continue;

            videoIdMappings.push({
              sourceVideoId: sourceVideo.id,
              newVideoId: newVideo.id,
            });

            const clipIds = newIdsFor(sourceVideo.clips);
            if (sourceVideo.clips.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(clips).values(
                  sourceVideo.clips.map((clip) => ({
                    id: clipIds.get(clip.id)!,
                    videoId: newVideo.id,
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
                    // Diagram Snapshots are shared per Diagram, not owned by a
                    // Version, so the pin carries over verbatim (no remap).
                    diagramSnapshotId: clip.diagramSnapshotId,
                    // Shared, not copied: see SHARED_FOOTAGE in version-copy-manifest.ts.
                    recordingSessionId: clip.recordingSessionId,
                    sceneOverride: clip.sceneOverride,
                    // NOT stamped `copy`: a Submit makes new Versions of the
                    // same Videos, not copies. The footage stats count only
                    // current Clips (the new Draft's), so `copy` here would
                    // drop every Submitted take from them.
                    origin: clip.origin,
                  }))
                )
              );
              yield* makeDbCall(() =>
                copyClipChildren(transaction, sourceVideo.clips, clipIds)
              );
            }

            if (sourceVideo.chapters.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(chapters).values(
                  sourceVideo.chapters.map((section) => ({
                    videoId: newVideo.id,
                    name: section.name,
                    order: section.order,
                    archived: false,
                  }))
                )
              );
            }

            const beatIds = newIdsFor(sourceVideo.beats);
            beatLinkValues.push(
              ...copyBeatLearningGoalValues(
                sourceVideo.beats.flatMap((beat) => beat.beatLearningGoals),
                beatIds,
                (goalId) => goalIds.get(goalId)
              )
            );
            if (sourceVideo.beats.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(beats).values(
                  sourceVideo.beats.map((beat) => ({
                    id: beatIds.get(beat.id)!,
                    videoId: newVideo.id,
                    kind: beat.kind,
                    title: beat.title,
                    description: beat.description,
                    order: beat.order,
                  }))
                )
              );
            }

            // Clip Mockups copy exactly as Beats do: `order` verbatim, and
            // `imagePath` stays valid because the snapshot keeps lineageId.
            const clipMockupIds = newIdsFor(sourceVideo.clipMockups);
            const clipMockupChapterIds = newIdsFor(
              sourceVideo.clipMockupChapters
            );
            if (sourceVideo.clipMockups.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(clipMockups).values(
                  sourceVideo.clipMockups.map((clipMockup) => ({
                    id: clipMockupIds.get(clipMockup.id)!,
                    videoId: newVideo.id,
                    line: clipMockup.line,
                    imagePath: clipMockup.imagePath,
                    ...copiedVoice(clipMockup),
                    order: clipMockup.order,
                  }))
                )
              );
            }

            // Clip Mockup Chapters share the Clip Mockups' order space, so
            // verbatim `order` keeps the two interleaved as the source has them.
            if (sourceVideo.clipMockupChapters.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(clipMockupChapters).values(
                  sourceVideo.clipMockupChapters.map((chapter) => ({
                    id: clipMockupChapterIds.get(chapter.id)!,
                    videoId: newVideo.id,
                    name: chapter.name,
                    order: chapter.order,
                  }))
                )
              );
            }

            const commentValues = copyClipMockupCommentValues(
              sourceVideo.clipMockupComments,
              newVideo.id,
              clipMockupIds,
              clipMockupChapterIds
            );
            if (commentValues.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(clipMockupComments).values(commentValues)
              );
            }

            if (sourceVideo.thumbnails.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(thumbnails).values(
                  sourceVideo.thumbnails.map((thumbnail) => ({
                    videoId: newVideo.id,
                    layers: thumbnail.layers,
                    filePath: thumbnail.filePath,
                    selectedForUpload: thumbnail.selectedForUpload,
                  }))
                )
              );
            }
          }
        }
      }

      yield* makeDbCall(() =>
        insertInChunks(transaction, beatLearningGoals, beatLinkValues)
      );

      yield* assertCopyComplete(
        transaction,
        input.sourceVersionId,
        newVersion.id
      );

      return { version: newVersion, videoIdMappings };
    });

  const copyVersionStructure = Effect.fn("copyVersionStructure")(function* (
    input: CopyVersionStructureInput
  ) {
    return yield* withDbTransaction(db, (transaction) =>
      Effect.gen(function* () {
        // #1403: hold the version-row lock guarded writes contend on while
        // cloning, so no write can land on the source mid-freeze.
        yield* requireDraftVersion(transaction, input.sourceVersionId);
        const result = yield* copyVersionStructureInDb(transaction, input);
        // This copy freezes its source without a Dropbox commit:
        // the old Draft becomes an immutable `published` snapshot (that is what
        // the positional model treated every non-latest version as), and the
        // clone becomes the course's single Draft.
        yield* makeDbCall(() =>
          transaction
            .update(courseVersions)
            .set({ commitState: "published" })
            .where(eq(courseVersions.id, input.sourceVersionId))
        );
        return result;
      })
    );
  });

  const freezeAndCloneVersion = Effect.fn("freezeAndCloneVersion")(function* (
    input: CopyVersionStructureInput & {
      sourceName: string;
      sourceDescription: string;
    }
  ) {
    return yield* freezeAndCloneVersionTransaction(
      db,
      input,
      copyVersionStructureInDb
    );
  });

  return { copyVersionStructure, freezeAndCloneVersion };
};
