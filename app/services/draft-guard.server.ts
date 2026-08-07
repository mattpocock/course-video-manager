import type { Database } from "@/services/drizzle-service.server";
import {
  chapters,
  clips,
  clipWebLinks,
  courseVersions,
  lessons,
  sections,
  videos,
} from "@/db/schema";
import {
  UnknownDBServiceError,
  VersionNotDraftError,
} from "@/services/db-service-errors";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { ClipServiceEvent } from "@/services/clip-service";

/**
 * Write-closure guards for the CourseVersion lifecycle (issues #1348/#1403).
 *
 * Only a Draft Version (`commitState === "draft"`) accepts section / lesson /
 * video / clip writes; Pending and Published Versions are immutable. Each DB
 * write entry point resolves its target's owning CourseVersion through one of
 * these guards and fails with a typed VersionNotDraftError when the version is
 * not a Draft.
 *
 * The commitState read is a `SELECT … FOR UPDATE` on the version row, held
 * until the enclosing transaction commits — so a guard is only race-safe when
 * it runs in the SAME transaction as the write it protects (see
 * transactionalizeWrites / withClipServiceWriteClosure). Submit takes the same
 * row lock before cloning, so check + write commit atomically on one side of
 * the Draft → Pending transition, never straddling it.
 *
 * Resolution rules:
 * - A target that does not exist passes through — the write itself no-ops or
 *   raises its own NotFoundError, exactly as before the guard existed.
 * - A Video with no Lesson (standalone / pitch-bound) belongs to no
 *   CourseVersion, so no closure applies and the guard passes.
 */

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/**
 * Lock the version row FOR UPDATE and assert it is a Draft. A missing row
 * passes through (see resolution rules above).
 */
const lockAndAssertDraft = Effect.fn("lockAndAssertDraft")(function* (
  db: Database,
  versionId: string
) {
  const [version] = yield* makeDbCall(() =>
    db
      .select({
        id: courseVersions.id,
        commitState: courseVersions.commitState,
      })
      .from(courseVersions)
      .where(eq(courseVersions.id, versionId))
      .for("update")
  );
  if (version && version.commitState !== "draft") {
    return yield* new VersionNotDraftError({
      versionId: version.id,
      commitState: version.commitState,
    });
  }
});

/** Guard a write scoped directly to a CourseVersion id. */
export const requireDraftVersion = (db: Database, versionId: string) =>
  lockAndAssertDraft(db, versionId);

/** Guard a write scoped to a Section. */
export const requireDraftVersionForSection = Effect.fn(
  "requireDraftVersionForSection"
)(function* (db: Database, sectionId: string) {
  const section = yield* makeDbCall(() =>
    db.query.sections.findFirst({
      where: eq(sections.id, sectionId),
      columns: { repoVersionId: true },
    })
  );
  if (!section) return;
  yield* lockAndAssertDraft(db, section.repoVersionId);
});

/**
 * Guard a batch write scoped to Sections: every DISTINCT owning version is
 * locked and asserted, so a mixed-version batch cannot slip a non-Draft
 * write past a first-element-only check.
 */
export const requireDraftVersionForSections = Effect.fn(
  "requireDraftVersionForSections"
)(function* (db: Database, sectionIds: readonly string[]) {
  if (sectionIds.length === 0) return;
  const rows = yield* makeDbCall(() =>
    db.query.sections.findMany({
      where: inArray(sections.id, sectionIds),
      columns: { repoVersionId: true },
    })
  );
  for (const versionId of new Set(rows.map((r) => r.repoVersionId))) {
    yield* lockAndAssertDraft(db, versionId);
  }
});

/** Guard a write scoped to a Lesson. */
export const requireDraftVersionForLesson = Effect.fn(
  "requireDraftVersionForLesson"
)(function* (db: Database, lessonId: string) {
  const lesson = yield* makeDbCall(() =>
    db.query.lessons.findFirst({
      where: eq(lessons.id, lessonId),
      columns: { id: true },
      with: { section: { columns: { repoVersionId: true } } },
    })
  );
  if (!lesson?.section) return;
  yield* lockAndAssertDraft(db, lesson.section.repoVersionId);
});

/** Guard a batch write scoped to Lessons: every distinct owning version. */
export const requireDraftVersionForLessons = Effect.fn(
  "requireDraftVersionForLessons"
)(function* (db: Database, lessonIds: readonly string[]) {
  if (lessonIds.length === 0) return;
  const rows = yield* makeDbCall(() =>
    db.query.lessons.findMany({
      where: inArray(lessons.id, lessonIds),
      columns: { id: true },
      with: { section: { columns: { repoVersionId: true } } },
    })
  );
  const versionIds = new Set(
    rows.flatMap((r) => (r.section ? [r.section.repoVersionId] : []))
  );
  for (const versionId of versionIds) {
    yield* lockAndAssertDraft(db, versionId);
  }
});

/** Guard a write scoped to a Video (passes for standalone/pitch videos). */
export const requireDraftVersionForVideo = Effect.fn(
  "requireDraftVersionForVideo"
)(function* (db: Database, videoId: string) {
  const video = yield* makeDbCall(() =>
    db.query.videos.findFirst({
      where: eq(videos.id, videoId),
      columns: { id: true },
      with: {
        lesson: {
          columns: { id: true },
          with: { section: { columns: { repoVersionId: true } } },
        },
      },
    })
  );
  if (!video?.lesson?.section) return;
  yield* lockAndAssertDraft(db, video.lesson.section.repoVersionId);
});

/** Guard a write scoped to a Clip. */
export const requireDraftVersionForClip = Effect.fn(
  "requireDraftVersionForClip"
)(function* (db: Database, clipId: string) {
  const clip = yield* makeDbCall(() =>
    db.query.clips.findFirst({
      where: eq(clips.id, clipId),
      columns: { id: true, videoId: true },
    })
  );
  if (!clip) return;
  yield* requireDraftVersionForVideo(db, clip.videoId);
});

/** Guard a batch write scoped to Clips: every distinct owning video. */
export const requireDraftVersionForClips = Effect.fn(
  "requireDraftVersionForClips"
)(function* (db: Database, clipIds: readonly string[]) {
  if (clipIds.length === 0) return;
  const rows = yield* makeDbCall(() =>
    db.query.clips.findMany({
      where: inArray(clips.id, clipIds),
      columns: { videoId: true },
    })
  );
  for (const videoId of new Set(rows.map((r) => r.videoId))) {
    yield* requireDraftVersionForVideo(db, videoId);
  }
});

/** Guard a write scoped to a Chapter. */
export const requireDraftVersionForChapter = Effect.fn(
  "requireDraftVersionForChapter"
)(function* (db: Database, chapterId: string) {
  const chapter = yield* makeDbCall(() =>
    db.query.chapters.findFirst({
      where: eq(chapters.id, chapterId),
      columns: { id: true, videoId: true },
    })
  );
  if (!chapter) return;
  yield* requireDraftVersionForVideo(db, chapter.videoId);
});

/** Guard a batch write scoped to Chapters: every distinct owning video. */
export const requireDraftVersionForChapters = Effect.fn(
  "requireDraftVersionForChapters"
)(function* (db: Database, chapterIds: readonly string[]) {
  if (chapterIds.length === 0) return;
  const rows = yield* makeDbCall(() =>
    db.query.chapters.findMany({
      where: inArray(chapters.id, chapterIds),
      columns: { videoId: true },
    })
  );
  for (const videoId of new Set(rows.map((r) => r.videoId))) {
    yield* requireDraftVersionForVideo(db, videoId);
  }
});

/** Guard a write scoped to a Clip web link. */
export const requireDraftVersionForClipWebLink = Effect.fn(
  "requireDraftVersionForClipWebLink"
)(function* (db: Database, linkId: string) {
  const link = yield* makeDbCall(() =>
    db.query.clipWebLinks.findFirst({
      where: eq(clipWebLinks.id, linkId),
      columns: { id: true, clipId: true },
    })
  );
  if (!link) return;
  yield* requireDraftVersionForClip(db, link.clipId);
});

/**
 * Write-closure for the clip-service handler, which writes to the DB directly
 * instead of going through the guarded ops services: resolve a write event's
 * target and refuse it when the owning CourseVersion is not a Draft. Read
 * events and events that only create standalone videos pass straight through.
 */
export const requireDraftForClipServiceEvent = Effect.fn(
  "requireDraftForClipServiceEvent"
)(function* (db: Database, event: ClipServiceEvent) {
  switch (event.type) {
    case "append-clips":
    case "append-from-obs":
    case "create-chapter-at-insertion-point":
    case "create-chapter-at-position":
    case "create-effect-clip-at-position":
    case "regenerate-chapters":
      return yield* requireDraftVersionForVideo(db, event.input.videoId);
    case "create-video-from-selection":
      // Copies always join the source video's lesson (and thus its version);
      // move mode additionally archives the source clips.
      return yield* requireDraftVersionForVideo(db, event.input.sourceVideoId);
    case "archive-clips":
    case "unarchive-clips":
      // Guard every distinct owning video — a mixed-version batch must not
      // slip past a first-element check (in practice a batch targets one).
      return yield* requireDraftVersionForClips(db, event.clipIds);
    case "update-clips":
      return yield* requireDraftVersionForClips(
        db,
        event.clips.map((c) => c.id)
      );
    case "update-pause":
    case "update-zoom":
    case "reorder-clip":
      return yield* requireDraftVersionForClip(db, event.clipId);
    case "update-chapter":
    case "reorder-chapter":
      return yield* requireDraftVersionForChapter(db, event.chapterId);
    case "archive-chapters":
      return yield* requireDraftVersionForChapters(db, event.chapterIds);
    default:
      return;
  }
});

/**
 * Guarded clip-service write events run inside one transaction: guard (with
 * its version-row lock) + dispatch, committed atomically (issue #1403).
 * Reads, standalone-video creation, and append-from-obs (which re-guards
 * around its insert AFTER the slow OBS detection — see appendFromObsImpl)
 * dispatch outside a transaction.
 */
export const withClipServiceWriteClosure = <A, E>(
  db: Database,
  event: ClipServiceEvent,
  run: (db: Database) => Effect.Effect<A, E>
): Effect.Effect<A, E | VersionNotDraftError | UnknownDBServiceError> => {
  switch (event.type) {
    case "create-video":
    case "get-timeline":
    case "append-from-obs":
      return run(db);
    default:
      return withDbTransaction(db, (tx) =>
        Effect.gen(function* () {
          yield* requireDraftForClipServiceEvent(tx, event);
          return yield* run(tx);
        })
      );
  }
};
