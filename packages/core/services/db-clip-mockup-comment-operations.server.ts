import { DrizzleService, type Database } from "./drizzle-service.server.js";
import {
  clipMockupChapters,
  clipMockupComments,
  clipMockups,
} from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { requireDraftVersionForVideo } from "./draft-guard.server.js";
import { transactionalizeWrites } from "./with-db-transaction.server.js";

/**
 * Row-level operations for Clip Mockup Comments — the notes the author pins to
 * one Clip Mockup or one Clip Mockup Chapter for the filming day.
 *
 * THE PARENT DECIDES THE VIDEO. A caller names the Clip Mockup or the divider
 * a comment hangs off, never the Video: `videoId` is read off the parent, so
 * the two can never disagree.
 *
 * AN ARCHIVED PARENT HIDES ITS COMMENTS. Clip Mockups and their dividers are
 * archived, not deleted, so their comments stay in the table; every read here
 * drops a comment whose parent is archived, and a write cannot land on one.
 *
 * EVERY WRITE GOES THROUGH THE DRAFT GUARD. A comment hangs off a Video, so a
 * Version owns it (CODING_STANDARDS.md, "A write to anything a Version owns
 * goes through the Draft guard"). Each write runs in its own transaction so
 * the guard's row lock is held until the write commits.
 *
 * Delete is a real DELETE, not an Archive: a comment is a passing note.
 */

/** What a comment hangs off: exactly one Clip Mockup or one divider. */
export type ClipMockupCommentTarget =
  | { readonly type: "clip-mockup"; readonly id: string }
  | { readonly type: "clip-mockup-chapter"; readonly id: string };

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/** A comment is visible only while its parent is not archived. */
const parentIsActive = or(
  and(
    isNull(clipMockupComments.clipMockupChapterId),
    eq(clipMockups.archived, false)
  ),
  and(
    isNull(clipMockupComments.clipMockupId),
    eq(clipMockupChapters.archived, false)
  )
);

const createClipMockupCommentOperations = (db: Database) => {
  const selectActive = () =>
    db
      .select({
        id: clipMockupComments.id,
        videoId: clipMockupComments.videoId,
        clipMockupId: clipMockupComments.clipMockupId,
        clipMockupChapterId: clipMockupComments.clipMockupChapterId,
        body: clipMockupComments.body,
        createdAt: clipMockupComments.createdAt,
        updatedAt: clipMockupComments.updatedAt,
      })
      .from(clipMockupComments)
      .leftJoin(
        clipMockups,
        eq(clipMockups.id, clipMockupComments.clipMockupId)
      )
      .leftJoin(
        clipMockupChapters,
        eq(clipMockupChapters.id, clipMockupComments.clipMockupChapterId)
      );

  /**
   * Every visible comment of a Video, oldest first — backs
   * `cvm clip-mockup-comment list`, the Animatic and the teleprompter.
   */
  const listClipMockupCommentsByVideoId = (videoId: string) =>
    makeDbCall(() =>
      selectActive()
        .where(and(eq(clipMockupComments.videoId, videoId), parentIsActive))
        .orderBy(asc(clipMockupComments.createdAt), asc(clipMockupComments.id))
    );

  const requireClipMockupComment = (id: string) =>
    Effect.gen(function* () {
      const [row] = yield* makeDbCall(() =>
        selectActive().where(and(eq(clipMockupComments.id, id), parentIsActive))
      );
      if (!row) {
        return yield* new NotFoundError({
          type: "clipMockupComment",
          params: { id },
        });
      }
      return row;
    });

  /** The active parent's Video, or a NotFound naming the target. */
  const requireTargetVideoId = (target: ClipMockupCommentTarget) =>
    Effect.gen(function* () {
      const parent = yield* makeDbCall(() =>
        target.type === "clip-mockup"
          ? db.query.clipMockups.findFirst({
              where: and(
                eq(clipMockups.id, target.id),
                eq(clipMockups.archived, false)
              ),
              columns: { videoId: true },
            })
          : db.query.clipMockupChapters.findFirst({
              where: and(
                eq(clipMockupChapters.id, target.id),
                eq(clipMockupChapters.archived, false)
              ),
              columns: { videoId: true },
            })
      );
      if (!parent) {
        return yield* new NotFoundError({
          type:
            target.type === "clip-mockup" ? "clipMockup" : "clipMockupChapter",
          params: { id: target.id },
        });
      }
      return parent.videoId;
    });

  /** Pin a new comment to a Clip Mockup or a Clip Mockup Chapter. */
  const createClipMockupComment = Effect.fn("createClipMockupComment")(
    function* (target: ClipMockupCommentTarget, body: string) {
      const videoId = yield* requireTargetVideoId(target);
      yield* requireDraftVersionForVideo(db, videoId);
      const [row] = yield* makeDbCall(() =>
        db
          .insert(clipMockupComments)
          .values({
            videoId,
            clipMockupId: target.type === "clip-mockup" ? target.id : null,
            clipMockupChapterId:
              target.type === "clip-mockup-chapter" ? target.id : null,
            body,
          })
          .returning()
      );
      if (!row) {
        return yield* new UnknownDBServiceError({
          cause: "No clip mockup comment was returned from the database",
        });
      }
      return row;
    }
  );

  /** Replace a comment's body. The parent never changes. */
  const updateClipMockupComment = Effect.fn("updateClipMockupComment")(
    function* (id: string, values: { readonly body: string }) {
      const comment = yield* requireClipMockupComment(id);
      yield* requireDraftVersionForVideo(db, comment.videoId);
      yield* makeDbCall(() =>
        db
          .update(clipMockupComments)
          .set({ body: values.body, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(clipMockupComments.id, id))
      );
      return yield* requireClipMockupComment(id);
    }
  );

  /** Delete a comment for good, handing back the row as it was. */
  const deleteClipMockupComment = Effect.fn("deleteClipMockupComment")(
    function* (id: string) {
      const comment = yield* requireClipMockupComment(id);
      yield* requireDraftVersionForVideo(db, comment.videoId);
      yield* makeDbCall(() =>
        db.delete(clipMockupComments).where(eq(clipMockupComments.id, id))
      );
      return comment;
    }
  );

  return {
    listClipMockupCommentsByVideoId,
    getClipMockupCommentById: requireClipMockupComment,
    createClipMockupComment,
    updateClipMockupComment,
    deleteClipMockupComment,
  };
};

export class ClipMockupCommentOperationsService extends Effect.Service<ClipMockupCommentOperationsService>()(
  "ClipMockupCommentOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return transactionalizeWrites(db, createClipMockupCommentOperations, [
        "createClipMockupComment",
        "updateClipMockupComment",
        "deleteClipMockupComment",
      ]);
    }),
  }
) {}
