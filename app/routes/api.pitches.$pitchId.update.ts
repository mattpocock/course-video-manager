import { Effect, Schema } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeAction } from "@/services/route-action.server";
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

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { field, value } =
        yield* Schema.decodeUnknown(updateSchema)(payload);

      const pitchOps = yield* PitchOperationsService;

      let coerced: string | number | boolean = value;
      if (field === "priority") coerced = Number(value);
      if (field === "archived") coerced = value === "true";

      const pitch = yield* pitchOps.updatePitchField(
        params.pitchId!,
        field,
        coerced
      );
      return data({ pitch });
    }),
});
