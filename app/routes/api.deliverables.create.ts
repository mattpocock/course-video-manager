import { Console, Effect } from "effect";
import { Schema } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
import type { Route } from "./+types/api.deliverables.create";

const createSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  date: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  notes: Schema.optional(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const courseIds = [
    ...new Set(
      formData
        .getAll("courseIds")
        .filter((v): v is string => typeof v === "string" && v !== "")
    ),
  ];
  const pitchIds = [
    ...new Set(
      formData
        .getAll("pitchIds")
        .filter((v): v is string => typeof v === "string" && v !== "")
    ),
  ];

  return Effect.gen(function* () {
    const input = yield* Schema.decodeUnknown(createSchema)(formDataObject);

    const deliverableOps = yield* DeliverableOperationsService;
    const deliverable = yield* deliverableOps.createDeliverable({
      title: input.title,
      date: input.date,
      notes: input.notes,
      courseIds: courseIds.length > 0 ? courseIds : undefined,
      pitchIds: pitchIds.length > 0 ? pitchIds : undefined,
    });

    return data({ id: deliverable.id });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
