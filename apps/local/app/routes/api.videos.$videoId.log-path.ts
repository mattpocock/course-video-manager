import { Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.log-path";
import { runtimeLive } from "@/services/layer.server";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import path from "node:path";

export const loader = async (args: Route.LoaderArgs) => {
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const logger = yield* VideoEditorLoggerService;
    const logPath = logger.getLogPath(videoId);
    const absolutePath = path.resolve(logPath);
    return new Response(absolutePath, {
      headers: { "Content-Type": "text/plain" },
    });
  }).pipe(runtimeLive.runPromise);
};
