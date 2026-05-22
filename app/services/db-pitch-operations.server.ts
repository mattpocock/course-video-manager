import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { clips, pitches, videos } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createPitchOperations = (db: DrizzleDB) => {
  const buildPitchFilters = (filters?: {
    status?: string[];
    priority?: number[];
    archived?: boolean;
  }) => {
    const conditions = [eq(pitches.archived, filters?.archived ?? false)];
    if (filters?.status && filters.status.length > 0) {
      conditions.push(inArray(pitches.status, filters.status));
    }
    if (filters?.priority && filters.priority.length > 0) {
      conditions.push(inArray(pitches.priority, filters.priority));
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
    status?: string[];
    priority?: number[];
    archived?: boolean;
  }) {
    return yield* makeDbCall(() =>
      db.query.pitches.findMany({
        where: buildPitchFilters(filters),
        orderBy: [asc(pitches.priority), desc(pitches.createdAt)],
      })
    );
  });

  const listPitchesWithVideos = Effect.fn("listPitchesWithVideos")(
    function* (filters?: {
      status?: string[];
      priority?: number[];
      archived?: boolean;
    }) {
      return yield* makeDbCall(() =>
        db.query.pitches.findMany({
          where: buildPitchFilters(filters),
          orderBy: [asc(pitches.priority), desc(pitches.createdAt)],
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
          },
        })
      );
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

    return pitch;
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
