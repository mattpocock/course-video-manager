import { Effect, Schema } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { makeAction } from "@/services/route-action.server";

const createSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  date: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  notes: Schema.optional(Schema.String),
});

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
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

  return makeAction({
    effect: () =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknown(createSchema)(formDataObject);

        const deliverableOps = yield* DeliverableOperationsService;
        const deliverable = yield* deliverableOps.createDeliverable({
          title: input.title,
          date: input.date,
          notes: input.notes,
          courseIds: courseIds.length > 0 ? courseIds : undefined,
          pitchIds: pitchIds.length > 0 ? pitchIds : undefined,
        });

        return { id: deliverable.id };
      }),
  })(args);
};
