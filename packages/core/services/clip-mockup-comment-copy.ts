import type { clipMockupComments } from "../db/schema.js";

type CommentRow = typeof clipMockupComments.$inferSelect;

/**
 * A fresh id for each row about to be copied, keyed by its source id. The copy
 * paths make ids themselves rather than leave it to the table, so the comments
 * can be re-pointed at the copied parents.
 */
export const newIdsFor = (
  rows: ReadonlyArray<{ readonly id: string }>
): Map<string, string> =>
  new Map(rows.map((row) => [row.id, crypto.randomUUID()]));

/**
 * The insert values that carry a Video's Clip Mockup Comments into a copy of
 * that Video. Each comment is re-pointed at the COPY of its parent, looked up
 * in the old-id -> new-id maps the caller filled while copying the Clip
 * Mockups and their Chapters. A comment whose parent was not copied (it was
 * archived) is dropped, the same way its parent was.
 */
export const copyClipMockupCommentValues = (
  comments: ReadonlyArray<CommentRow>,
  newVideoId: string,
  clipMockupIds: ReadonlyMap<string, string>,
  clipMockupChapterIds: ReadonlyMap<string, string>
): (typeof clipMockupComments.$inferInsert)[] =>
  comments.flatMap((comment) => {
    const clipMockupId = comment.clipMockupId
      ? clipMockupIds.get(comment.clipMockupId)
      : undefined;
    const clipMockupChapterId = comment.clipMockupChapterId
      ? clipMockupChapterIds.get(comment.clipMockupChapterId)
      : undefined;
    if (!clipMockupId && !clipMockupChapterId) return [];
    return [
      {
        videoId: newVideoId,
        clipMockupId: clipMockupId ?? null,
        clipMockupChapterId: clipMockupChapterId ?? null,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      },
    ];
  });
