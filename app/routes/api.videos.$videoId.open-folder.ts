import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import path from "node:path";

export const action = makeAction({
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const openFolder = yield* OpenFolderService;

      const video = yield* videoOps.getVideoDeepById(params.videoId!);

      if (!video.lesson) {
        const folderPath = path.resolve(
          getStandaloneVideoFilePath(params.videoId!)
        );
        yield* openFolder.openInExplorer(folderPath);
      } else {
        const repo = video.lesson.section.repoVersion.repo;
        yield* openFolder.openInExplorer(path.dirname(repo.filePath!));
      }

      return { success: true };
    }),
});
