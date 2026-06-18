import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import {
  deliverables,
  deliverablesCourses,
  deliverablesPitches,
} from "@/db/schema";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  makeDbCall,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";

export const createDeliverableOperations = (db: DrizzleDB) => {
  const listDeliverables = Effect.fn("listDeliverables")(function* () {
    return yield* makeDbCall(() =>
      db.query.deliverables.findMany({
        where: eq(deliverables.archived, false),
        orderBy: [asc(deliverables.date), asc(deliverables.createdAt)],
        with: {
          deliverablesCourses: { columns: { courseId: true } },
          deliverablesPitches: { columns: { pitchId: true } },
        },
      })
    );
  });

  const createDeliverable = Effect.fn("createDeliverable")(function* (input: {
    title: string;
    date: string;
    notes?: string;
    courseIds?: string[];
    pitchIds?: string[];
  }) {
    const deliverable = yield* dbMutateReturning(() =>
      db
        .insert(deliverables)
        .values({
          title: input.title,
          date: input.date,
          notes: input.notes || null,
        })
        .returning()
    );

    if (input.courseIds && input.courseIds.length > 0) {
      yield* makeDbCall(() =>
        db.insert(deliverablesCourses).values(
          input.courseIds!.map((courseId) => ({
            deliverableId: deliverable.id,
            courseId,
          }))
        )
      );
    }

    if (input.pitchIds && input.pitchIds.length > 0) {
      yield* makeDbCall(() =>
        db.insert(deliverablesPitches).values(
          input.pitchIds!.map((pitchId) => ({
            deliverableId: deliverable.id,
            pitchId,
          }))
        )
      );
    }

    return deliverable;
  });

  const updateDeliverableStatus = Effect.fn("updateDeliverableStatus")(
    function* (input: {
      id: string;
      status: "planned" | "done" | "cancelled";
    }) {
      return yield* dbMutateReturning(() =>
        db
          .update(deliverables)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(deliverables.id, input.id))
          .returning()
      );
    }
  );

  const updateDeliverable = Effect.fn("updateDeliverable")(function* (input: {
    id: string;
    title: string;
    date: string;
    notes?: string;
    status: "planned" | "done" | "cancelled";
    courseIds?: string[];
    pitchIds?: string[];
  }) {
    const deliverable = yield* dbMutateReturning(() =>
      db
        .update(deliverables)
        .set({
          title: input.title,
          date: input.date,
          notes: input.notes || null,
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, input.id))
        .returning()
    );

    if (input.courseIds !== undefined) {
      yield* makeDbCall(() =>
        db
          .delete(deliverablesCourses)
          .where(eq(deliverablesCourses.deliverableId, input.id))
      );
      if (input.courseIds.length > 0) {
        yield* makeDbCall(() =>
          db.insert(deliverablesCourses).values(
            input.courseIds!.map((courseId) => ({
              deliverableId: input.id,
              courseId,
            }))
          )
        );
      }
    }

    if (input.pitchIds !== undefined) {
      yield* makeDbCall(() =>
        db
          .delete(deliverablesPitches)
          .where(eq(deliverablesPitches.deliverableId, input.id))
      );
      if (input.pitchIds.length > 0) {
        yield* makeDbCall(() =>
          db.insert(deliverablesPitches).values(
            input.pitchIds!.map((pitchId) => ({
              deliverableId: input.id,
              pitchId,
            }))
          )
        );
      }
    }

    return deliverable;
  });

  const duplicateDeliverable = Effect.fn("duplicateDeliverable")(function* (
    id: string
  ) {
    const existing = yield* makeDbCall(() =>
      db.query.deliverables.findFirst({
        where: eq(deliverables.id, id),
      })
    );

    if (!existing) {
      return yield* new UnknownDBServiceError({
        cause: "Deliverable not found",
      });
    }

    const [y, m, d] = existing.date.split("-").map(Number);
    const dt = new Date(y!, m! - 1, d!);
    dt.setDate(dt.getDate() + 7);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const newDate = `${yy}-${mm}-${dd}`;

    const created = yield* dbMutateReturning(() =>
      db
        .insert(deliverables)
        .values({
          title: existing.title,
          date: newDate,
          notes: existing.notes,
        })
        .returning()
    );

    return { created };
  });

  const archiveDeliverable = Effect.fn("archiveDeliverable")(function* (
    id: string
  ) {
    return yield* dbMutateReturning(() =>
      db
        .update(deliverables)
        .set({ archived: true, updatedAt: new Date() })
        .where(eq(deliverables.id, id))
        .returning()
    );
  });

  return {
    listDeliverables,
    createDeliverable,
    updateDeliverableStatus,
    updateDeliverable,
    duplicateDeliverable,
    archiveDeliverable,
  };
};

export class DeliverableOperationsService extends Effect.Service<DeliverableOperationsService>()(
  "DeliverableOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createDeliverableOperations(db);
    }),
  }
) {}
