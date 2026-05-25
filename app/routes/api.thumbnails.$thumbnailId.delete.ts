import { Console, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.thumbnails.$thumbnailId.delete";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { thumbnailId } = args.params;

  return Effect.gen(function* () {
    const thumbnailOps = yield* ThumbnailOperationsService;
    const fs = yield* FileSystem.FileSystem;

    // Fetch thumbnail to get file paths before deleting
    const thumbnail = yield* thumbnailOps.getThumbnailById(thumbnailId);

    // Collect all file paths to delete
    const filesToDelete: string[] = [];

    if (thumbnail.filePath) {
      filesToDelete.push(thumbnail.filePath);
    }

    // Parse layers to find layer image files
    const layers = thumbnail.layers as {
      backgroundPhoto?: { filePath?: string };
      diagram?: { filePath?: string } | null;
      cutout?: { filePath?: string } | null;
    };

    if (layers.backgroundPhoto?.filePath) {
      filesToDelete.push(layers.backgroundPhoto.filePath);
    }
    if (layers.diagram?.filePath) {
      filesToDelete.push(layers.diagram.filePath);
    }
    if (layers.cutout?.filePath) {
      filesToDelete.push(layers.cutout.filePath);
    }

    // Delete files from disk (ignore errors for missing files)
    for (const filePath of filesToDelete) {
      yield* fs.remove(filePath).pipe(Effect.catchAll(() => Effect.void));
    }

    // Delete DB record
    yield* thumbnailOps.deleteThumbnail(thumbnailId);

    return { success: true };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Thumbnail not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
