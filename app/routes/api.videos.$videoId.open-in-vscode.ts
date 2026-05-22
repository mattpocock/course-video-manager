import { Console, Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.open-in-vscode";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const openFolder = yield* OpenFolderService;

    const video = yield* videoOps.getVideoDeepById(videoId);

    if (!video.lesson) {
      return data(
        { error: "Video is not connected to a repo" },
        { status: 400 }
      );
    }

    const repo = video.lesson.section.repoVersion.repo;
    yield* openFolder.openInVSCode(repo.filePath!);

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
        data({ error: "Failed to open VS Code" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
