import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * Which copy path carries which table, and the FK graph that says which tables
 * there are. Product code, not test code, because Submit itself reads it: after
 * the copy, every `copied` table's row count in the new Draft must equal the
 * source's (see `assertCopyComplete` in version-copy-check.server.ts), or the
 * Submit rolls back. A path copies a table's LIVE rows, plus its archived ones
 * for the tables in its `keepsArchived` (they arrive still archived).
 *
 * copy-paths-table-guard.test.ts fails until every table below a path's root
 * is decided here, and holds each decision to what the path really does.
 * copy-paths.round-trip.test.ts then holds every `copied` table to carrying
 * every column. A NEW PATH THAT COPIES A CLIP OR A VIDEO BELONGS HERE.
 * scripts/check-clip-inserts.sh (in check:static) fails any Clip insert outside
 * its allowlist, so a copy path can't skip this file unnoticed.
 */

export type CopyDecision = "copied" | { notCopied: string };
export type CopyPathName =
  | "submit"
  | "duplicateCourse"
  | "videoCopy"
  | "createVideoFromSelection"
  | "concatenateVideos";

const NEVER_POSTED =
  "A Video Post records where one Video row was posted. Only standalone " +
  "Shorts are posted, and they never sit in a Course; a copied Video has " +
  "never been posted anywhere.";

const SHARED_FOOTAGE =
  "A Recording Session is the CVM recorder's Footage: files on the author's " +
  "machine plus their scene timeline. A copied Clip keeps pointing at the " +
  "same Recording Session, as an OBS Clip keeps its Footage path, so the " +
  "copy draws the same picture.";

/** A Recording Session, its scene timeline and Chat Highlights: shared by every copy. */
const RECORDING_SESSION_TABLES: Record<string, CopyDecision> = {
  recording_session: { notCopied: SHARED_FOOTAGE },
  recording_session_scene_event: { notCopied: SHARED_FOOTAGE },
  // A Chat Highlight belongs to its streamed Recording Session (#2461), on
  // that Footage's clock: shared with it, never copied.
  chat_highlight: { notCopied: SHARED_FOOTAGE },
};

/** Every table below a Course Version, decided for a whole-version copy. */
const VERSION_TABLES: Record<string, CopyDecision> = {
  section: "copied",
  learning_goal: "copied",
  lesson: "copied",
  video: "copied",
  clip: "copied",
  clip_web_link: "copied",
  clip_transcript_word: "copied",
  overlay: "copied",
  agent_session_entry: "copied",
  chapter: "copied",
  beat: "copied",
  beat_learning_goal: "copied",
  clip_mockup: "copied",
  clip_mockup_chapter: "copied",
  clip_mockup_comment: "copied",
  thumbnail: "copied",
  video_post: { notCopied: NEVER_POSTED },
  ...RECORDING_SESSION_TABLES,
};

/**
 * A Clip and everything that hangs off it. Every path that copies a Clip
 * copies all of these, through `copyClipChildren` in copy-child-rows.ts.
 */
const CLIP_TABLES: Record<string, CopyDecision> = {
  clip: "copied",
  clip_web_link: "copied",
  clip_transcript_word: "copied",
  overlay: "copied",
  agent_session_entry: "copied",
};

/**
 * An archived Clip is a take the author filmed and cut. It is the only record
 * that the take existed (the filming efficiency counts it), and it can be
 * reviewed and restored, so a copy that stands in for its source carries it,
 * still archived. Otherwise a Discard, which deletes the Pending Version and
 * with it the original rows, would delete every archived take for good.
 */
const KEEPS_ARCHIVED_CLIPS = ["clip"] as const;

const NOT_THE_TIMELINE =
  "This path builds a new Video out of filmed Clips and their Chapters only. " +
  "The source's plan (Beats, the Animatic) and its Thumbnail describe the " +
  "whole source Video, not the part of its timeline that was copied.";

/** Every table below a Video, for the paths that copy only its timeline. */
const TIMELINE_TABLES: Record<string, CopyDecision> = {
  ...CLIP_TABLES,
  chapter: "copied",
  beat: { notCopied: NOT_THE_TIMELINE },
  beat_learning_goal: { notCopied: NOT_THE_TIMELINE },
  clip_mockup: { notCopied: NOT_THE_TIMELINE },
  clip_mockup_chapter: { notCopied: NOT_THE_TIMELINE },
  clip_mockup_comment: { notCopied: NOT_THE_TIMELINE },
  thumbnail: { notCopied: NOT_THE_TIMELINE },
  video_post: { notCopied: NEVER_POSTED },
  ...RECORDING_SESSION_TABLES,
};

export type CopyPath = {
  root: PgTable;
  tables: Record<string, CopyDecision>;
  /**
   * The `copied` tables whose archived rows travel too, still archived. A
   * row below one of them (a Transcript Word of an archived Clip) travels
   * with it.
   */
  keepsArchived: ReadonlyArray<string>;
};

export const COPY_PATHS: Record<CopyPathName, CopyPath> = {
  submit: {
    root: schema.courseVersions,
    tables: VERSION_TABLES,
    keepsArchived: KEEPS_ARCHIVED_CLIPS,
  },
  duplicateCourse: {
    root: schema.courseVersions,
    tables: VERSION_TABLES,
    keepsArchived: KEEPS_ARCHIVED_CLIPS,
  },
  videoCopy: {
    root: schema.videos,
    keepsArchived: KEEPS_ARCHIVED_CLIPS,
    tables: {
      ...CLIP_TABLES,
      chapter: "copied",
      beat: "copied",
      beat_learning_goal: "copied",
      clip_mockup: "copied",
      clip_mockup_chapter: "copied",
      clip_mockup_comment: "copied",
      thumbnail: {
        notCopied:
          "Thumbnail PNG paths are keyed by the source Video's lineage " +
          "(#1674) and this path neither rebases nor moves them, so verbatim " +
          "rows would alias the source's files. A copy starts without one.",
      },
      video_post: { notCopied: NEVER_POSTED },
      ...RECORDING_SESSION_TABLES,
    },
  },
  /**
   * The video editor's "Create video from selection", copy or move. It copies
   * the Clips the author selected, which are live ones; the source keeps its
   * archived Clips (a move archives the selection, it deletes nothing), so
   * none are lost.
   */
  createVideoFromSelection: {
    root: schema.videos,
    tables: TIMELINE_TABLES,
    keepsArchived: [],
  },
  /**
   * POST /api/videos/concatenate: many Videos' timelines into a new one. The
   * sources are left as they are, archived Clips and all, so the new Video
   * is the joined live timelines only.
   */
  concatenateVideos: {
    root: schema.videos,
    tables: TIMELINE_TABLES,
    keepsArchived: [],
  },
};

// ---------------------------------------------------------------------------
// The FK graph, read from the Drizzle schema.

const PREFIX = "course-video-manager_";

export const ALL_TABLES: PgTable[] = (
  Object.values(schema) as unknown[]
).filter((value): value is PgTable => is(value, PgTable));

export const shortName = (table: PgTable) =>
  getTableName(table).replace(PREFIX, "");

export const tableByShortName = (name: string) =>
  ALL_TABLES.find((t) => shortName(t) === name)!;

export type FkEdge = {
  from: PgTable;
  column: string;
  /** The TS key of `column` on `from`. */
  key: string;
  notNull: boolean;
  to: PgTable;
  toColumn: string;
};

export const parentEdges = (table: PgTable): FkEdge[] => {
  const keyOf = new Map(
    Object.entries(getTableColumns(table)).map(([key, col]) => [col.name, key])
  );
  return getTableConfig(table).foreignKeys.flatMap((fk) => {
    const ref = fk.reference();
    const column = ref.columns[0]!;
    return ref.foreignTable === table
      ? []
      : [
          {
            from: table,
            column: column.name,
            key: keyOf.get(column.name)!,
            notNull: column.notNull,
            to: ref.foreignTable,
            toColumn: ref.foreignColumns[0]!.name,
          },
        ];
  });
};

/** Shortest chain of foreign keys from `table` up to `root`, if any. */
export const pathToRoot = (
  table: PgTable,
  root: PgTable
): FkEdge[] | undefined => {
  const queue: Array<{ at: PgTable; path: FkEdge[] }> = [
    { at: table, path: [] },
  ];
  const seen = new Set<PgTable>([table]);
  while (queue.length > 0) {
    const { at, path } = queue.shift()!;
    for (const edge of parentEdges(at)) {
      if (edge.to === root) return [...path, edge];
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push({ at: edge.to, path: [...path, edge] });
    }
  }
  return undefined;
};

export const tablesBelow = (root: PgTable) =>
  ALL_TABLES.filter((t) => t !== root && pathToRoot(t, root));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * SQL that a row of `table` (as `alias`) is not archived itself. A table in
 * `keepsArchived` counts its archived rows too.
 */
const notArchived = (
  table: PgTable,
  alias: string,
  keepsArchived: ReadonlySet<PgTable>
) => {
  if (keepsArchived.has(table)) return [];
  const columns = getTableColumns(table);
  if ("archived" in columns) return [`${alias}."archived" = false`];
  if ("archivedAt" in columns) return [`${alias}."archived_at" IS NULL`];
  return [];
};

/**
 * SQL that a row is one the copy path carries: LIVE (not archived, unless its
 * table is in `keepsArchived`), and every parent it points at below `root`
 * carried too — so a Clip Mockup Comment on an archived Clip Mockup, or a
 * Beat link to an archived Beat, does not count, while a Transcript Word of an
 * archived Clip does on a path that keeps archived Clips.
 */
const carriedSql = (
  table: PgTable,
  alias: string,
  root: PgTable,
  below: ReadonlySet<PgTable>,
  keepsArchived: ReadonlySet<PgTable>
): string => {
  const conditions = notArchived(table, alias, keepsArchived);
  parentEdges(table).forEach((edge, i) => {
    if (!below.has(edge.to)) return;
    const parent = `${alias}_${i}`;
    const exists = `EXISTS (SELECT 1 FROM ${quote(getTableName(edge.to))} ${parent} WHERE ${parent}.${quote(edge.toColumn)} = ${alias}.${quote(edge.column)} AND ${carriedSql(edge.to, parent, root, below, keepsArchived)})`;
    conditions.push(
      edge.notNull
        ? exists
        : `(${alias}.${quote(edge.column)} IS NULL OR ${exists})`
    );
  });
  return conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
};

/**
 * How many `table` rows below the root row `rootId` the copy path `path`
 * carries: its live rows, plus its archived ones where the path keeps them.
 */
export const countCarriedBelow = async (
  db: Pick<Database, "execute">,
  path: CopyPathName,
  table: PgTable,
  rootId: string
): Promise<number> => {
  const { root, keepsArchived } = COPY_PATHS[path];
  const route = pathToRoot(table, root)!;
  const joins = route
    .slice(0, -1)
    .map(
      (edge, i) =>
        `JOIN ${quote(getTableName(edge.to))} t${i + 1} ON t${i}.${quote(edge.column)} = t${i + 1}.${quote(edge.toColumn)}`
    )
    .join(" ");
  const last = route[route.length - 1]!;
  const carried = carriedSql(
    table,
    "t0",
    root,
    new Set(tablesBelow(root)),
    new Set(keepsArchived.map(tableByShortName))
  );
  const result = await db.execute<{ n: number }>(
    sql`${sql.raw(
      `SELECT count(*)::int AS n FROM ${quote(getTableName(table))} t0 ${joins} WHERE ${carried} AND t${route.length - 1}.${quote(last.column)} = `
    )}${rootId}`
  );
  return Number(result.rows[0]!.n);
};
