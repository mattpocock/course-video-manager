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
 */
export type AnimaticLine =
  | { readonly type: "chapter"; readonly id: string; readonly name: string }
  | {
      readonly type: "clip-mockup";
      readonly id: string;
      readonly line: string;
      /**
       * 1-based, counting Clip Mockups only — the same number the Animatic
       * page shows, so "number 14" means one clip everywhere.
       */
      readonly position: number;
    };

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
}): AnimaticLine[] {
  if (params.clipMockups.length === 0) return [];

  const rows = [
    ...params.clipMockups.map((m) => ({ kind: "clip-mockup" as const, ...m })),
    ...params.chapters.map((c) => ({ kind: "chapter" as const, ...c })),
  ].sort((a, b) => compareOrderStrings(a.order, b.order));

  let position = 0;
  return rows.map((row): AnimaticLine => {
    if (row.kind === "chapter") {
      return { type: "chapter", id: row.id, name: row.name };
    }
    position++;
    return { type: "clip-mockup", id: row.id, line: row.line, position };
  });
}
