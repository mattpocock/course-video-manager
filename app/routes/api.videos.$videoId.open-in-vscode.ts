import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const openFolder = yield* OpenFolderService;

      const video = yield* videoOps.getVideoDeepById(params.videoId!);

      if (!video.lesson) {
        return data(
          { error: "Video is not connected to a repo" },
          { status: 400 }
        );
      }

      const repo = video.lesson.section.repoVersion.repo;
      yield* openFolder.openInVSCode(repo.filePath!);

      return { success: true };
    }),
});
