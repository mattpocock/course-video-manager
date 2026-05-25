import { createReadStream } from "fs";
import type { Route } from "./+types/api.thumbnails.$thumbnailId.image";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { data } from "react-router";

export const loader = async (args: Route.LoaderArgs) => {
  const { thumbnailId } = args.params;

  return Effect.gen(function* () {
    const thumbnailOps = yield* ThumbnailOperationsService;
    const record = yield* thumbnailOps.getThumbnailById(thumbnailId);

    if (!record.filePath) {
      return yield* Effect.die(
        data("Thumbnail has no rendered image", { status: 404 })
      );
    }

    return new Response(createReadStream(record.filePath) as any, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  }).pipe(
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
