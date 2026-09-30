import { compareOrderStrings } from "@/lib/sort-by-order";

/**
 * A Video's Animatic READ AS LINES rather than watched: every Clip Mockup's
 * spoken line, one clip at a time, under the Clip Mockup Chapter it sits in.
 * The author often films from these lines instead of the Script, and each one
 * is a Clip, so the boundaries between them are the point.
 *
 * Shared by the Teleprompter's Animatic view and the Video Editor's Animatic
 * tab, so the two read the same list in the same order.
 *
 * The two nouns share one fractional order space, so the list is ONE merged
 * sort of both kinds of row. EMPTY when there is no Clip Mockup: a Chapter
 * alone says nothing, so an empty list is how both surfaces know to hide. Sorted with `compareOrderStrings`, never
 * `localeCompare`: the column is `COLLATE "C"`.
 *
 * Every row carries the bodies of its Clip Mockup Comments, oldest first, so
 * the author sees their notes beside the line or divider while filming.
 */
export type AnimaticLine =
  | {
      readonly type: "chapter";
      readonly id: string;
      readonly name: string;
      readonly comments: readonly string[];
    }
  | {
      readonly type: "clip-mockup";
      readonly id: string;
      readonly line: string;
      readonly comments: readonly string[];
      /**
       * 1-based, counting Clip Mockups only — the same number the Animatic
       * page shows, so "number 14" means one clip everywhere.
       */
      readonly position: number;
    };

/** What a comment needs to be filed under its parent. */
export interface CommentParentIds {
  readonly clipMockupId: string | null;
  readonly clipMockupChapterId: string | null;
}

/**
 * Comments keyed by the id of the one Clip Mockup or Clip Mockup Chapter they
 * hang off, each list in the order given. The one place that reads the pair of
 * parent ids, for the teleprompter's lines and the Animatic's threads alike.
 */
export function groupCommentsByParent<C extends CommentParentIds>(
  comments: readonly C[]
): ReadonlyMap<string, readonly C[]> {
  const byParent = new Map<string, C[]>();
  for (const comment of comments) {
    const parentId = comment.clipMockupId ?? comment.clipMockupChapterId;
    if (!parentId) continue;
    const list = byParent.get(parentId) ?? [];
    list.push(comment);
    byParent.set(parentId, list);
  }
  return byParent;
}

export function buildAnimaticLines(params: {
  readonly clipMockups: readonly {
    readonly id: string;
    readonly line: string;
    readonly order: string;
  }[];
  readonly chapters: readonly {
    readonly id: string;
    readonly name: string;
    readonly order: string;
  }[];
  /** Oldest first; each hangs off exactly one Clip Mockup or Chapter. */
  readonly comments: readonly (CommentParentIds & { readonly body: string })[];
}): AnimaticLine[] {
  if (params.clipMockups.length === 0) return [];

  const commentsByParent = groupCommentsByParent(params.comments);

  const rows = [
    ...params.clipMockups.map((m) => ({ kind: "clip-mockup" as const, ...m })),
    ...params.chapters.map((c) => ({ kind: "chapter" as const, ...c })),
  ].sort((a, b) => compareOrderStrings(a.order, b.order));

  let position = 0;
  return rows.map((row): AnimaticLine => {
    const comments = (commentsByParent.get(row.id) ?? []).map((c) => c.body);
    if (row.kind === "chapter") {
      return { type: "chapter", id: row.id, name: row.name, comments };
    }
    position++;
    return {
      type: "clip-mockup",
      id: row.id,
      line: row.line,
      comments,
      position,
    };
  });
}
