import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import { clips, pitches, segments, videos } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { Effect } from "effect";

export type PitchState = "idle" | "scheduled" | "shipped";

export function derivePitchState(deliverableStatuses: string[]): PitchState {
  if (deliverableStatuses.length === 0) return "idle";
  const allTerminal = deliverableStatuses.every(
    (s) => s === "done" || s === "cancelled"
  );
  return allTerminal ? "shipped" : "scheduled";
}

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createPitchOperations = (db: Database) => {
  const buildPitchFilters = (filters?: {
    priority?: number[];
    effort?: number[];
    archived?: boolean;
  }) => {
    const conditions = [
      eq(pitches.archived, filters?.archived ?? false),
      gt(pitches.title, ""),
    ];
    if (filters?.priority && filters.priority.length > 0) {
      conditions.push(inArray(pitches.priority, filters.priority));
    }
    if (filters?.effort && filters.effort.length > 0) {
      conditions.push(inArray(pitches.effort, filters.effort));
    }
    return and(...conditions);
  };

  const createPitch = Effect.fn("createPitch")(function* () {
    const results = yield* makeDbCall(() =>
      db.insert(pitches).values({}).returning()
    );

    const pitch = results[0];

    if (!pitch) {
      return yield* new UnknownDBServiceError({
        cause: "No pitch was returned from the database",
      });
    }

    return pitch;
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
    const pitch = yield* makeDbCall(() =>
      db.query.pitches.findFirst({
        where: eq(pitches.id, id),
      })
    );

    if (!pitch) {
      return yield* new NotFoundError({
        type: "getPitch",
        params: { id },
      });
    }

    return pitch;
  });

  const getPitchWithVideos = Effect.fn("getPitchWithVideos")(function* (
    id: string
  ) {
    const pitch = yield* makeDbCall(() =>
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
                where: eq(segments.archived, false),
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

    if (!pitch) {
      return yield* new NotFoundError({
        type: "getPitchWithVideos",
        params: { id },
      });
    }

    const { deliverablesPitches: dpLinks, ...rest } = pitch;
    const statuses = dpLinks.map((dp) => dp.deliverable.status);
    return { ...rest, state: derivePitchState(statuses) };
  });

  const updatePitchField = Effect.fn("updatePitchField")(function* (
    id: string,
    field: string,
    value: string | number | boolean
  ) {
    const results = yield* makeDbCall(() =>
      db
        .update(pitches)
        .set({ [field]: value, updatedAt: new Date() })
        .where(eq(pitches.id, id))
        .returning()
    );

    const pitch = results[0];

    if (!pitch) {
      return yield* new NotFoundError({
        type: "updatePitchField",
        params: { id, field },
      });
    }

    return pitch;
  });

  const createVideoFromPitch = Effect.fn("createVideoFromPitch")(function* (
    pitchId: string
  ) {
    const pitch = yield* makeDbCall(() =>
      db.query.pitches.findFirst({
        where: eq(pitches.id, pitchId),
      })
    );

    if (!pitch) {
      return yield* new NotFoundError({
        type: "createVideoFromPitch",
        params: { pitchId },
      });
    }

    const results = yield* makeDbCall(() =>
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

    const video = results[0];

    if (!video) {
      return yield* new UnknownDBServiceError({
        cause: "No video was returned from the database",
      });
    }

    return video;
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
