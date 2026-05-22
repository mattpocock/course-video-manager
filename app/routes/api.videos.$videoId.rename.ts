import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.videos.$videoId.rename";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const renameVideoSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Video name cannot be empty" })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const { name } =
      yield* Schema.decodeUnknown(renameVideoSchema)(formDataObject);

    const videoOps = yield* VideoOperationsService;

    yield* videoOps.updateVideoPath({ videoId, path: name.trim() });

    return { success: true };
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
