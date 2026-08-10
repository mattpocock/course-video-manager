import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.videos.$videoId.vertical-export-exists";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(`${finishedDir}/${videoId}.mp4`);
    return Response.json({ exists });
  }).pipe(
    Effect.catchAll(() => {
      return Effect.succeed(Response.json({ exists: false }));
    }),
    runtimeLive.runPromise
  );
};
