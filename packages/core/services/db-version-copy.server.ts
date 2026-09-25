import { type Database } from "./drizzle-service.server.js";
import {
  clips,
  chapters,
  lessons,
  courseVersions,
  sections,
  beats,
  clipMockups,
  thumbnails,
  videos,
} from "../db/schema.js";
import {
  NotLatestVersionError,
  UnknownDBServiceError,
  VersionNotDraftError,
} from "./db-service-errors.js";
import { asc, and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { requireDraftVersion } from "./draft-guard.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";
import {
  freezeAndCloneVersion as freezeAndCloneVersionTransaction,
  lockCourseForVersionMutation,
  type CopyVersionStructureInput,
} from "./db-version-mutation.server.js";

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
 * Both exits from `copyVersionStructureInDb` are here: `copyVersionStructure`
 * (manual create-version, which freezes its source itself) and
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
            lessons: {
              orderBy: asc(lessons.order),
              where: eq(lessons.archived, false),
              with: {
                videos: {
                  orderBy: asc(videos.title),
                  where: eq(videos.archived, false),
                  with: {
                    clips: {
                      orderBy: asc(clips.order),
                      where: eq(clips.archived, false),
                    },
                    chapters: {
                      orderBy: asc(chapters.order),
                      where: eq(chapters.archived, false),
                    },
                    beats: {
                      orderBy: asc(beats.order),
                      where: eq(beats.archived, false),
                    },
                    clipMockups: {
                      orderBy: asc(clipMockups.order),
                      where: eq(clipMockups.archived, false),
                    },
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
                })
                .returning()
            );

            if (!newVideo) continue;

            videoIdMappings.push({
              sourceVideoId: sourceVideo.id,
              newVideoId: newVideo.id,
            });

            if (sourceVideo.clips.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(clips).values(
                  sourceVideo.clips.map((clip) => ({
                    videoId: newVideo.id,
                    videoFilename: clip.videoFilename,
                    sourceStartTime: clip.sourceStartTime,
                    sourceEndTime: clip.sourceEndTime,
                    order: clip.order,
                    archived: false,
                    text: clip.text,
                    transcribedAt: clip.transcribedAt,
                    scene: clip.scene,
                    profile: clip.profile,
                    pauseType: clip.pauseType,
                  }))
                )
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

            if (sourceVideo.beats.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(beats).values(
                  sourceVideo.beats.map((beat) => ({
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
            if (sourceVideo.clipMockups.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(clipMockups).values(
                  sourceVideo.clipMockups.map((clipMockup) => ({
                    videoId: newVideo.id,
                    line: clipMockup.line,
                    imagePath: clipMockup.imagePath,
                    audioPath: clipMockup.audioPath,
                    durationSeconds: clipMockup.durationSeconds,
                    order: clipMockup.order,
                  }))
                )
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
        // Manual create-version freezes its source without a Dropbox commit:
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
