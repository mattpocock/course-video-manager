import { Effect, Schema } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { makeAction } from "@/services/route-action.server";

const updateSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  date: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  notes: Schema.optional(Schema.String),
  status: Schema.Literal("planned", "done", "cancelled"),
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
    effect: ({ params }) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknown(updateSchema)(formDataObject);

        const deliverableOps = yield* DeliverableOperationsService;
        const deliverable = yield* deliverableOps.updateDeliverable({
          id: params.deliverableId!,
          title: input.title,
          date: input.date,
          notes: input.notes,
          status: input.status,
          courseIds,
          pitchIds,
        });

        return { id: deliverable.id };
      }),
  })(args);
};
