import type { PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import {
  agentSessionEntries,
  beatLearningGoals,
  clips,
  clipTranscriptWords,
  clipWebLinks,
  learningGoals,
  overlays,
} from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * The rows that hang off a copied Section, Beat or Clip, shared by every copy
 * path (Submit's version copy, duplicateCourse, the Video copy). Each path
 * makes the new parent ids itself (see `newIdsFor`), then hands the old -> new
 * maps here so the children are re-pointed at the COPY of their parent. A child
 * whose parent was not copied (it was archived, on a path that drops archived
 * rows) is dropped with it.
 *
 * Which path copies which table, and why the rest do not, is the table-level
 * guard in copy-paths-table-guard.test.ts.
 */

type LearningGoalRow = typeof learningGoals.$inferSelect;
type BeatLearningGoalRow = typeof beatLearningGoals.$inferSelect;

export type ClipWithChildren = {
  readonly id: string;
  readonly webLinks: ReadonlyArray<typeof clipWebLinks.$inferSelect>;
  readonly transcriptWords: ReadonlyArray<
    typeof clipTranscriptWords.$inferSelect
  >;
  readonly overlays: ReadonlyArray<typeof overlays.$inferSelect>;
  readonly agentSessionEntries: ReadonlyArray<
    typeof agentSessionEntries.$inferSelect
  >;
};

/** The relational `with` that loads what `copyClipChildren` needs. */
export const clipChildrenWith = {
  webLinks: true,
  transcriptWords: true,
  overlays: true,
  agentSessionEntries: true,
} as const;

// A Clip carries hundreds to thousands of Transcript Words; keep each insert
// well under Postgres's 65535 bind-parameter ceiling.
const CHUNK = 1000;

/** Anything that can insert: the database itself or an open transaction. */
type Inserter = Pick<Database, "insert">;

/** A Clip row loaded with `clipChildrenWith`. */
export type ClipToCopy = typeof clips.$inferSelect & ClipWithChildren;

export const insertInChunks = async <T extends PgTable>(
  tx: Inserter,
  table: T,
  rows: ReadonlyArray<PgInsertValue<T>>
) => {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insert(table).values(rows.slice(i, i + CHUNK));
  }
};

/**
 * A Section's live Learning Goals, onto the copy of that Section. Ids come
 * from `goalIds` so the Beat links can be re-pointed afterwards.
 */
export const copyLearningGoalValues = (
  goals: ReadonlyArray<LearningGoalRow>,
  newSectionId: string,
  goalIds: ReadonlyMap<string, string>
): (typeof learningGoals.$inferInsert)[] =>
  goals.flatMap((goal) => {
    const id = goalIds.get(goal.id);
    if (!id || goal.archived) return [];
    return [
      {
        id,
        sectionId: newSectionId,
        title: goal.title,
        description: goal.description,
        priority: goal.priority,
        order: goal.order,
      },
    ];
  });

/**
 * Beat -> Learning Goal links, re-pointed at the copied Beat and at whatever
 * `goalIdFor` says the Goal is in the copy (a new id in a version copy, the
 * same id in a Video copy, which stays in its Section). A link whose Beat or
 * Goal was not copied is dropped.
 */
export const copyBeatLearningGoalValues = (
  links: ReadonlyArray<BeatLearningGoalRow>,
  beatIds: ReadonlyMap<string, string>,
  goalIdFor: (sourceGoalId: string) => string | undefined
): BeatLearningGoalRow[] =>
  links.flatMap((link) => {
    const beatId = beatIds.get(link.beatId);
    const learningGoalId = goalIdFor(link.learningGoalId);
    return beatId && learningGoalId ? [{ beatId, learningGoalId }] : [];
  });

/** Every column but `id`, re-pointed at the copied Clip. */
const rebaseOntoClips = <R extends { id: string; clipId: string }>(
  rows: ReadonlyArray<R>,
  clipIds: ReadonlyMap<string, string>
): Omit<R, "id">[] =>
  rows.flatMap(({ id: _id, ...row }) => {
    const clipId = clipIds.get(row.clipId);
    return clipId ? [{ ...row, clipId }] : [];
  });

/**
 * A copied Clip's Clip Web Links, Transcript Words, Overlays and Agent Session
 * Entries. Each is timed against the Clip's own start or its Footage, and the
 * copy keeps the Clip's source range, so every row carries over verbatim. An
 * Agent Session Entry keeps pointing at the same Agent Session: sessions are
 * shared by every copy, never copied.
 */
export const copyClipChildren = async (
  tx: Inserter,
  sourceClips: ReadonlyArray<ClipWithChildren>,
  clipIds: ReadonlyMap<string, string>
) => {
  await insertInChunks(
    tx,
    clipWebLinks,
    rebaseOntoClips(
      sourceClips.flatMap((clip) => clip.webLinks),
      clipIds
    )
  );
  await insertInChunks(
    tx,
    clipTranscriptWords,
    rebaseOntoClips(
      sourceClips.flatMap((clip) => clip.transcriptWords),
      clipIds
    )
  );
  await insertInChunks(
    tx,
    overlays,
    rebaseOntoClips(
      sourceClips.flatMap((clip) => clip.overlays),
      clipIds
    )
  );
  await insertInChunks(
    tx,
    agentSessionEntries,
    rebaseOntoClips(
      sourceClips.flatMap((clip) => clip.agentSessionEntries),
      clipIds
    )
  );
};

/**
 * Copies Clips onto a Video, each at the place given, with every row that
 * hangs off them. For the Video-level copies — the Video copy and Create video
 * from selection — so neither of them hand-lists what a
 * Clip is made of. Every Clip column but its identity and its place comes from
 * spreading the source row, so a Clip column added later travels with no edit
 * here; a Clip child table added later fails copy-paths-table-guard.test.ts
 * until `copyClipChildren` carries it. That includes `archived` (an archived
 * Clip stays archived: which ones a path passes in is its own choice, see
 * `keepsArchived` in version-copy-manifest.ts) and `createdAt`, when the take
 * was filmed, which the footage stats date it by.
 *
 * The one column the caller decides is `origin` (Clip Origin): `"copy"` for a
 * user-made copy, whose original stays where it was, so the copy is not new
 * filming; `"keep"` to carry the original's, for a move (Create video from
 * selection in "move" mode archives the originals, so the moved Clip is the
 * take and must still count).
 *
 * Returns the source -> copy Clip id map.
 */
export const copyClipsOntoVideo = async (
  tx: Inserter,
  placements: ReadonlyArray<{
    readonly clip: ClipToCopy;
    readonly videoId: string;
    readonly order: string;
  }>,
  options: { readonly origin: "copy" | "keep" }
): Promise<ReadonlyMap<string, string>> => {
  const clipIds = new Map(
    placements.map(({ clip }) => [clip.id, crypto.randomUUID()] as const)
  );
  await insertInChunks(
    tx,
    clips,
    placements.map(({ clip, videoId, order }) => {
      const {
        id,
        webLinks: _webLinks,
        transcriptWords: _transcriptWords,
        overlays: _overlays,
        agentSessionEntries: _agentSessionEntries,
        ...carried
      } = clip;
      return {
        ...carried,
        id: clipIds.get(id)!,
        videoId,
        order,
        origin: options.origin === "copy" ? ("copy" as const) : carried.origin,
      };
    })
  );
  await copyClipChildren(
    tx,
    placements.map(({ clip }) => clip),
    clipIds
  );
  return clipIds;
};
