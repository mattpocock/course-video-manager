import { Console, Effect, Schema } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.pitches.$pitchId.update";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const updatableFields = [
  "title",
  "description",
  "contentPlan",
  "youtubeTitle",
  "youtubeThumbnailDescription",
  "newsletterTitle",
  "tweet",
  "status",
  "priority",
  "archived",
] as const;

const updateSchema = Schema.Struct({
  field: Schema.Literal(...updatableFields),
  value: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  const { pitchId } = args.params;
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const { field, value } =
      yield* Schema.decodeUnknown(updateSchema)(formDataObject);

    const pitchOps = yield* PitchOperationsService;

    let coerced: string | number | boolean = value;
    if (field === "priority") coerced = Number(value);
    if (field === "archived") coerced = value === "true";

    const pitch = yield* pitchOps.updatePitchField(pitchId, field, coerced);
    return data({ pitch });
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
