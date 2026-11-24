import { DrizzleService, type Database } from "./drizzle-service.server.js";
import {
  agentSessionEntries,
  agentSessions,
  clips,
  recordingSessions,
  videos,
} from "../db/schema.js";
import {
  AgentSessionUploadRefusedError,
  NotFoundError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { Effect } from "effect";
import { requireDraftVersionForVideo } from "./draft-guard.server.js";
import { transactionalizeWrites } from "./with-db-transaction.server.js";
import { insertInChunks } from "./copy-child-rows.js";
import { clipLayersRelation } from "./clip-layers-relation.js";
import { clipRecordingSessionRelation } from "./clip-recording-session-relation.js";
import {
  fromEntryColumns,
  toEntryColumns,
  type AgentSessionEntryContent,
} from "../features/agent-sessions/agent-session-entry.js";
import { findAgentSessionContentProblems } from "../features/agent-sessions/content-rules.js";
import { anchorEntries } from "../features/agent-sessions/anchor-entries.js";

/**
 * Agent Sessions and their entries (GLOSSARY.md) — the Claude Code session on
 * screen in a Video, stored on the Clips that show it. Backs `cvm video
 * agent-sessions set | get | clear`.
 *
 * A Video's entries are replaced WHOLE: `set` deletes every entry on the
 * Video's Clips and stores the new ones in one transaction, behind the Draft
 * guard, then deletes every Agent Session left with no entries anywhere. An
 * upload that breaks a content rule, or whose Claude Code session id matches
 * more than one Agent Session, is refused before anything is written.
 */

/** One Claude Code session as the reader hands it over: entries on the wall clock. */
export type AgentSessionUpload = {
  readonly sourceSessionId: string;
  /** In session order; each is content plus when it was written (epoch ms). */
  readonly entries: ReadonlyArray<
    AgentSessionEntryContent & { readonly wallClockMs: number }
  >;
};

/** What `set` did with each uploaded session. */
export type AgentSessionSetReport = {
  readonly videoId: string;
  readonly sessions: ReadonlyArray<{
    readonly sourceSessionId: string;
    /** Null when none of its entries was kept, so none was stored. */
    readonly agentSessionId: string | null;
    readonly reused: boolean;
    readonly kept: number;
    readonly droppedAfterLastScreenClip: number;
  }>;
  /** Screen Clips nothing could be anchored to: no Footage start is known. */
  readonly clipsWithoutFootageStart: ReadonlyArray<string>;
  readonly agentSessionsDeleted: number;
};

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

const refuse = (reasons: ReadonlyArray<string>) =>
  new AgentSessionUploadRefusedError({
    reasons,
    message: `Agent Session upload refused, nothing was stored:\n- ${reasons.join("\n- ")}`,
  });

const createAgentSessionOperations = (db: Database) => {
  const requireVideo = (videoId: string) =>
    Effect.gen(function* () {
      const [video] = yield* makeDbCall(() =>
        db.select({ id: videos.id }).from(videos).where(eq(videos.id, videoId))
      );
      if (!video) {
        return yield* new NotFoundError({ type: "video", params: { videoId } });
      }
      return video;
    });

  /** The Video's live Clips in video order, with what anchoring reads. */
  const liveClipsOf = (videoId: string) =>
    makeDbCall(() =>
      db
        .select({
          id: clips.id,
          order: clips.order,
          videoFilename: clips.videoFilename,
          sourceStartTime: clips.sourceStartTime,
          sourceEndTime: clips.sourceEndTime,
          pauseType: clips.pauseType,
          scene: clips.scene,
          sceneOverride: clips.sceneOverride,
          recordingSessionStartedAt: recordingSessions.startedAt,
        })
        .from(clips)
        .leftJoin(
          recordingSessions,
          eq(recordingSessions.id, clips.recordingSessionId)
        )
        .where(and(eq(clips.videoId, videoId), eq(clips.archived, false)))
        .orderBy(asc(clips.order))
    );

  const placementClipsOf = (videoId: string) =>
    makeDbCall(() =>
      db.query.clips.findMany({
        columns: {
          id: true,
          order: true,
          videoFilename: true,
          sourceStartTime: true,
          sourceEndTime: true,
          pauseType: true,
          scene: true,
          sceneOverride: true,
          recordingSessionId: true,
        },
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
        with: {
          recordingSession: clipRecordingSessionRelation,
          layers: clipLayersRelation,
        },
      })
    );

  const clipIdsOf = (videoId: string) =>
    db.select({ id: clips.id }).from(clips).where(eq(clips.videoId, videoId));

  const deleteEntriesOf = (videoId: string) =>
    makeDbCall(() =>
      db
        .delete(agentSessionEntries)
        .where(inArray(agentSessionEntries.clipId, clipIdsOf(videoId)))
        .returning({ id: agentSessionEntries.id })
    );

  /** Every Agent Session with no entries anywhere, deleted. */
  const deleteOrphanSessions = () =>
    makeDbCall(() =>
      db
        .delete(agentSessions)
        .where(
          notExists(
            db
              .select({ one: sql`1` })
              .from(agentSessionEntries)
              .where(eq(agentSessionEntries.agentSessionId, agentSessions.id))
          )
        )
        .returning({ id: agentSessions.id })
    );

  /** Problems with the upload as a whole, before anything is looked up. */
  const uploadProblems = (uploads: ReadonlyArray<AgentSessionUpload>) => {
    const seen = new Set<string>();
    const duplicates = uploads.flatMap(({ sourceSessionId }) => {
      if (!seen.has(sourceSessionId)) {
        seen.add(sourceSessionId);
        return [];
      }
      return [`session ${sourceSessionId} was given more than once`];
    });
    const content = findAgentSessionContentProblems(
      uploads.flatMap((upload) =>
        upload.entries.map(({ wallClockMs: _wallClockMs, ...entry }, i) => ({
          label: `session ${upload.sourceSessionId} entry ${i + 1}`,
          entry,
        }))
      )
    );
    return [...duplicates, ...content];
  };

  /** Each upload's existing Agent Session id, or a refusal reason. */
  const lookUpSessions = (uploads: ReadonlyArray<AgentSessionUpload>) =>
    Effect.gen(function* () {
      const ids = uploads.map((u) => u.sourceSessionId);
      const rows =
        ids.length === 0
          ? []
          : yield* makeDbCall(() =>
              db
                .select({
                  id: agentSessions.id,
                  sourceSessionId: agentSessions.sourceSessionId,
                })
                .from(agentSessions)
                .where(inArray(agentSessions.sourceSessionId, ids))
            );
      const existing = new Map<string, string>();
      const reasons: string[] = [];
      for (const id of ids) {
        const matches = rows.filter((row) => row.sourceSessionId === id);
        if (matches.length > 1) {
          reasons.push(
            `session ${id} matches ${matches.length} Agent Sessions (${matches.map((m) => m.id).join(", ")}); expected at most one`
          );
        } else if (matches[0]) {
          existing.set(id, matches[0].id);
        }
      }
      return { existing, reasons };
    });

  /**
   * Replace every Agent Session Entry on the Video's Clips with these
   * sessions' entries, each anchored to a screen Clip.
   */
  const setVideoAgentSessions = Effect.fn("setVideoAgentSessions")(function* (
    videoId: string,
    uploads: ReadonlyArray<AgentSessionUpload>
  ) {
    yield* requireVideo(videoId);
    yield* requireDraftVersionForVideo(db, videoId);

    const lookup = yield* lookUpSessions(uploads);
    const reasons = [...uploadProblems(uploads), ...lookup.reasons];
    if (reasons.length > 0) return yield* refuse(reasons);

    const cut = yield* liveClipsOf(videoId);
    yield* deleteEntriesOf(videoId);

    let clipsWithoutFootageStart: ReadonlyArray<string> = [];
    const sessions: Array<AgentSessionSetReport["sessions"][number]> = [];
    for (const upload of uploads) {
      const result = anchorEntries(
        cut,
        upload.entries.map(({ wallClockMs, ...content }, sequence) => ({
          wallClockMs,
          sequence,
          content,
        }))
      );
      clipsWithoutFootageStart = result.clipsWithoutFootageStart;
      const reusedId = lookup.existing.get(upload.sourceSessionId);
      let agentSessionId: string | null = null;
      if (result.anchored.length > 0) {
        agentSessionId = reusedId ?? crypto.randomUUID();
        if (!reusedId) {
          const id = agentSessionId;
          yield* makeDbCall(() =>
            db
              .insert(agentSessions)
              .values({ id, sourceSessionId: upload.sourceSessionId })
          );
        }
        const sessionId = agentSessionId;
        yield* makeDbCall(() =>
          insertInChunks(
            db,
            agentSessionEntries,
            result.anchored.map(
              ({ clipId, footageTime, sequence, content }) => ({
                agentSessionId: sessionId,
                clipId,
                footageTime,
                sequence,
                ...toEntryColumns(content),
              })
            )
          )
        );
      }
      sessions.push({
        sourceSessionId: upload.sourceSessionId,
        agentSessionId,
        reused: agentSessionId !== null && reusedId !== undefined,
        kept: result.anchored.length,
        droppedAfterLastScreenClip: result.afterLastScreenClip,
      });
    }

    const orphans = yield* deleteOrphanSessions();
    return {
      videoId,
      sessions,
      clipsWithoutFootageStart,
      agentSessionsDeleted: orphans.length,
    } satisfies AgentSessionSetReport;
  });

  /**
   * The Video's live Clips in video order, and every Agent Session Entry on
   * any of its Clips (archived ones too), each with its session.
   */
  const getVideoAgentSessions = Effect.fn("getVideoAgentSessions")(function* (
    videoId: string
  ) {
    yield* requireVideo(videoId);
    const cut = yield* placementClipsOf(videoId);
    const rows = yield* makeDbCall(() =>
      db
        .select({
          id: agentSessionEntries.id,
          agentSessionId: agentSessionEntries.agentSessionId,
          sourceSessionId: agentSessions.sourceSessionId,
          clipId: agentSessionEntries.clipId,
          footageTime: agentSessionEntries.footageTime,
          sequence: agentSessionEntries.sequence,
          kind: agentSessionEntries.kind,
          text: agentSessionEntries.text,
          skill: agentSessionEntries.skill,
          via: agentSessionEntries.via,
          args: agentSessionEntries.args,
          tool: agentSessionEntries.tool,
          summary: agentSessionEntries.summary,
          resultIsError: agentSessionEntries.resultIsError,
        })
        .from(agentSessionEntries)
        .innerJoin(
          agentSessions,
          eq(agentSessions.id, agentSessionEntries.agentSessionId)
        )
        .where(inArray(agentSessionEntries.clipId, clipIdsOf(videoId)))
        .orderBy(
          asc(agentSessionEntries.agentSessionId),
          asc(agentSessionEntries.sequence)
        )
    );
    return {
      videoId,
      clips: cut,
      entries: rows.map(
        ({
          kind,
          text,
          skill,
          via,
          args,
          tool,
          summary,
          resultIsError,
          ...placed
        }) => ({
          ...placed,
          content: fromEntryColumns({
            kind,
            text,
            skill,
            via,
            args,
            tool,
            summary,
            resultIsError,
          }),
        })
      ),
    };
  });

  /** Remove every Agent Session Entry on the Video's Clips. */
  const clearVideoAgentSessions = Effect.fn("clearVideoAgentSessions")(
    function* (videoId: string) {
      yield* requireVideo(videoId);
      yield* requireDraftVersionForVideo(db, videoId);
      const deleted = yield* deleteEntriesOf(videoId);
      const orphans = yield* deleteOrphanSessions();
      return {
        videoId,
        entriesDeleted: deleted.length,
        agentSessionsDeleted: orphans.length,
      };
    }
  );

  return {
    setVideoAgentSessions,
    getVideoAgentSessions,
    clearVideoAgentSessions,
  };
};

export class AgentSessionOperationsService extends Effect.Service<AgentSessionOperationsService>()(
  "AgentSessionOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return transactionalizeWrites(db, createAgentSessionOperations, [
        "setVideoAgentSessions",
        "clearVideoAgentSessions",
      ]);
    }),
  }
) {}
