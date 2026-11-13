import { type Database } from "./drizzle-service.server.js";
import { clipLayers, clips, lessons, videos } from "../db/schema.js";
import {
  NotFoundError,
  UnknownDBServiceError,
  VideoTitleTakenError,
} from "./db-service-errors.js";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Effect } from "effect";
import {
  resolveVideoFormat,
  type VideoFormat,
} from "../features/videos/video-format.js";
import { layerRowInVideoFormat } from "../features/videos/clip-layer.js";
import {
  requireDraftVersionForLesson,
  requireDraftVersionForVideo,
} from "./draft-guard.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/**
 * The Video WRITE verbs added for the `cvm` CLI, split out of
 * db-video-operations.server.ts to keep that file under the repo's per-file
 * token budget (see db-video-operations.copy.server.ts for the same pattern).
 * These are spread into VideoOperationsService's returned object, so callers
 * see them as ordinary service methods.
 */
export const createVideoWriteOps = (db: Database) => {
  /**
   * Fetch a single Video row (no relations) by id, failing NotFoundError when
   * absent. Used by the CLI write verbs to echo the affected row.
   */
  const getVideoRowById = Effect.fn("getVideoRowById")(function* (id: string) {
    const video = yield* makeDbCall(() =>
      db.query.videos.findFirst({ where: eq(videos.id, id) })
    );

    if (!video) {
      return yield* new NotFoundError({
        type: "getVideoRowById",
        params: { id },
      });
    }

    return video;
  });

  /**
   * Link a Video to a Pitch, enforcing the single-parent invariant: setting a
   * pitch parent also clears any lesson parent (a Pitch packages Standalone
   * videos, so a pitch-bound video is never lesson-bound). Returns the updated
   * row; NotFoundError when the video id is absent.
   */
  const linkVideoToPitch = Effect.fn("linkVideoToPitch")(function* (opts: {
    videoId: string;
    pitchId: string;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ pitchId: opts.pitchId, lessonId: null, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "linkVideoToPitch",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  /**
   * Move a Video into a Lesson, enforcing the single-parent invariant: setting a
   * lesson parent also clears any pitch parent. Re-checks the (lessonId, title)
   * uniqueness guard (VideoTitleTakenError) before mutating — unlike
   * updateVideoLesson, which does not. Returns the updated row; NotFoundError
   * when the video id is absent.
   */
  const moveVideoToLesson = Effect.fn("moveVideoToLesson")(function* (opts: {
    videoId: string;
    lessonId: string;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    yield* requireDraftVersionForLesson(db, opts.lessonId);
    const current = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, opts.videoId),
        columns: { title: true },
      })
    );

    if (!current) {
      return yield* new NotFoundError({
        type: "moveVideoToLesson",
        params: { videoId: opts.videoId },
      });
    }

    // (lessonId, title) must be free among the target lesson's active videos.
    const clash = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: and(
          eq(videos.lessonId, opts.lessonId),
          eq(videos.title, current.title),
          eq(videos.archived, false),
          ne(videos.id, opts.videoId)
        ),
        columns: { id: true },
      })
    );

    if (clash) {
      return yield* new VideoTitleTakenError({
        title: current.title,
        message: `Video name "${current.title}" is already taken in this lesson`,
      });
    }

    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ lessonId: opts.lessonId, pitchId: null, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "moveVideoToLesson",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  /**
   * Unarchive a Video — the undo of `deleteVideo`. The Video goes back where
   * it was: a Standalone or pitch-bound one keeps its (lack of a) parent, and a
   * lesson-bound one returns to its Lesson (Videos have no position of their
   * own; a Lesson lists them by title). If that Lesson — or its Section — has
   * been archived since, there is nowhere live to return to, so the Video comes
   * back as a Standalone Video instead, where /videos shows it and "Move to
   * Lesson" can re-home it.
   *
   * Returning to the Lesson re-checks the (lessonId, title) guard: a live
   * sibling may have taken the title while this one was archived
   * (VideoTitleTakenError). Draft-guarded like every lesson-bound write.
   */
  const unarchiveVideo = Effect.fn("unarchiveVideo")(function* (
    videoId: string
  ) {
    yield* requireDraftVersionForVideo(db, videoId);
    const current = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, videoId),
        columns: { title: true, lessonId: true },
      })
    );

    if (!current) {
      return yield* new NotFoundError({
        type: "unarchiveVideo",
        params: { videoId },
      });
    }

    let lessonId = current.lessonId;
    if (lessonId) {
      const lesson = yield* makeDbCall(() =>
        db.query.lessons.findFirst({
          where: eq(lessons.id, lessonId!),
          columns: { archived: true },
          with: { section: { columns: { archivedAt: true } } },
        })
      );
      if (!lesson || lesson.archived || lesson.section.archivedAt) {
        lessonId = null;
      }
    }

    if (lessonId) {
      const clash = yield* makeDbCall(() =>
        db.query.videos.findFirst({
          where: and(
            eq(videos.lessonId, lessonId),
            eq(videos.title, current.title),
            eq(videos.archived, false),
            ne(videos.id, videoId)
          ),
          columns: { id: true },
        })
      );
      if (clash) {
        return yield* new VideoTitleTakenError({
          title: current.title,
          message: `Video name "${current.title}" is already taken in its lesson; rename one first`,
        });
      }
    }

    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ archived: false, lessonId, updatedAt: new Date() })
        .where(eq(videos.id, videoId))
        .returning()
    );

    return updated!;
  });

  const updateVideoBody = Effect.fn("updateVideoBody")(function* (opts: {
    videoId: string;
    body: string | null;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ body: opts.body, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateVideoBody",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  const updateVideoScript = Effect.fn("updateVideoScript")(function* (opts: {
    videoId: string;
    script: string | null;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ script: opts.script, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateVideoScript",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  const updateVideoDescription = Effect.fn("updateVideoDescription")(
    function* (opts: { videoId: string; description: string | null }) {
      yield* requireDraftVersionForVideo(db, opts.videoId);
      const [updated] = yield* makeDbCall(() =>
        db
          .update(videos)
          .set({ description: opts.description, updatedAt: new Date() })
          .where(eq(videos.id, opts.videoId))
          .returning()
      );

      if (!updated) {
        return yield* new NotFoundError({
          type: "updateVideoDescription",
          params: { videoId: opts.videoId },
        });
      }

      return updated;
    }
  );

  /** The YouTube Draft, both fields at once, as the YouTube page has them. */
  const updateYoutubeDraft = Effect.fn("updateYoutubeDraft")(function* (opts: {
    videoId: string;
    title: string;
    description: string;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({
          youtubeDraftTitle: opts.title,
          youtubeDraftDescription: opts.description,
          updatedAt: new Date(),
        })
        .where(eq(videos.id, opts.videoId))
        .returning({ id: videos.id })
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateYoutubeDraft",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  const unlinkVideoFromPitch = Effect.fn("unlinkVideoFromPitch")(function* (
    videoId: string
  ) {
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ pitchId: null, updatedAt: new Date() })
        .where(eq(videos.id, videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "unlinkVideoFromPitch",
        params: { videoId },
      });
    }

    return updated;
  });

  /**
   * Move every stored Footage Layer of a Video's Clips from one format's
   * frame into another's. The Clip rows are locked `FOR UPDATE` (sorted, after
   * the Draft guard), as a `clip layer` write locks them, so the two never
   * lose each other's edit (#2598).
   */
  const moveFootageLayers = Effect.fn("moveFootageLayers")(function* (
    videoId: string,
    from: VideoFormat,
    to: VideoFormat
  ) {
    const clipIds = (yield* makeDbCall(() =>
      db
        .select({ id: clips.id })
        .from(clips)
        .where(eq(clips.videoId, videoId))
        .orderBy(asc(clips.id))
        .for("update")
    )).map((clip) => clip.id);
    if (clipIds.length === 0) return;
    const rows = yield* makeDbCall(() =>
      db
        .select()
        .from(clipLayers)
        .where(
          and(
            inArray(clipLayers.clipId, clipIds),
            eq(clipLayers.kind, "footage")
          )
        )
    );
    for (const row of rows) {
      const moved = layerRowInVideoFormat(row, from, to);
      yield* makeDbCall(() =>
        db
          .update(clipLayers)
          .set({
            placeX: moved.placeX,
            placeY: moved.placeY,
            placeW: moved.placeW,
            placeH: moved.placeH,
            cropX: moved.cropX,
            cropY: moved.cropY,
            cropW: moved.cropW,
            cropH: moved.cropH,
          })
          .where(eq(clipLayers.id, row.id))
      );
    }
  });

  /**
   * Set a Video's format, re-homing it to standalone. Each stored Footage
   * Layer of its Clips moves into the new frame by the rule `short create`
   * uses (`layerRowInVideoFormat`), in the same transaction; Scene Layers and
   * Clips with no stored Layers are untouched.
   */
  const updateVideoFormat = Effect.fn("updateVideoFormat")(function* (opts: {
    videoId: string;
    format: VideoFormat;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    const before = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, opts.videoId),
        columns: { format: true },
      })
    );
    if (before && resolveVideoFormat(before.format) !== opts.format) {
      yield* moveFootageLayers(
        opts.videoId,
        resolveVideoFormat(before.format),
        opts.format
      );
    }
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({
          format: opts.format,
          lessonId: null,
          updatedAt: new Date(),
        })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateVideoFormat",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  return {
    getVideoRowById,
    linkVideoToPitch,
    unlinkVideoFromPitch,
    moveVideoToLesson,
    unarchiveVideo,
    updateVideoBody,
    updateVideoScript,
    updateVideoDescription,
    updateYoutubeDraft,
    updateVideoFormat,
  };
};

/**
 * The guarded Video write verbs (from both this file and
 * db-video-operations.server.ts) that transactionalizeWrites wraps so guard +
 * write share one transaction (issue #1403). Standalone-only writes
 * (createStandaloneVideo, unlinkVideoFromPitch)
 * touch no CourseVersion and stay unwrapped.
 */
export const videoWriteMethods = [
  "createVideo",
  "updateVideo",
  "deleteVideo",
  "unarchiveVideo",
  "updateVideoTitle",
  "copyVideo",
  "updateVideoLesson",
  "linkVideoToPitch",
  "moveVideoToLesson",
  "updateVideoBody",
  "updateVideoScript",
  "updateVideoDescription",
  "updateYoutubeDraft",
  "updateVideoFormat",
  // `cvm short create`: the Short and every Clip it copies or cuts, at once.
  "createShortFromRanges",
] as const;
