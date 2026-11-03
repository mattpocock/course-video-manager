import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import {
  clips,
  recordingSessions,
  recordingSessionSceneEvents,
  videos,
} from "../db/schema.js";
import { layerRowInVideoFormat } from "../features/videos/clip-layer.js";
import {
  recutHoldsOverlay,
  retimeShift,
} from "../features/videos/retime-cascade.js";
import { resolveVideoFormat } from "../features/videos/video-format.js";
import { clipChildrenWith, copyClipsOntoVideo } from "./copy-child-rows.js";
import { createClipRetimeOperationsUnwrapped } from "./db-clip-retime.server.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import {
  writeTranscriptWords,
  type TranscriptWordInput,
} from "./db-transcript-word-operations.server.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * `cvm short create`: a Standalone Short (no Lesson, Short format) made of
 * ranges of a Video, a Recording Session or a Footage file, joined in the
 * order given. The CLI parses and checks the ranges (it alone can read a
 * Footage transcript off disk) and hands over one Part per new Clip; this
 * writes them all in one transaction, so a failure leaves no half-made Short.
 *
 * - A `copy` Part is a Clip of a Video, copied by `copyClipsOntoVideo` (Clip
 *   Origin `copy`, every Clip column and child row carried, the same Recording
 *   Session) — its Overlays only from a Short, only those the Part's range
 *   holds, each cut to end by the range's end — then recut to the Part's range through
 *   `retimeClip`, so its Transcript Words are shifted and trimmed by the same
 *   cascade as any recut. Which tables this path copies, and why it leaves the
 *   rest, is COPY_PATHS.shortCreate in version-copy-manifest.ts.
 * - A `cut` Part is a new Clip (Clip Origin `cli`) cut from Footage, with the
 *   text and words the CLI sliced from that Footage's transcript. Cut from a
 *   Recording Session, it is that session's Clip: its mic file, its id, and the
 *   scene in force at its start.
 *
 * No file is copied and the source is never written.
 */

export type ShortPart =
  | {
      readonly kind: "copy";
      readonly clipId: string;
      readonly sourceStartTime: number;
      readonly sourceEndTime: number;
    }
  | {
      readonly kind: "cut";
      /** Cut from this Recording Session's mic file; null for plain Footage. */
      readonly recordingSessionId: string | null;
      /** The Footage path, as a Clip stores it. Ignored for a session cut. */
      readonly videoFilename: string;
      readonly sourceStartTime: number;
      readonly sourceEndTime: number;
      readonly text: string;
      readonly transcriptWords: ReadonlyArray<TranscriptWordInput>;
    };

const dbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

export const createShortOperationsUnwrapped = (db: Database) => {
  /** What `short create` needs of a Recording Session to cut from it. */
  const getRecordingSessionForCut = Effect.fn("getRecordingSessionForCut")(
    function* (recordingSessionId: string) {
      const session = yield* dbCall(() =>
        db.query.recordingSessions.findFirst({
          where: eq(recordingSessions.id, recordingSessionId),
          columns: { id: true, micFilePath: true, status: true },
        })
      );
      return session ?? null;
    }
  );

  /** The scene in force at a file time: the last scene event at or before it. */
  const sceneAt = (recordingSessionId: string, fileTime: number) =>
    dbCall(() =>
      db.query.recordingSessionSceneEvents.findFirst({
        where: and(
          eq(
            recordingSessionSceneEvents.recordingSessionId,
            recordingSessionId
          ),
          lte(recordingSessionSceneEvents.fileTime, fileTime)
        ),
        orderBy: (e, { desc }) => [desc(e.fileTime)],
        columns: { scene: true },
      })
    ).pipe(Effect.map((event) => event?.scene ?? null));

  const insertCut = Effect.fn("insertCut")(function* (
    videoId: string,
    order: string,
    part: Extract<ShortPart, { kind: "cut" }>
  ) {
    const session =
      part.recordingSessionId === null
        ? null
        : yield* getRecordingSessionForCut(part.recordingSessionId);
    if (part.recordingSessionId !== null && session === null) {
      return yield* new NotFoundError({
        type: "createShortFromRanges",
        params: { recordingSessionId: part.recordingSessionId },
      });
    }
    const scene = session
      ? yield* sceneAt(session.id, part.sourceStartTime)
      : null;
    const [clip] = yield* dbCall(() =>
      db
        .insert(clips)
        .values({
          videoId,
          order,
          videoFilename: session?.micFilePath ?? part.videoFilename,
          sourceStartTime: part.sourceStartTime,
          sourceEndTime: part.sourceEndTime,
          text: part.text,
          // Its text comes from the Footage's own transcript.
          transcriptionStatus: "done",
          // Clip Origin: cut by the `cvm` CLI from Footage already filmed.
          origin: "cli",
          recordingSessionId: session?.id ?? null,
          scene,
        })
        .returning()
    );
    yield* writeTranscriptWords(db, clip!.id, part.transcriptWords);
    return clip!.id;
  });

  const createShortFromRanges = Effect.fn("createShortFromRanges")(
    function* (input: {
      readonly name: string;
      readonly parts: ReadonlyArray<ShortPart>;
    }) {
      const copyIds = input.parts.flatMap((p) =>
        p.kind === "copy" ? [p.clipId] : []
      );
      const sources =
        copyIds.length === 0
          ? []
          : yield* dbCall(() =>
              db.query.clips.findMany({
                where: and(
                  inArray(clips.id, copyIds),
                  eq(clips.archived, false)
                ),
                with: {
                  ...clipChildrenWith,
                  video: { columns: { format: true } },
                },
              })
            );
      const sourceById = new Map(sources.map((c) => [c.id, c]));
      const missing = copyIds.filter((id) => !sourceById.has(id));
      if (missing.length > 0) {
        return yield* new NotFoundError({
          type: "createShortFromRanges",
          params: { clipIds: missing },
        });
      }

      const [short] = yield* dbCall(() =>
        db
          .insert(videos)
          .values({
            title: input.name,
            originalFootagePath: "",
            lessonId: null,
            format: "short",
          })
          .returning()
      );

      const orders = generateNKeysBetween(null, null, input.parts.length);
      const retime = createClipRetimeOperationsUnwrapped(db).retimeClip;
      const clipIds: string[] = [];
      for (const [i, part] of input.parts.entries()) {
        if (part.kind === "cut") {
          clipIds.push(yield* insertCut(short!.id, orders[i]!, part));
          continue;
        }
        const { video: from, ...source } = sourceById.get(part.clipId)!;
        // One copy per Part (a Clip may be in two ranges). From a Short, its
        // Overlays (Chat Cards and Calls to Action) come too, the ones the
        // range holds, and `retime` below keeps them on the same moment of
        // footage. A Landscape Video's Overlays were placed for its picture
        // and stay behind. Footage Layers placed in a Landscape frame are
        // carried into the Short's.
        const fromShort = resolveVideoFormat(from.format) === "short";
        const shift = retimeShift(source, part);
        // Each ends by the end of its range, so a copy is never one `overlay
        // add` would refuse: none runs past its Clip, across a jump cut, or
        // into an Overlay of the next range.
        const overlays = fromShort
          ? source.overlays
              .filter((o) => recutHoldsOverlay(o.at, shift))
              .map((o) => ({
                ...o,
                durationInSeconds: Math.min(
                  o.durationInSeconds,
                  shift.newDuration - (o.at + shift.delta)
                ),
              }))
          : [];
        const layers = source.layers.map((row) =>
          layerRowInVideoFormat(row, resolveVideoFormat(from.format), "short")
        );
        const ids = yield* dbCall(() =>
          copyClipsOntoVideo(
            db,
            [
              {
                clip: { ...source, overlays, layers },
                videoId: short!.id,
                order: orders[i]!,
              },
            ],
            { origin: "copy" }
          )
        );
        const id = ids.get(source.id)!;
        clipIds.push(id);
        const trimmed =
          part.sourceStartTime !== source.sourceStartTime ||
          part.sourceEndTime !== source.sourceEndTime;
        if (!trimmed) continue;
        yield* retime(id, {
          sourceStartTime: part.sourceStartTime,
          sourceEndTime: part.sourceEndTime,
        });
        // A trimmed copy's text is the words it still holds, when it has any.
        const kept = yield* dbCall(() =>
          db.query.clipTranscriptWords.findMany({
            where: (w, { eq }) => eq(w.clipId, id),
            orderBy: (w) => [asc(w.start)],
            columns: { text: true },
          })
        );
        if (kept.length > 0) {
          const text = kept.map((w) => w.text).join(" ");
          yield* dbCall(() =>
            db.update(clips).set({ text }).where(eq(clips.id, id))
          );
        }
      }

      return { ...short!, clipIds };
    }
  );

  return { getRecordingSessionForCut, createShortFromRanges };
};
