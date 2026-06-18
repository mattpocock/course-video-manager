import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest(
  DeliverableOperationsService.Default,
  CourseOperationsService.Default,
  PitchOperationsService.Default
);

describe("duplicateDeliverable", () => {
  it.effect(
    "duplicates a deliverable 7 days later without copying linked courses or pitches",
    () =>
      Effect.gen(function* () {
        const deliverableOps = yield* DeliverableOperationsService;
        const courseOps = yield* CourseOperationsService;
        const pitchOps = yield* PitchOperationsService;

        const course = yield* courseOps.createCourse({
          filePath: "/tmp/test-course",
          name: "test-course",
        });
        const pitch = yield* pitchOps.createPitch();

        const original = yield* deliverableOps.createDeliverable({
          title: "Ship feature X",
          date: "2026-05-04",
          notes: "Some notes",
          courseIds: [course.id],
          pitchIds: [pitch.id],
        });

        const result = yield* deliverableOps.duplicateDeliverable(original.id);

        expect(result.created.title).toBe("Ship feature X");
        expect(result.created.notes).toBe("Some notes");
        expect(result.created.date).toBe("2026-05-11");
        expect(result.created.status).toBe("planned");
        expect(result.created.archived).toBe(false);
        expect(result.created.id).not.toBe(original.id);

        const list = yield* deliverableOps.listDeliverables();
        const dup = list.find((d) => d.id === result.created.id);
        expect(dup?.deliverablesCourses).toEqual([]);
        expect(dup?.deliverablesPitches).toEqual([]);
      }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("duplicates a deliverable with no links", () =>
    Effect.gen(function* () {
      const deliverableOps = yield* DeliverableOperationsService;

      const original = yield* deliverableOps.createDeliverable({
        title: "Solo task",
        date: "2026-05-04",
      });

      const result = yield* deliverableOps.duplicateDeliverable(original.id);

      expect(result.created.title).toBe("Solo task");
      expect(result.created.date).toBe("2026-05-11");

      const list = yield* deliverableOps.listDeliverables();
      expect(list).toHaveLength(2);
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("correctly handles month boundary when adding 7 days", () =>
    Effect.gen(function* () {
      const deliverableOps = yield* DeliverableOperationsService;

      const original = yield* deliverableOps.createDeliverable({
        title: "Cross month",
        date: "2026-01-28",
      });

      const result = yield* deliverableOps.duplicateDeliverable(original.id);

      expect(result.created.date).toBe("2026-02-04");
    }).pipe(Effect.provide(ctx.testLayer))
  );
});
