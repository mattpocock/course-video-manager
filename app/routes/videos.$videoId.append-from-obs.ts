import type { Route } from "./+types/videos.$videoId.append-from-obs";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { TotalTypeScriptCLIService } from "@/services/tt-cli-service";
import { Effect } from "effect";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const db = yield* DBService;

    const ttCliService = yield* TotalTypeScriptCLIService;

    yield* db.getVideoById(videoId);

    const latestOBSVideoClips = yield* ttCliService.getLatestOBSVideoClips();

    const clips = yield* db.appendClips(videoId, latestOBSVideoClips.clips);

    return clips;
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};
