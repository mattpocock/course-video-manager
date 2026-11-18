import { Effect } from "effect";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";

/**
 * The thumbnail creator's Delete archives the Thumbnail: its row and files
 * stay, so a recorded source keeps resolving (ADR 0060).
 */
export const action = makeAction({
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const thumbnailOps = yield* ThumbnailOperationsService;
      yield* thumbnailOps.archiveThumbnail(params.thumbnailId!);
      return { success: true };
    }),
});
