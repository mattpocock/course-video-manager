import { createReadStream } from "fs";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { data } from "react-router";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const thumbnailOps = yield* ThumbnailOperationsService;
      const record = yield* thumbnailOps.getThumbnailById(params.thumbnailId!);

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
    }),
});
