import { Console, Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.open-folder";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import path from "node:path";

export const action = async (args: Route.ActionArgs) => {
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const openFolder = yield* OpenFolderService;

    const video = yield* videoOps.getVideoDeepById(videoId);

    if (!video.lesson) {
      // Standalone video — open asset directory in Windows Explorer
      const folderPath = path.resolve(getStandaloneVideoFilePath(videoId));
      yield* openFolder.openInExplorer(folderPath);
    } else {
      // Lesson-connected video — open parent directory of repo in Explorer
      const repo = video.lesson.section.repoVersion.repo;
      yield* openFolder.openInExplorer(path.dirname(repo.filePath!));
    }

    return { success: true };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.succeed(
        data({ error: "Video not found" }, { status: 404 })
      );
    }),
    Effect.catchAll(() => {
      return Effect.succeed(
        data({ error: "Failed to open folder" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
