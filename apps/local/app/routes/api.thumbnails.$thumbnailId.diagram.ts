import { Effect } from "effect";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { data } from "react-router";

/**
 * A Thumbnail's Thumbnail Diagram, drawing only (the face is in its layers),
 * for the palette's "Insert diagram". Null for an old pasted-PNG Thumbnail.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const thumbnailOps = yield* ThumbnailOperationsService;
      const thumbnail = yield* thumbnailOps.getThumbnailById(
        params.thumbnailId!
      );
      return data({ thumbnailDiagram: thumbnail.thumbnailDiagram });
    }),
});
