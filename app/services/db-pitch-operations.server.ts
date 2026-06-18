import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { clips, pitches, segments, videos } from "@/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
  makeDbCall,
  dbQueryFirst,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";

export type PitchState = "idle" | "scheduled" | "shipped";

export function derivePitchState(deliverableStatuses: string[]): PitchState {
  if (deliverableStatuses.length === 0) return "idle";
  const allTerminal = deliverableStatuses.every(
    (s) => s === "done" || s === "cancelled"
  );
  return allTerminal ? "shipped" : "scheduled";
}

export const createPitchOperations = (db: DrizzleDB) => {
  const buildPitchFilters = (filters?: {
    priority?: number[];
    effort?: number[];
    archived?: boolean;
  }) => {
    const conditions = [eq(pitches.archived, filters?.archived ?? false)];
    if (filters?.priority && filters.priority.length > 0) {
      conditions.push(inArray(pitches.priority, filters.priority));
    }
    if (filters?.effort && filters.effort.length > 0) {
      conditions.push(inArray(pitches.effort, filters.effort));
    }
    return and(...conditions);
  };

  const createPitch = Effect.fn("createPitch")(function* () {
    return yield* dbMutateReturning(() =>
      db.insert(pitches).values({}).returning()
    );
  });

  const listPitches = Effect.fn("listPitches")(function* (filters?: {
    state?: PitchState[];
    priority?: number[];
    effort?: number[];
    archived?: boolean;
  }) {
    const rows = yield* makeDbCall(() =>
      db.query.pitches.findMany({
        where: buildPitchFilters(filters),
        orderBy: [
          asc(pitches.priority),
          asc(pitches.effort),
          desc(pitches.createdAt),
        ],
        with: {
          deliverablesPitches: {
            with: {
              deliverable: {
                columns: { status: true },
              },
            },
          },
        },
      })
    );

    const withState = rows.map((row) => {
      const { deliverablesPitches: dpLinks, ...rest } = row;
      const statuses = dpLinks.map((dp) => dp.deliverable.status);
      return { ...rest, state: derivePitchState(statuses) };
    });

    if (filters?.state && filters.state.length > 0) {
      const allowed = new Set(filters.state);
      return withState.filter((p) => allowed.has(p.state));
    }

    return withState;
  });

  const listPitchesWithVideos = Effect.fn("listPitchesWithVideos")(
    function* (filters?: {
      state?: PitchState[];
      priority?: number[];
      effort?: number[];
      archived?: boolean;
    }) {
      const rows = yield* makeDbCall(() =>
        db.query.pitches.findMany({
          where: buildPitchFilters(filters),
          orderBy: [
            asc(pitches.priority),
            asc(pitches.effort),
            desc(pitches.createdAt),
          ],
          with: {
            videos: {
              where: eq(videos.archived, false),
              with: {
                clips: {
                  orderBy: asc(clips.order),
                  where: eq(clips.archived, false),
                },
              },
            },
            deliverablesPitches: {
              with: {
                deliverable: {
                  columns: { status: true },
                },
              },
            },
          },
        })
      );

      const withState = rows.map((row) => {
        const { deliverablesPitches: dpLinks, ...rest } = row;
        const statuses = dpLinks.map((dp) => dp.deliverable.status);
        return { ...rest, state: derivePitchState(statuses) };
      });

      if (filters?.state && filters.state.length > 0) {
        const allowed = new Set(filters.state);
        return withState.filter((p) => allowed.has(p.state));
      }

      return withState;
    }
  );

  const getPitch = Effect.fn("getPitch")(function* (id: string) {
    return yield* dbQueryFirst(
      () =>
        db.query.pitches.findFirst({
          where: eq(pitches.id, id),
        }),
      { type: "getPitch", params: { id } }
    );
  });

  const getPitchWithVideos = Effect.fn("getPitchWithVideos")(function* (
    id: string
  ) {
    const pitch = yield* dbQueryFirst(
      () =>
        db.query.pitches.findFirst({
          where: eq(pitches.id, id),
          with: {
            videos: {
              where: eq(videos.archived, false),
              with: {
                clips: {
                  orderBy: asc(clips.order),
                  where: eq(clips.archived, false),
                },
                segments: {
                  columns: {
                    id: true,
                    kind: true,
                    title: true,
                    description: true,
                    order: true,
                    videoId: true,
                  },
                  orderBy: asc(segments.order),
                },
              },
            },
            deliverablesPitches: {
              with: {
                deliverable: {
                  columns: { status: true },
                },
              },
            },
          },
        }),
      { type: "getPitchWithVideos", params: { id } }
    );

    const { deliverablesPitches: dpLinks, ...rest } = pitch;
    const statuses = dpLinks.map((dp) => dp.deliverable.status);
    return { ...rest, state: derivePitchState(statuses) };
  });

  const updatePitchField = Effect.fn("updatePitchField")(function* (
    id: string,
    field: string,
    value: string | number | boolean
  ) {
    return yield* dbMutateReturning(
      () =>
        db
          .update(pitches)
          .set({ [field]: value, updatedAt: new Date() })
          .where(eq(pitches.id, id))
          .returning(),
      { type: "updatePitchField", params: { id, field } }
    );
  });

  const createVideoFromPitch = Effect.fn("createVideoFromPitch")(function* (
    pitchId: string
  ) {
    const pitch = yield* dbQueryFirst(
      () =>
        db.query.pitches.findFirst({
          where: eq(pitches.id, pitchId),
        }),
      { type: "createVideoFromPitch", params: { pitchId } }
    );

    return yield* dbMutateReturning(() =>
      db
        .insert(videos)
        .values({
          path: pitch.title,
          originalFootagePath: "",
          lessonId: null,
          pitchId,
        })
        .returning()
    );
  });

  const deletePitch = Effect.fn("deletePitch")(function* (id: string) {
    yield* makeDbCall(() =>
      db.update(videos).set({ pitchId: null }).where(eq(videos.pitchId, id))
    );

    yield* makeDbCall(() => db.delete(pitches).where(eq(pitches.id, id)));
  });

  return {
    createPitch,
    listPitches,
    listPitchesWithVideos,
    getPitch,
    getPitchWithVideos,
    updatePitchField,
    createVideoFromPitch,
    deletePitch,
  };
};

export class PitchOperationsService extends Effect.Service<PitchOperationsService>()(
  "PitchOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createPitchOperations(db);
    }),
  }
) {}
