import { Effect } from "effect";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";
import { readDiagramSourcesField } from "@/features/thumbnail-editor/thumbnail-diagram-payload";

/**
 * Records insert sources on a Thumbnail, and nothing else. The thumbnail page
 * sends this as it goes away (`pagehide`, a keepalive request): a whole save
 * carries PNGs too big to outlive the page, and the sources live nowhere
 * else (ADR 0060).
 */
export const action = makeAction({
  input: "json",
  errors: { NotFoundError: 404, VersionNotDraftError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { diagramSources: field } = (payload ?? {}) as {
        diagramSources?: unknown;
      };
      const diagramSources = yield* readDiagramSourcesField(field);
      const thumbnailOps = yield* ThumbnailOperationsService;
      yield* thumbnailOps.recordThumbnailDiagramSources(
        params.thumbnailId!,
        diagramSources
      );
      return { success: true };
    }),
});
