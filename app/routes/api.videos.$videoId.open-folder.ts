import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { OpenFolderService } from "@/services/open-folder-service";
import { makeAction } from "@/services/route-action.server";
import { getVideoFilePath } from "@/services/video-files";
import path from "node:path";

export const action = makeAction({
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const openFolder = yield* OpenFolderService;

      const video = yield* videoOps.getVideoDeepById(params.videoId!);

      const folderPath = path.resolve(getVideoFilePath(video.lineageId));
      yield* openFolder.openInExplorer(folderPath);

      return { success: true };
    }),
});
